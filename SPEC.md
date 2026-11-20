# Draft XI League: Build Spec for Claude Code

A multiplayer web game. Friends each draft a starting XI of real footballers from 20 clubs into a formation. When everyone has finished, the app simulates a full 38-matchday Premier League style season where the human-drafted teams compete against AI-controlled top clubs.

---

## 0. Working agreements (read first)

1. Read this whole spec before writing code. Then propose a short plan for M0 and M1 and wait for approval. After that, continue through all milestones (section 13) without stopping, unless a decision cannot be undone.
2. Build milestone by milestone. After each one: typecheck, lint, run all tests, fix failures, and commit with a message like `M2: auth, lobby and realtime`.
3. All game rules live in one pure TypeScript package (`packages/engine`) with no I/O. The server is authoritative: it validates every pick and runs every simulation. The web app may import the engine only for previews.
4. Never silently invent data. If you are unsure about a player's current club, position or rating, put a note in `source_note` so the owner can review it. If you have web search, use it to check current 2026/27 squads. If not, use your own knowledge and flag uncertain rows.
5. Record any choice this spec leaves open in `DECISIONS.md`, one line each. Do not stop to ask about reversible choices.
6. Keep a `README.md` with install, run, test, seed, deploy instructions and every environment variable.
7. Validate all inputs with zod. Check roles on the server for every admin and host action. Never commit secrets.

---

## 1. Product overview and core rules

The player pool is limited to players currently (2026/27 season) at these 20 clubs: Real Madrid, FC Barcelona, Manchester United, Liverpool, Paris Saint-Germain, Bayern Munich, Manchester City, Arsenal, Chelsea, Tottenham Hotspur, Atletico Madrid, Juventus, Borussia Dortmund, AC Milan, Inter Milan, Aston Villa, Inter Miami, Newcastle United, Al-Nassr, Brighton and Hove Albion.

Rules, all enforced on the server:

1. N is the number of human players in a game. Minimum 1, default maximum 8 (admin-configurable), hard cap 20.
2. Each human drafts exactly 11 players who fit a chosen formation. Every player is placed in a slot that matches one of his listed positions. No mismatches by default.
3. The draft is turn-based. A player can be drafted by only one human per game.
4. The league always has exactly 20 teams: N human teams plus (20 minus N) AI clubs. The AI clubs are the strongest (20 minus N) of the 20 real clubs by pre-draft squad strength. Example: 3 humans means the 17 strongest clubs plus the 3 human teams. 1 human means 19 AI clubs plus that human.
5. The pool always includes all 20 clubs, even those that miss the league. A human can draft a star from a club that is not in the league.
6. By default, drafted players are removed from their real club's squad, so an AI club that loses its star plays without him. This is an admin toggle.
7. The season is a double round robin: 38 matchdays, 380 matches, fully deterministic from a stored seed.
8. Roles: Admin (app administrator), Host (creator of a game), Player, and Spectator (anyone with the game code).

---

## 2. Tech stack and repo layout

Use TypeScript everywhere (strict mode), npm workspaces.

```
/
  packages/engine     pure game logic: formations, ratings, AI lineups, fixtures, match sim, season sim, Monte Carlo, awards, draft grades. Vitest tests.
  apps/server         Fastify + Socket.IO, Drizzle ORM, SQLite via better-sqlite3 (schema must also work on Postgres via DATABASE_URL), zod, argon2 or bcrypt.
  apps/web            React + Vite + Tailwind CSS, React Router, TanStack Query, socket.io-client, Zustand for local UI state.
  data/               clubs.json, players.seed.json (editable seed data)
  scripts/            seed, data validation, simulation CLI
  Dockerfile, docker-compose.yml, README.md, DECISIONS.md
```

Scripts to provide: `npm run dev` (server and web together), `npm test`, `npm run typecheck`, `npm run lint`, `npm run seed`, `npm run data:validate`, and `npm run sim -- --humans 3 --seed 42` (a CLI that builds teams with random drafts, simulates a season and prints the table, used to tune realism). The production build serves the web assets from the server in one process.

Realtime: Socket.IO rooms per game. On connect or reconnect, the server pushes a full authoritative game snapshot, then small events. The server owns all timers: store `pick_deadline` in the database, rebuild timers on boot, and have clients compute countdowns from the server deadline plus a clock offset.

Auth: username and password with an httpOnly cookie session, plus guest sessions (just a display name) so friends can join from an invite link. A user whose username equals the `ADMIN_USERNAME` environment variable becomes admin on registration, and admins can promote others.

---

## 3. Data model

Tables (Drizzle schema, with migrations):

- **users:** id, username (unique), password_hash (nullable for guests), display_name, role (admin or user), is_guest, banned, created_at.
- **clubs:** id, name, short_name, country, league_name, primary_color, secondary_color, strength_rating (computed and cached), in_pool, notes.
- **players:** id, club_id, full_name, display_name, primary_position, alt_positions (JSON), overall (40 to 99), nationality, is_active, is_injured, source_note, updated_at. There are no per-attribute stats (pace, shooting and so on) and no ages: overall rating is the only number.
- **games:** id, join_code (6 characters, unique), name, host_user_id, status (lobby, drafting, paused, draft_complete, simulating, completed, cancelled), settings (JSON snapshot), seed, current_pick_number, current_participant_id, pick_deadline, strength_snapshot (JSON), ai_club_ids (JSON), playback_state (JSON), created_at.
- **participants:** id, game_id, user_id, team_name (unique per game), color, monogram, formation, pick_order, is_ready, is_bot, bot_level, is_connected, is_spectator.
- **draft_picks:** id, game_id, participant_id, pick_number, round, player_id, slot_key, auto_picked, created_at. Unique on (game_id, player_id) and on (game_id, pick_number).
- **queue_items:** participant_id, player_id, sort_order.
- **seasons:** id, game_id, season_number, seed, status, parameters_snapshot (JSON), champion_season_team_id.
- **season_teams:** id, season_id, kind (human or ai), participant_id or club_id, name, primary_color, secondary_color, lineup (JSON slot to player id), formation, attack_rating, defense_rating, chemistry_bonus.
- **fixtures:** id, season_id, matchday, home_team_id, away_team_id, home_goals, away_goals.
- **match_events:** id, fixture_id, minute, type (goal, assist, yellow, red), player_id, season_team_id.
- **standing_rows:** season_id, matchday, season_team_id, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, position, form (last 5). One row per team per matchday so playback works.
- **player_season_stats:** season_id, player_id, season_team_id, appearances, goals, assists, clean_sheets, yellows, reds, rating_sum, avg_rating.
- **app_settings:** key and JSON value. **audit_log:** actor, action, target, details, created_at. **chat_messages:** game_id, user_id, body, created_at.

---

## 4. Positions, slots and formations

Positions: GK, RB, CB, LB, RWB, LWB, CDM, CM, CAM, RM, LM, RW, LW, CF, ST. Each formation slot accepts specific player positions. Store this map in app_settings so the admin can edit it.

| Slot | Accepts players listed as |
| --- | --- |
| GK | GK |
| RB | RB, RWB |
| LB | LB, LWB |
| CB | CB |
| RWB | RWB, RB |
| LWB | LWB, LB |
| CDM | CDM, CM |
| CM | CM, CDM, CAM |
| CAM | CAM, CM |
| RM | RM, RW |
| LM | LM, LW |
| RW | RW, RM |
| LW | LW, LM |
| ST | ST, CF |

Formations (each is 11 slots with x and y pitch coordinates): 4-3-3, 4-4-2, 4-2-3-1, 4-1-4-1, 4-3-2-1, 4-4-1-1, 3-5-2, 3-4-3, 5-3-2, 5-4-1. The admin can enable or disable each.

---

## 5. Seed data and data tooling

- **Supplied data, do not regenerate it.** The owner provides three files in `data/`: `players.csv` (columns club, name, position, overall, nationality), `players.seed.json` (`{source, players:[{club, name, primary_position, alt_positions, overall, nationality}]}`) and `clubs.json` (name, short_name, country, league_name, primary_color, secondary_color, squad_size, best_formation, best_xi_average, strength_rating, strength_rank). They hold 618 players across exactly these 20 club names: Real Madrid, FC Barcelona, Manchester United, Liverpool, Paris Saint-Germain, Bayern Munich, Manchester City, Arsenal, Chelsea, Tottenham Hotspur, Atletico Madrid (written Atlético Madrid), Juventus, Borussia Dortmund, AC Milan, Inter Milan, Aston Villa, Inter Miami, Newcastle United, Al-Nassr, Brighton and Hove Albion. `npm run seed` loads them (idempotent). Source: EA SPORTS FC 27 launch ratings, so names are EA's display names and ratings are game ratings.
- Positions in the data: GK, CB, LB, RB, CDM, CM, CAM, LM, RM, LW, RW, ST (no CF, LWB or RWB appear, but the engine must still support them). `alt_positions` was derived from the slot compatibility map in section 4.
- Expected club strength order (best first): PSG, Real Madrid, Arsenal, Bayern Munich, Manchester City, Barcelona, Liverpool, Inter Milan, Atletico Madrid, Manchester United, Chelsea, Dortmund, AC Milan, Juventus, Tottenham, Aston Villa, Newcastle, Brighton, Al-Nassr, Inter Miami. A test must confirm the engine's own strength calculation reproduces this order. For N=3 humans the AI clubs are the first 17.
- `npm run data:validate` fails on: total rows not equal to 618, a club with fewer than 2 GKs or fewer than 22 players, duplicate names within a club, invalid positions, ratings out of range, or an unknown club.
- Club strength rating: the average overall of the club's best XI in its best-fitting formation, plus 0.1 per rated player beyond the XI (cap +1.5). Recompute whenever players change.
- Admin can import and export players as CSV or JSON with a downloadable template. Imports show a diff (added, removed, changed) and apply only after confirmation.
- Branding rule: no official club crests, league logos or player photos anywhere. Show clubs as monogram shields in their two colors and players as a flag plus initials avatar. Footer: unofficial fan game, not affiliated with any club, league or player.

---

## 6. Accounts and home page

- Home page: hero with the app name, then Create Game, Join with Code, Play Solo vs AI (a one-click game with N=1; the 19 AI clubs are added automatically), How to Play, a list of public open lobbies, and a Hall of Fame strip of recent champions.
- Creating or joining requires either an account or a guest session. Anyone can spectate by code.
- Create Game form (defaults from app_settings): game name, visibility (private by code or public), maximum humans, draft mode (Snake, Linear, Pack Pick), pick timer, formation rule (each chooses their own, or host forces one), maximum players from one club per team (off by default), strict position matching (on by default), remove drafted players from AI squads (on by default), bots allowed, playback mode (synchronized or own pace).

---

## 7. Lobby and starting the game

Join flow: enter the code or tap a public lobby, choose a team name (3 to 24 characters, unique in the game, profanity filtered), color, monogram and formation. Players can change these until the draft starts.

Lobby screen (live):

- Participant list with avatars, team names, ready toggles, connection dots and a crown on the host.
- Invite panel: code, copy link, QR code.
- Settings summary the host can edit until start.
- Pick order: Randomize (animated shuffle) or manual drag by the host, locked at start.
- Host controls: add a bot (Easy, Medium, Hard), kick, transfer host, cancel game.
- Pool health indicator, comparing available players per position with N times the formation slots. Show a warning such as not enough goalkeepers for this many teams.
- League preview: the number of AI clubs that will join (20 minus N), chosen by strength when the draft starts.
- Lightweight chat.

Start Game (host only, re-validated on the server):

1. Enabled when at least 1 human is present, all humans are ready (host can force start), every human has a formation, and the pool health check passes.
2. Show a 5-second countdown to everyone.
3. The server then freezes pick order, saves `strength_snapshot` of all 20 clubs from the full pre-draft squads, selects the (20 minus N) strongest clubs as `ai_club_ids` (admin can override), stores the seed, and sets status to drafting.
4. Show a kickoff screen listing the AI clubs that made it, the clubs that did not (their players remain draftable), and the human teams.

Reconnection: all state is in the database, so a refresh restores the exact screen. If a human disconnects for more than 60 seconds during the draft, the host chooses whether a bot takes over or the team auto-picks.

Optional pass-and-play mode: one shared device, hot-seat turns with a hand the device to NAME screen between turns.

---

## 8. The draft

Draft modes:

- **Snake (default):** round 1 goes 1 to N, round 2 goes N to 1, and so on for 11 rounds. Total picks are 11 times N.
- **Linear:** same order every round.
- **Pack Pick:** each turn the player sees 5 random available players who fit their open slots and picks one. Each player gets 1 reroll per draft.

Screen layout:

- Top bar: game name, Round X of 11, pick number, who is on the clock with a countdown ring, and a Paused banner.
- Pick order strip showing the current round and the next rounds greyed out.
- Center: a pitch with the user's formation. Filled slots show a badge with overall and surname. Live team rating and chemistry meter underneath.
- Pool: a searchable, sortable list or grid with filters for club (all 20), position, overall range, nationality, plus a Show only players who fit my open slots toggle. Drafted players stay visible but greyed out with the taker's team tag.
- Tabs: Rivals (every other team's pitch, live), Activity feed, Queue, Chat.

How a pick works:

1. The user selects an open slot (which filters the pool) or selects a player first (which highlights fitting slots; one fitting slot means one-tap placement).
2. The server checks: game is drafting and not paused, it is this user's turn, the player is available, the slot is empty and compatible, any club cap is respected.
3. In one transaction it writes the pick, advances the turn and sets the new deadline. If two clients race for the same player, exactly one wins and the other gets a clear message and keeps their turn.
4. All screens update with a pick-reveal animation and a toast.

Formation lock: chosen before the draft and locked after the first pick. If the host forces a formation, everyone uses it.

Timer and auto-pick: default 60 seconds (admin range 15 to 180, or off), pulsing warning at 10 seconds. On expiry the server auto-picks: first from the user's Queue if available and fitting, otherwise the highest-overall available player who fits an open slot, preferring the scarcest open position. Auto-picks are flagged in the feed. The host can pause and resume, which freezes the timer for everyone.

Queue: users star players into an ordered wish list. A player taken by someone else is crossed out live.

Player detail panel: name, club monogram, positions, nationality, overall, and Compare (two players side by side). Rating tiers by color and label: Elite (88 and above), Gold (82 to 87), Silver (75 to 81), Bronze (below 75). Use generic styling, not any existing game's card design.

Bots: Easy picks the best available fit with some randomness. Medium weighs positional need and club chemistry. Hard also reaches for scarce positions early. Bots pick after a human-feeling delay.

Host and admin controls in the draft: pause or resume, skip turn (triggers auto-pick), undo last pick (audit logged), extend timer, replace a player with a bot, end the draft early (remaining slots auto-fill).

Draft end: after pick 11 times N, set status to draft_complete and show a Team Reveal: each team's XI revealed one at a time with team rating, chemistry, draft grade preview, and a ranked league preview of all 20 teams with humans highlighted. The host presses Start Season, or the admin setting auto-starts it after 10 seconds.

---

## 9. Simulation engine (`packages/engine`)

All functions are pure and deterministic given a seed. Use a seeded PRNG (for example mulberry32) and derive each match's seed from the game seed, matchday, home team id and away team id.

**Step 1, build the 20 teams.** One season team per human (their drafted XI) and one per AI club in `ai_club_ids`, always totaling 20. Because the AI clubs come from the pre-draft snapshot, drafting stars away never changes which clubs get in.

**Step 2, pick each AI club's XI.** If remove-drafted-players is on, use the club's remaining players. Try every enabled formation, assign players to slots to maximize total overall under the compatibility map, and keep the best. If a slot has no compatible player, use the best remaining outfield player with an out-of-position penalty (default minus 8 overall). If the club has nobody left, use a generic Academy Reserve rated 62. Label reserves and out-of-position players in the UI.

**Step 3, rate every team identically** (humans and AI use the same rules):

| Slot | Attack weight | Defense weight |
| --- | --- | --- |
| GK | 0 | 1.6 |
| CB | 0.1 | 1.0 |
| LB, RB, LWB, RWB | 0.35 | 0.7 |
| CDM | 0.2 | 0.8 |
| CM | 0.5 | 0.5 |
| CAM | 0.8 | 0.2 |
| LM, RM | 0.7 | 0.3 |
| LW, RW | 0.9 | 0.1 |
| ST | 1.0 | 0 |

Attack rating is the weighted average of overall using attack weights; defense rating is the same with defense weights. Then add the chemistry bonus (admin toggle, default on) to both: 0.25 per pair of teammates from the same real club (capped at +2.0 total) plus 0.1 per pair with the same nationality (capped at +1.0).

**Step 4, fixtures.** Shuffle the 20 teams with the seed. Use the circle method for 19 matchdays (each team plays once per matchday), then mirror them with home and away swapped, for 38 matchdays and 380 matches. Make sure no team has more than 2 home or 2 away matches in a row.

**Step 5, simulate each match.** Let league_att and league_def be the league-wide average ratings.

- Home expected goals = base_goals x home_advantage x exp(sensitivity x ((home attack minus league_att) minus (away defense minus league_def))).
- Away expected goals = base_goals x exp(sensitivity x ((away attack minus league_att) minus (home defense minus league_def))).
- Multiply each by a log-normal random factor with sigma = chaos x 0.2, clamp to 0.15 to 4.5, then draw goals from a Poisson distribution.

| Parameter (admin-editable) | Default |
| --- | --- |
| base_goals | 1.35 |
| home_advantage | 1.10 |
| sensitivity | 0.05 |
| chaos (0 to 1) | 0.5 |
| out_of_position_penalty | 8 |
| chemistry | on |
| injuries | off |
| points for win, draw, loss | 3, 1, 0 |

If injuries are on, each player has a 1 percent chance per match of missing the next 1 to 5 matches, replaced by a generic reserve rated 10 below that player.

**Step 6, events and stats.** For each goal pick a minute (1 to 94) and a scorer weighted by position (ST and CF 10, wingers 6, CAM 5, wide mids 4.5, CM 2.5, CDM 1, fullbacks 1, CB 0.8, GK 0.02) times (overall divided by 100) squared. Give an assist to a teammate 75 percent of the time, weighted toward CAM, wingers and CM. Add flavor yellow and red cards (no effect on results). Credit a clean sheet to the GK and defenders when the opponent scores 0. Match rating per player: 6.0 base, plus 1.0 per goal, 0.6 per assist, 0.3 for a win, 0.6 for a clean sheet (GK and defenders), plus seeded noise of about 0.4, clamped to 4.0 to 10.0.

**Step 7, table.** Points 3, 1, 0. Tiebreakers in order: goal difference, goals scored, head-to-head points, then a seeded random draw. Store a standings snapshot after every matchday.

**Extra engine functions:** Monte Carlo (simulate 1,000 seasons and return per-team average points, average position, title chance, top-4 chance and bottom-3 chance), multi-season runs, awards, and draft grades (section 10). Unit-test the invariants: 380 fixtures, each team plays every opponent twice, 19 home and 19 away each, points equal 3 times wins plus draws, total goals for equal total goals against, same seed gives identical output, and different seeds differ.

---

## 10. Season playback, results, awards and history

The server runs `simulate_season` once when the host starts the season and saves everything. The UI then plays it back so it feels live:

- Controls: Play, Pause, speeds 1x, 2x, 5x, Instant, jump to any matchday, skip to the end.
- Matchday view: all 10 results as cards with scorers, human teams highlighted. Live league table beside it with position-change arrows and a form guide.
- Key Moments feed: hat-tricks, 4-goal margins, upsets (a team at least 6 places lower beating a top-5 side), new league leaders, human-versus-human fixtures.
- Click any fixture for a minute-by-minute match ticker built from stored events.
- Synchronized mode: the host controls playback via `games.playback_state` and every screen follows. Own-pace mode: each player controls their own view.
- Run It Back (same teams, new seed, kept in history), Multi-season (2 to 10 seasons with a cumulative titles table), and Monte Carlo (labeled Expected Strength, shown as a table and bar chart).
- League Teams page, available after the draft starts: all 20 teams ranked by strength with attack, defense, chemistry and Human or AI tags, linking to each team's XI.

Season Complete screen:

- Final table with color bands (admin can rename or switch off): 1st gold, 2nd to 4th top four, 5th to 6th next tier, 18th to 20th bottom three. Human teams carry a badge. Champion gets a trophy icon and a confetti moment.
- Awards: Champion, Golden Boot, Playmaker (assists), Golden Glove (clean sheets), Player of the Season (highest average rating), Team of the Season (best XI by average rating on a pitch), Best Draft Steal (most outperformed his draft position) and Biggest Flop.
- Draft grades: each human gets a letter grade A+ to F from pre-season strength rank among the 20 and actual finish. Each pick gets a Steal, Fair or Reach tag comparing pick number to the player's overall rank in the pool.
- Team pages (human and AI): XI on a pitch with each player's goals, assists, clean sheets and rating, form timeline, home and away splits, biggest win, longest unbeaten run, top scorer.
- Head to head for every pair of humans.
- Share: Copy Summary (plain text) and Download Image (season card).
- Host actions: Run It Back, Rematch (new lobby, same people, fresh draft), Export Results (JSON and CSV).

Profiles and history: profile with games played, titles, average finish, best draft grade and a trophy cabinet. Hall of Fame of completed games. Global leaderboard by titles then average finish. Record book (most points in a season, most goals by a drafted player, best goal difference). Reopen and replay any finished game.

---

## 11. Admin panel (/admin)

Only role admin can open it, and every admin endpoint re-checks the role on the server. Log every admin and host action to audit_log.

1. **Overview:** counts of users, active lobbies, drafts in progress, seasons simulated, players; recent activity; data health warnings.
2. **Players:** searchable, filterable table with inline edit, add, deactivate, delete, bulk edit, CSV and JSON import and export with diff preview, duplicate detection, and a Rebalance Club tool (add or subtract N overall for a whole club).
3. **Clubs:** edit colors and monograms, toggle in_pool, override strength, add custom clubs beyond the original 20, and a live strength ranking showing which clubs would become AI teams for a chosen N (slider 1 to 20).
4. **Games:** list every game with status, host, player count and age. Actions: open as spectator, force start, pause or resume, skip turn, undo last pick, reassign pick order, kick or replace with a bot, extend timer, reset draft, force complete, re-run simulation, change seed, export, delete.
5. **Settings:** league name, maximum humans (up to 20), default timer and allowed range, default draft mode, enabled formations, position compatibility map editor, club cap, strict positions, remove-drafted-from-AI toggle, AI club selection method (top by strength, manual list, or random), every simulation parameter from section 9, points system, tiebreaker order, table color bands, auto-start season, public lobbies on or off, registrations open or closed, profanity word list, maintenance banner.
6. **Simulation Lab:** pick any 20 teams or load a game, set a seed and parameters, run a season or a 1,000-season Monte Carlo, and see distributions of goals per match, home win rate and points spread to tune realism. Include a one-click Test Draft that creates a game with bot drafters, fast-forwards the whole draft and simulates the season.
7. **Users:** list, search, promote or demote admin, ban or unban, view a user's games, delete a user's data.
8. **Audit Log:** filter by actor, action, game and date, with CSV export.
9. **Announcements:** set or clear a site-wide banner.

Host powers inside their own game (no admin role needed): edit settings until the draft starts, randomize or edit pick order, add or remove bots, kick, start, pause, resume, skip a turn, undo the last pick, start the season, control synchronized playback, cancel.

---

## 12. UI and design

- Dark matchday theme: near-black navy backgrounds, pitch-green accent, crisp white text, gold for winners. Bold condensed display font for headings and scores, clean sans-serif for body. Cards with soft shadows and rounded corners.
- The pitch graphic has subtle mowing stripes and clean white markings. Player tokens are circular badges showing overall, with a ring in the club's primary color and the position label underneath. Rating tiers use distinct colors plus a text label so color is never the only signal.
- Routes: `/`, `/how-to-play`, `/login`, `/lobby/:code`, `/draft/:code`, `/reveal/:code`, `/season/:code`, `/results/:code`, `/league/:code`, `/team/:code/:teamId`, `/profile`, `/hall-of-fame`, `/leaderboard`, `/admin/*`.
- Mobile first. The draft room must work on a phone: sticky on-the-clock bar, collapsible pitch, pool in a bottom sheet with filter chips, large tap targets. Season playback gets a compact layout with the table and results as swipeable tabs.
- Motion: pick-reveal card flip, countdown ring that turns red under 10 seconds, confetti for the champion, position-change arrows, toasts for key events. Optional sound toggle (whistle, pick chime), off by default. Respect reduced motion.
- Quality: skeleton loaders, friendly empty states, clear errors (for example, Someone just drafted that player, pick another), a connection indicator, light and dark toggle (dark default), accessible contrast, keyboard navigation in the pool, and a short How to Play walkthrough on first visit.

---

## 13. Milestones

- **M0, scaffold and data:** monorepo, TypeScript, lint, test runner, Drizzle schema and migrations, `data/` seed files, `npm run seed`, `npm run data:validate`.
- **M1, engine:** sections 4 and 9 complete with unit tests and the `npm run sim` CLI. Tune the parameters so a 3-human game gives realistic tables (champion usually 80 to 95 points, bottom team usually 20 to 40, around 2.6 to 2.9 goals per match).
- **M2, server foundation:** auth (accounts, guests, admin), game lifecycle, lobby, Socket.IO snapshots and events, start-game flow with strength snapshot and AI club selection.
- **M3, draft:** all draft modes, pick validation with transactions, server timers, auto-pick, queue, bots, host controls, team reveal. Integration tests for races, out-of-turn picks, wrong-slot picks and timer expiry.
- **M4, season:** persist the simulation, playback state, matchday and table views, match tickers, League Teams page, Run It Back, multi-season, Monte Carlo.
- **M5, results:** awards, draft grades, team pages, head to head, share image and text, profiles, Hall of Fame, leaderboard, record book.
- **M6, admin:** every admin tab and the audit log, with server-side role checks tested.
- **M7, polish:** mobile layouts, motion, accessibility, How to Play, error states, Dockerfile and docker-compose, README, a Playwright smoke test that creates a game, bot-drafts it and plays a season.

---

## 14. Acceptance checklist

- [ ] All 20 clubs exist, each with at least 22 players including at least 2 goalkeepers.
- [ ] A solo game (N=1) creates a 20-team league: 19 AI clubs plus the human team.
- [ ] A 3-player game creates 17 AI clubs plus 3 human teams and 380 fixtures over 38 matchdays.
- [ ] A 20-player game works with 0 AI clubs and the pool health check passes.
- [ ] Two users cannot draft the same player, even when they click at the same instant.
- [ ] A pick out of turn is rejected by the server.
- [ ] A striker in the goalkeeper slot is rejected, and a left-back cannot fill a CB slot.
- [ ] Timer expiry auto-picks a legal player, using the queue first.
- [ ] Pausing freezes the timer for everyone and resuming restores the remaining time.
- [ ] Refreshing mid-draft restores the exact state.
- [ ] A disconnected player is replaced by a bot or auto-picks, per the host's choice.
- [ ] Duplicate team names in one game are rejected.
- [ ] The pool health warning appears when a position is short for N teams.
- [ ] With remove-drafted-players on, a drafted star never appears in an AI club's XI and that AI club still fields 11 players.
- [ ] The same seed gives identical results; a different seed gives different ones.
- [ ] Every team's points equal 3 times wins plus draws, and total goals for equal total goals against.
- [ ] Every team plays 38 matches, 19 at home and 19 away, and plays every opponent twice.
- [ ] Monte Carlo (1,000 seasons) finishes and gives plausible title chances: the strongest teams win most often, but upsets still happen.
- [ ] A normal user who opens /admin or calls an admin endpoint directly is refused.
- [ ] The draft room and season playback are usable on a phone-sized screen.
- [ ] No official club logos or player photos are used, and the unofficial fan game footer is present.
- [ ] `npm test`, `npm run typecheck` and `npm run lint` all pass.

---

## 15. Stretch ideas (only after everything above works)

A 5-player bench with substitutions, a transfer window where humans can trade before the season, a salary-cap draft mode with player market values, a domestic cup with knockout rounds, multi-season careers with player aging, achievements and badges, a live spectator view with emoji reactions, and an optional Refresh squad with AI admin button that calls the Anthropic API when `ANTHROPIC_API_KEY` is set (always with a diff preview before applying).
