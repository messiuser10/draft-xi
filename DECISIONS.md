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
- Rows no longer in the files are reported by the seed but never deleted or deactivated, since picks and history may reference them.
- The seed only writes data from the files; `is_active`, `is_injured`, `source_note`, `in_pool` and `notes` belong to admins and are never overwritten.
- `full_name` and `display_name` both start as the EA name, which is already a display name (for example "Vini Jr.").
- `users.username` is nullable (guests have none) and unique.
- `participants.team_name` is nullable (spectators) and unique per game at the database level; case-insensitive checks come in M2.
- Integrity constraints beyond the spec: one pick per (participant, slot), one participant per (game, user), and a CHECK that overall is 40 to 99.
- `audit_log` stores `actor_user_id` (nullable FK), an `actor` text snapshot and an optional `game_id`, so entries survive user deletion and can be filtered by game.
- `seasons.status` is one of pending, simulating, completed or failed; `seasons.created_at` is added for history ordering.
- `apps/web` is not scaffolded yet; it arrives with M2, when there is a server to talk to.
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
