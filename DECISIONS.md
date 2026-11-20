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
- `clubs.strength_rating` is seeded from `clubs.json` for now; M1 replaces it with the engine's own calculation.
- `users.username` is nullable (guests have none) and unique.
- `participants.team_name` is nullable (spectators) and unique per game at the database level; case-insensitive checks come in M2.
- Integrity constraints beyond the spec: one pick per (participant, slot), one participant per (game, user), and a CHECK that overall is 40 to 99.
- `audit_log` stores `actor_user_id` (nullable FK), an `actor` text snapshot and an optional `game_id`, so entries survive user deletion and can be filtered by game.
- `seasons.status` is one of pending, simulating, completed or failed; `seasons.created_at` is added for history ordering.
- `apps/web` is not scaffolded yet; it arrives with M2, when there is a server to talk to.
- `npm audit` reports 4 moderate advisories, all one esbuild dev-server issue inside drizzle-kit's dev-only toolchain. It is not reachable because we never run esbuild's server; revisit when drizzle-kit updates.
