# Decisions

Choices the spec leaves open, one line each, newest at the bottom of each section.

## M0: setup, database and data

- The three data files were at the repo root; they now live in `data/` as the spec layout says.
- Node 24 LTS (`.nvmrc`), ESM everywhere, npm workspaces `packages/*` and `apps/*`.
- TypeScript is pinned to 6.0.x because typescript-eslint (8.73) supports TypeScript below 6.1; TypeScript 7 is not supported yet.
- drizzle-orm 0.45 (latest stable) and drizzle-kit 0.31; drizzle 1.0 is still a release candidate.
- Workspace packages export their TypeScript source directly (`exports: ./src/index.ts`); tsx, Vitest and Vite run it as-is, and the M7 production build will bundle it.
- Postgres support uses two Drizzle schemas (`schema/sqlite.ts`, `schema/pg.ts`) with identical tables, columns, keys and indexes; a parity test fails if they drift.
- Migrations live in `apps/server/drizzle/sqlite` and `apps/server/drizzle/pg`, generated together by `npm run db:generate`.
- Postgres is tested in-process with PGlite, so no Postgres server is needed to run the tests.
- `DATABASE_URL`: `postgres://`/`postgresql://` means Postgres; anything else is a SQLite path resolved from the repo root; default `file:var/draft-xi.db`.
- Timestamps are integer milliseconds in SQLite and `timestamptz` in Postgres; both map to `Date` in TypeScript.
- PRNG seeds are `bigint` in Postgres because unsigned 32-bit values overflow `integer`.
- Ids are auto-increment integers (SQLite `AUTOINCREMENT`, Postgres identity), so deleted ids are never reused.
- Enum-like columns are text with TypeScript enums, not database enums, so new values need no migration.
- `players.seed.json` is the seed source because it carries `alt_positions`; `players.csv` is only cross-checked.
- `data:validate` fails on exactly the spec's list, plus a club listed twice in `clubs.json` and empty names, clubs or nationalities.
- `data:validate` only warns about: club count other than 20, `squad_size` out of date, CSV and JSON disagreeing, colours that are not `#RRGGBB`, and alt positions that repeat the primary position.
- The "at least 2 GKs" rule counts players whose primary or alt position is GK.
- Duplicate names are checked within a club only, case-insensitively, after NFC normalisation; the same name at two clubs is fine (Nico González plays for Manchester City and Juventus).
- Seeding matches clubs by name and players by (club, name); it inserts new rows, updates changed fields and leaves identical rows untouched.
- (Replaced) Rows no longer in the files used to be left active; see the Nov 2026 data lines below.
- The seed only writes data from the files; `is_active`, `is_injured`, `source_note`, `in_pool` and `notes` belong to admins and are never overwritten.
- `full_name` and `display_name` both start as the EA name, which is already a display name (for example "Vini Jr.").
- `users.username` is nullable (guests have none) and unique.
- `participants.team_name` is nullable (spectators) and unique per game at the database level; case-insensitive checks come in M2.
- Integrity constraints beyond the spec: one pick per (participant, slot), one participant per (game, user), and a CHECK that overall is 40 to 99.
- `audit_log` stores `actor_user_id` (nullable FK), an `actor` text snapshot and an optional `game_id`, so entries survive user deletion and can be filtered by game.
- `seasons.status` is one of pending, simulating, completed or failed; `seasons.created_at` is added for history ordering.
- `apps/web` was not scaffolded in M0; it arrived with M2, once there was a server to talk to.
- `npm audit` reports 4 moderate advisories, all one esbuild dev-server issue inside drizzle-kit's dev-only toolchain. It is not reachable because we never run esbuild's server; revisit when drizzle-kit updates.

## M1: engine

- Formation slots are fixed per formation (for example 4-3-3 uses three CMs; 4-2-3-1 uses two CDMs plus RM, CAM, LM; 3-5-2 uses RWB, RCM, CDM, LCM, LWB). With these, the engine reproduces every club's best XI and best formation in `clubs.json`.
- "Rated player beyond the XI" means a bench player with overall 70 or more; this reproduces all 20 `strength_rating` values and ranks in `clubs.json` exactly.
- The seed now stores the engine's computed `strength_rating`; `data:validate` warns if `clubs.json` disagrees.
- Pitch coordinates are percentages: x from the left touchline (0) to the right (100), y from the team's own goal (0) to the opponent's (100).
- AI XIs use an optimal assignment (Hungarian algorithm), preferring compatible players, then out-of-position outfielders at minus 8, then a 62-rated Academy Reserve. Goalkeepers never play outfield.
- When comparing formations for an AI club, the one with more compatible slots wins, then the higher total overall.
- Tuned defaults: base_goals 1.25 and sensitivity 0.09. The spec's 1.35 and 0.05 gave champions about 77 points, below the 80 to 95 target.
- Team strength for pre-season ranking is (attack + defense) / 2, chemistry included.
- Each match draws from its own seed, hash(season seed, purpose, matchday, home id, away id), so fast mode (no events) gives identical scores to full mode.
- Fixtures use Berger tables mirrored for the second half; the engine rotates the opening round until no team has three home or three away matches in a row (true for every seed tested with 20 teams).
- The final tiebreaker is a seeded draw: hash(season seed, team id).
- Flavour cards: yellows are Poisson(1.7) per team per match, a red has a 5% chance per team, weighted towards defenders and CDMs.
- Assists are weighted CAM 5, wingers 4.5, CM and wide mids 3.5, strikers 2.5, full-backs 2, CDM 1.5, CB 0.6, GK 0.1, times (overall / 100) squared.
- Match ratings get normal noise with sd 0.4 and are rounded to one decimal.
- Injuries (off by default): after each match, each of the 11 has a 1% chance of missing the team's next 1 to 5 matches; the stand-in is "Reserve for <name>", rated 10 lower (minimum 40).
- Auto-pick takes the first queued player who is available and fits; otherwise the scarcest open slot (fewest fitting players left) gets the best player who fits it.
- Pack Pick uses the same order every round, like Linear.
- Awards based on ratings need 50% of matches played. The Golden Glove only considers goalkeepers. The Team of the Season tries every enabled formation. Reserves never win awards.
- Best Draft Steal and Biggest Flop compare pick number with performance rank (average rating) among drafted players.
- Draft grade: average of the scaled pre-season strength rank and the scaled final position, mapped to 13 bands from A+ to F. The Team Reveal preview uses the strength rank only.
- Pick tags: Steal or Reach when pick number and pool rank (by overall, ties share a rank) differ by at least max(3, 20% of the pick number).
- Engine team ids are strings: "h:<n>" for humans, "ai:<clubId>" for AI clubs. Reserve stats are keyed by team and slot.
- The sim CLI's random drafters pick randomly among the 6 best available players who fit, with a random formation.
- Observation for the owner: under the spec's rules, humans drafting from all 20 clubs win almost every title against AI clubs stripped of their stars (3 random drafters won about 99% of simulated titles). This follows the spec; it could be balanced later, for example by turning off remove-drafted-from-AI or with a club cap.

## M2: server foundation

- Passwords use bcrypt (bcryptjs, cost 12), capped at 72 characters because bcrypt ignores the rest.
- Usernames are 3 to 20 letters, numbers or underscores, stored lowercase, so they are unique regardless of case.
- Sessions live in a new `sessions` table (not in the spec's model): the cookie holds a random 32-byte token, the table stores its SHA-256 hash, and sessions last 30 days.
- A guest is a `users` row with `is_guest` set, no username and no password. Guests can create and join games but cannot be admins.
- ADMIN_USERNAME works even when registrations are closed. An admin cannot demote themself, so at least one admin always remains.
- Admin routes check the role in a hook for every `/api/admin` path, as well as in each handler.
- Join codes are 6 characters from an alphabet without 0, O, 1 and I.
- The host creates their own team as part of creating the game. Play Solo creates a private one-team game and starts it straight away.
- Bots count towards the game's maximum players and towards N, the number of drafting teams. "At least 1 human" means at least one non-bot team.
- Bots get a team name from a fixed list, a random colour, and 4-3-3 unless the host forces a formation.
- Team names are unique within a game regardless of case. The filter normalises look-alikes (0 to o, 1 to i, $ to s) and blocks a word that equals, starts with or ends with a listed term, so "Scunthorpe" stays allowed. The starter word list is editable in app_settings.
- Chat messages that trip the filter are masked with asterisks rather than rejected.
- Kicked players cannot rejoin that lobby. The list is kept in memory, so it resets if the server restarts.
- When the host leaves the lobby, hosting passes to the next human in pick order; if there is none, the game is cancelled.
- Any change to the lobby during the 5-second countdown (a join, a leave, a settings change, someone un-readying or changing formation) cancels the countdown and tells everyone why. The start is checked again when the countdown ends.
- The start-of-draft strength snapshot uses every active player at in-pool clubs with the default slot compatibility, so it matches `clubs.json`. The admin override for AI clubs arrives with the admin panel (M6).
- The game seed is a random integer from 1 to 2^31 - 1, generated by the server when the draft starts.
- Pool health counts, for each slot type, how many slots the teams' formations need and how many players fit. It also runs a maximum matching to check that every slot can be filled at once, since one player may fit two slot types. Teams without a formation are counted as 4-3-3, with a warning.
- With strict positions off, pool health checks only the total player count.
- Site settings are stored in app_settings as JSON, each with a zod schema and a default in code. Missing or invalid values fall back to the default. "No banner" is an empty string, because a JSON null becomes SQL NULL on Postgres.
- Socket.IO events carry the game id. Big changes (start, cancel, pick order, host transfer, forced formation) send every subscriber a fresh snapshot instead of an event.
- A participant shows as connected while at least one of their sockets is subscribed to the game. Everyone is marked offline when the server boots.
- Clients estimate the server clock offset from a `time:sync` round trip and compute countdowns from server deadlines.
- Database code is written once, against the SQLite types. On Postgres the same Drizzle calls run on the Postgres db and tables. SQLite transactions are serialised by a mutex and use BEGIN IMMEDIATE. Inside a transaction, code only queries through the transaction handle.
- The web app uses Barlow Condensed (headings) and Inter (body) from Google Fonts, falling back to system fonts.
- Light and dark mode: dark by default; the choice is remembered in localStorage.

## M3: draft

- Picks are checked in this order: draft running, player in the pool, player not taken, your turn, turn not moved on, slot exists and is empty, position fits, club cap, Pack Pick options. A taken player gives "Someone just drafted that player, pick another" and the turn stays with the picker.
- A pick is one transaction: insert the pick, then advance the game only if `current_pick_number` still equals the pick being made. Unique indexes on (game, player) and (game, pick number) back this up, so two simultaneous picks can never both succeed on either database.
- New columns (not in the spec's model): `games.paused_remaining_ms` (clock left while paused), `participants.rerolls_used` (Pack Pick) and `participants.auto_draft` ('bot' or 'autopick' while the server drafts for a human).
- Timers live in memory but the deadline is in `games.pick_deadline`; on boot the server re-arms every running draft from it. A deadline that already passed fires immediately.
- Timer expiry, Skip turn and End draft early all use the same auto-pick: queue first (first queued player who is available and fits), otherwise the best player for the open slot with the fewest fitting players left. These picks are flagged "auto". Bot picks are not flagged.
- Bots wait 1.5 seconds before picking (`BOT_PICK_DELAY_MS`). Easy takes one of the five best fitting players at random. Medium scores overall plus 4 times the chemistry the player would add. Hard adds a bonus for slot types where fewer than three fitting players remain per team that still needs one.
- Pack Pick options are seeded from the game seed, the pick number, the team and its reroll count, so a refresh shows the same five players. Each team gets 1 reroll per draft. Bots and auto-picks are not limited to the pack.
- With strict positions off, anyone can play any outfield slot (scored with the out-of-position penalty), but keepers only play in goal and outfielders never do.
- Disconnects: after 60 seconds offline (`DISCONNECT_GRACE_SECONDS`) during the draft, the host's choice applies: 'autopick' (default) or 'bot' (a Medium bot drafts for them). The choice is a game setting the host can change during the draft. Reconnecting hands the team back, including after "Replace with bot".
- Undo removes the last pick and puts that team back on the clock with a fresh timer. It also works after the draft completes, until the season starts.
- Pause stores the clock's remaining time and clears the deadline; Resume sets a new deadline from it. "+30 seconds" works while paused too.
- Host draft controls are also available to admins. All of them are written to the audit log.
- Admin setting `season.autoStart` (default off) starts the season 10 seconds after the draft completes.
- The kickoff screen is shown once at the top of the draft room until the user dismisses it (remembered per game for the browser session).
- Team Reveal's draft grade preview uses the team's strength rank among all 20 teams, as computed by the engine from the drafted XI.
- Socket subscribe and unsubscribe are processed one at a time per socket; otherwise a quick unsubscribe/subscribe pair (React StrictMode, hot reload) could leave a socket outside its game room.

## M4: season

- Starting the season (and Run It Back) first flips the game status in a conditional update, so a double click or the auto-start racing the host simulates only once. On failure the status is restored.
- Season 1 uses the game seed; Run It Back and Multi-season (2 to 10) use fresh random seeds and are numbered 2, 3 and so on. All seasons are kept and can be replayed.
- After the season, the game status is `completed`. Run It Back is allowed from `completed`.
- Human teams in the season use non-strict lineups, so a team whose drafted player was later deactivated still plays him.
- `season_teams.lineup` stores `{ slots: [...] }` with each slot's player id, name, overall, effective overall, club, nationality and flags, so old seasons render even if players change.
- Player season stats are stored only for real players; Academy Reserves appear in match events with no player id.
- Playback state is `{ seasonNumber, matchday, playing, speed, anchorAt }`. Clients compute the live matchday from it (4 seconds per matchday at 1x), so the server sends one event per host action rather than a tick per matchday. Instant jumps to matchday 38.
- In own-pace mode the same state lives only in each browser.
- Key Moments are computed when a season is read: hat-tricks, wins by 4 or more, upsets (a team at least six places lower in the previous matchday's table beating a top-five side), new leaders and human-versus-human games.
- Expected Strength runs 1,000 seasons in the server process on request and caches the result in memory per game.
- The League Teams page shows the latest season's teams once a season exists; during the draft it builds them from the current picks, with Academy Reserves in empty slots.
- Table colour bands use fixed defaults (1st, 2nd to 4th, 5th to 6th, 18th to 20th). Renaming or switching them off arrives with the admin settings (M6).

## M5: results and history

- Results are computed when read, from the stored season (stats, lineups, fixtures), so later admin edits to players never change a finished game.
- Award inputs come from stored stats; cards are not stored per player, so Biggest Flop and Best Draft Steal use average rating only.
- Draft grades use the team's strength rank within that season's 20 teams and its final position; pick tags compare pick number with the player's rank by overall in the current pool (drafted players who were later removed keep their stored overall).
- Head to head covers every pair of human teams in the chosen season.
- Profiles count every season (including Run It Back and multi-season) for titles, average finish and best grade; "games played" counts games that got past the lobby. The profile's game list shows the season 1 finish and grade.
- The Hall of Fame lists the season 1 champion of each finished game, newest first. The leaderboard ranks users by titles, then average finish, over every season, guests included.
- Record book: most points in a season, most goals by a player on a drafted team, best goal difference, across every season. Ties go to the earliest.
- Rematch creates a new lobby with the old settings and every team (name, colour, formation) copied over; humans start not ready, bots keep their level. Players in the old game get a "Join the rematch" button through a `game:rematch` event.
- Export is host or admin only: JSON (settings, seed, and per season the table, awards, grades and picks) or CSV (final table of every season).
- The share image is drawn on a canvas in the browser (1080 by 1350 PNG) with the fan game disclaimer; no logos or photos.
- Pitch slot positions are inset vertically so tokens with stat lines stay inside the pitch.

## M6: admin

- Admins can use every host control in every game (start, pause, skip, undo, kick, bots, pick order, playback, cancel); the lobby and draft pages show those controls to admins too.
- Every admin service method re-checks the admin role itself, on top of the route guard for `/api/admin/*`. All admin actions are audited.
- Players that were drafted or played in a season cannot be hard-deleted (the history needs them); the admin is told to deactivate them instead.
- Imports match rows by id when given, else by club and name (accents and case ignored). Any row error blocks the whole apply; the preview shows added, changed (field by field) and unchanged rows first. Imports never delete players.
- Duplicate detection groups players whose names match after removing accents, case and punctuation, across all clubs.
- Rebalance Club and bulk overall changes clamp to 40 to 99. Player edits refresh the cached `clubs.strength_rating`.
- Club strength override (`clubs.strength_override`) replaces the computed rating when ranking clubs and choosing AI teams; clearing it restores the computed value.
- AI club selection (setting `ai.selection`): top by strength (default), a manual list (topped up with the strongest clubs if it is short), or random from the game seed.
- Tiebreakers after points are an ordered list in the simulation parameters (goal difference, goals scored, head to head, wins); a seeded draw settles anything left. Settings saved before this existed keep the default order.
- Table colour bands (`table.bands`) can be renamed, recoloured, added, removed or switched off, and the season and results tables use them.
- Maintenance mode (`site.maintenance`) shows a red banner and stops non-admins creating games; announcements use the separate `site.banner`.
- Reset Draft deletes every pick and restarts from pick 1 with a fresh timer. Re-run Simulation deletes every season of the game and simulates season 1 again from the game seed (Change Seed sets it).
- Deleting a user removes the account, its sessions and chat messages; their teams in old games stay (with no user attached). Admins cannot ban, demote or delete themselves.
- The Simulation Lab runs one season or a Monte Carlo (10 to 1,000 seasons) for any even number of in-pool clubs (each plays its best XI) or for a game's 20 teams, with optional parameter overrides that are not saved. Test Draft makes a game with the admin's team plus bots, auto-drafts every pick and simulates the season.
- The first-visit walkthrough (4 cards) shows once per browser (remembered in localStorage) and can be replayed from How to Play; with no storage it is skipped rather than shown on every page.
- Sound is off by default and remembered per browser. The whistle (draft opens, season playback starts) and pick chime are synthesised with WebAudio, so there are no audio files.
- Reduced motion: a global `prefers-reduced-motion` rule shortens every animation and transition to near zero, which also stills the skeleton pulse and confetti.
- On phones (below the `lg` breakpoint) the player pool is a bottom sheet opened from a sticky button; tapping an empty slot opens it filtered to that slot, and drafting closes it. Position chips sit on top; the other filters are behind a Filters chip.
- Season playback on phones shows Results and Table as tabs; a horizontal swipe switches them.
- Render errors are caught by an error boundary around each page (cleared on navigation) plus a router-level fallback.
- The Docker image runs the server through tsx like `npm start`, so it keeps the full node_modules; there is no separate server compile step.
- The Playwright smoke test uses a throwaway SQLite file, `BOT_PICK_DELAY_MS=0` and `START_COUNTDOWN_SECONDS=0` so a full game runs in seconds; it is not part of `npm run check` because it needs a browser download.
- Club Spin (owner request, not in the spec): a game setting (`clubSpin`), on by default for new games; games created earlier keep drafting without it. Pack Pick ignores it.
- The spun club is derived from the game seed, pick number and team, so it is the same for every viewer and after a reload or undo (a re-spin, see below, is seeded the same way).
- The wheel only lands on clubs that still have an undrafted player who fits one of the team's open slots (and is under the club cap), so a legal pick always exists.
- Each Club Spin turn gets 3 extra seconds on the pick clock, and bots wait for the reel too: twice `BOT_PICK_DELAY_MS`, at most 3 seconds (so the default 1.5s bots wait the full 3s and instant bots do not wait).
- Drafted players are locked into the slot they were drafted into; there is no way to move them (the server never allowed it, and tapping a filled slot does nothing).
- The footer carries the owner's credit line "made by reyansh pathak" under the disclaimer.
- Skip to the end: the season page has a "Skip to the end" button in the header and controls. In synchronized playback the host's skip moves everyone; other viewers get "Skip to end (just me)", which jumps only their own screen, with "Back to live" to rejoin. The reveal page also has "Simulate to the end", which starts the season already on the final table.
- Rounds (owner request): a round is exactly two seasons. Run It Back and multi-season are retired (the endpoint answers 409); Play again starts the next round instead.
- The mid-season window opens after matchday 19 of each season, the big window after season 1. A season's first half is stored on its own (season status `simulating`, 19 tables) with the squads it was played with; when the window closes the whole season is re-simulated with the new squads from matchday 20 and replaces it. Matchdays 1-19 come out identical because every random draw is keyed by matchday and teams.
- Transfers: 2 per team in each mid-season window, 4 in the summer window; trades are unlimited and free. The new player must be on no drafted team, fit the same slot and respect the club cap; with "remove drafted from AI" on, he leaves his AI club.
- Trades: one player for one, after the draft and in every window, both teams must accept. Positions stay locked, so each player takes the other's slot and must fit it. Offers lapse when a phase ends or a player in them moves.
- Bots in windows: they are marked done as soon as a window opens, but only make their transfers when it closes, after every human has had the chance to sign players. They upgrade their weakest slots with the best free players left who fit, up to the window's limit, taking turns one transfer at a time so no single bot takes every star. Bots answer trade offers at once: they accept when the player they get is rated at least as high as the one they give.
- A window closes when every human team marks itself done, or when the host closes it.
- Player price (millions) = max(1, round(5 × 1.155^(overall − 70))), from the overall rating, the only rating in data/: about 1M at 60, 5M at 70, 21M at 80, 103M at 91.
- Window budget = 10M (mid-season) or 20M (summer) + 0.5M per league point won so far in that season; it is not carried over. A transfer costs the new player's price minus the sold player's price.
- Bots buy only players they can afford with their window budget.
- (Replaced) Windows no longer close on a 3-minute timer; see the own-pace lines below.
- Captain: +3 overall (max 99) in every match. Teams without a captain before season 1 get their highest rated player. A captain who is transferred or traded away is replaced by the incoming player.
- Re-spin: one per team per draft, on its own turn, only when the wheel landed on a club and another club is possible. The re-spin never lands on the same club, restarts the pick clock, and is fixed by seed like the first spin.
- Golden spin: 5% of spins (fixed by seed); the team may draft from any club. Bots and auto-picks then choose freely.
- Game leaderboard: per series (a game and every Play again after it). One point per completed round to the team with the most league points over its two seasons (goal difference breaks ties; still level, both get a point). Bots are on it, keyed by team name; humans by account.
- Play again keeps the series and the teams; Restart makes the same lobby but a new series with an empty leaderboard. Asking twice returns the same next lobby.
- Season stat leaders (goals, assists, clean sheets, average rating with at least 10 appearances) are shown after each season and as half-season stats at the mid-season break, from the stored player stats.
- Rivalries: a profile lists head-to-head records against every other signed-in or guest manager whose drafted team met yours in a finished season, across all games.
- Hall of Fame, records, profiles and results only count finished seasons (38 matchdays).
- Club spin plays full-screen over the draft room (dark backdrop, large reel, club name in big letters), then stays as a compact card with the re-spin button; tap Continue, tap the backdrop or press Escape to close it early.
- The spin reel starts on a short timer rather than requestAnimationFrame, which pauses in background tabs.
- Layout is checked at 375 (phone), 768 (tablet) and 1280 (laptop) wide: no page may scroll sideways or push content past its card; lists inside cards use `grid-cols-1` so long rows shrink instead of overflowing.
- Draft room player list shows only players you can draft (not taken, and fitting one of your open slots); the "Hide drafted" and "Fits my open slots" toggles are gone. Spectators still see every undrafted player.
- Every listed player has a green Draft button (disabled until your turn). If he fits exactly one open slot (or the slot you tapped), it drafts at once; if he fits several, it asks where he should play.
- Lists inside a grid use `grid-cols-1`: an implicit grid column grows to its widest line, which on phones made the browser zoom the whole page out.
- Season playback is always own-pace: each player plays, pauses, speeds up or skips on their own screen. The host no longer drives everyone's playback, and the playback setting is gone.
- When a player's screen reaches the break, it reports "watched". The transfer window opens (transfers, trades, I'm done) only when every connected human has watched; until then they see who they are waiting for.
- A window closes only when every connected human drafting team has pressed I'm done (at least one must). Offline players are not waited for. Bots are done at once. An admin can force a window closed.
- Stats boards: most goals, most assists, and clean sheets per team (team names, not keepers). The best-rating board is gone.
- (Replaced, see Season form below) AI clubs were pulled toward the AI average rating (`aiSpread` 0.4). In a 200-season Monte Carlo, PSG's title chance went from 76% (no pull) to 31%, with Real Madrid at 18% and the best drafted team at 11%.
- Data updated to the 22 Nov 2026 squads: 609 players. New strength order: PSG, Real Madrid, Bayern, Barcelona, Arsenal, Man City, Liverpool, Inter, Atlético, Man United, Chelsea, Dortmund, Juventus, Tottenham, AC Milan, Aston Villa, Newcastle, Brighton, Al-Nassr, Inter Miami.
- The seed deactivates players no longer in the files (never deletes them, since picks and history reference them). Otherwise a transferred player would be draftable at both clubs. A player who returns to the files stays inactive until an admin reactivates him.
- The server re-seeds on boot when a hash of `data/` differs from `app_settings.dataVersion`, so deploying new files updates the live database without a manual seed. Admin edits survive restarts and are overwritten only when new files ship.
- Season form replaces the AI-only tweaks. Every team, human or AI, gets one seeded swing for the season (normal, standard deviation `form` = 2 rating points) added to attack and defense, like the good and bad years real clubs have. The same rules apply to everyone; the best team is the favourite but not a certainty.
- `aiSpread` now defaults to 1 and `aiCatchUp` to 0 (both off). They stay as admin and Lab settings, along with `form`.
- Tuned with sensitivity 0.09 (unchanged, so the live database's stored settings need no migration). Averages over Monte Carlo runs:
  - Champion 86 points, bottom team 24, 2.77 goals per match.
  - Normal league: the favourite wins about 17% of titles.
  - One clearly best (all-star) team: wins about 62%, down from 95%.
  - Three all-star drafts: win 86% between them (they are the three best teams), with the favourite at 40%.
- The PSG complaint is covered by form too: PSG's title chance is 11% to 19% depending on the draft.
- Realistic retune (simulation tuning version 2), measured over 4 league types, 3 drafts each and 120 seasons each:
  - New defaults: baseGoals 1.15, homeAdvantage 1.3, sensitivity 0.07, form 2, streaks 1.5 (each matchday keeps 85% of the last), sharedGoals 0.3.
  - Champion 85 points, bottom team 22, 2.83 goals per match, 45% home wins, 25% draws.
  - Top-5 vs bottom-5: the underdog wins 15% and draws 21%.
  - Favourite's title chance: 25% to 44%.
  - Before the retune: draws 21%, home wins 42%, and a clearly best team won about 50%.
- Shared goals: both sides get Poisson(shared) goals added and their own expected goals reduced by the same amount. This is the standard bivariate Poisson fix for too few draws in independent-Poisson models.
- Stored simulation parameters still at the old defaults (1.25, 1.1, 0.09, aiSpread 0.4, aiCatchUp 0.8) are moved to the new defaults once on boot. The version is kept in `app_settings` under `simulation.tuningVersion`, so an admin who picks an old value later keeps it.
- "Balanced" difficulty (simulation tuning version 3), chosen by the owner after "too hard to win":
  - Changes: aiSpread 0.5, sensitivity 0.08, form 1.25, streaks 1. The rest of version 2 stays.
  - Solo good draft: title 18% → 46%, top four 59% → 81%.
  - Solo casual draft: title 5% → 13%, top four 24% → 40%.
  - Two good drafts: one of them wins 42% → 72%.
  - League: champion 79 points, bottom team 27, 2.74 goals per match, 45% home wins, 27% draws.
- Less randomness alone barely helped: a decent solo draft ranked 2nd to 10th behind PSG, Real and Bayern. The fix was to weaken the super-clubs.
- The tuning upgrade now maps every earlier default (version 1 or 2) of each tuned key to the current one.
