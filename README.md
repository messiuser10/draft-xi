# Draft XI League

A multiplayer web game: friends each draft a starting XI of real footballers from 20 clubs, then
the app simulates a 38-matchday league season against AI-controlled clubs. See [SPEC.md](SPEC.md)
for the full design and [DECISIONS.md](DECISIONS.md) for choices the spec left open.

Unofficial fan game, not affiliated with any club, league or player.

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Monorepo, TypeScript, lint, tests, database schema and migrations, seed and data validation | Done |
| M1 | Engine: formations, ratings, fixtures, match and season simulation, `npm run sim` | Next |
| M2 to M7 | Server, draft, season, results, admin, polish | Not started |

## Requirements

- Node.js 24 LTS (see `.nvmrc`) and npm 11.
- Nothing else for local development: the default database is a SQLite file.

If Node was installed to `~/.local/node` (no system install), put it on your PATH first:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
```

## Install

```bash
npm install
```

## Common commands

| Command | What it does |
| --- | --- |
| `npm run data:validate` | Checks `data/` against the data rules (618 players, 20 known clubs, at least 22 players and 2 GKs per club, valid positions, ratings 40 to 99, no duplicate names within a club). Exits 1 on errors. |
| `npm run seed` | Applies migrations, validates `data/`, then loads clubs and players into the database. Idempotent: run it as often as you like. |
| `npm run db:migrate` | Applies pending migrations only. |
| `npm run db:generate` | After changing a schema in `apps/server/src/db/schema/`, generates new SQLite and Postgres migrations. |
| `npm test` | Runs all Vitest tests (engine and server, including the Postgres tests on in-process PGlite). |
| `npm run typecheck` | TypeScript strict checks for every workspace. |
| `npm run lint` | ESLint with type-aware rules. |
| `npm run check` | typecheck, lint and test in one go. |

Coming in later milestones: `npm run dev` (server and web together, M2) and
`npm run sim -- --humans 3 --seed 42` (season simulation CLI, M1).

## Environment variables

Copy `.env.example` to `.env` to override defaults. Real environment variables take precedence.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `file:var/draft-xi.db` | `postgres://` or `postgresql://` URL selects Postgres. Anything else is a SQLite file path (optional `file:` prefix), resolved from the repo root. `:memory:` gives a throwaway database. |

## Project layout

```
packages/engine     Pure game logic, no I/O (positions so far; the simulation engine arrives in M1)
apps/server         Database schema, migrations, data loading (API and realtime arrive in M2)
  src/db/schema/    sqlite.ts and pg.ts: the same 16 tables for each dialect
  drizzle/          Generated migrations: sqlite/ and pg/
  src/data/         Reading, validating and seeding the data files
data/               Owner-supplied seed data: players.seed.json, players.csv, clubs.json
scripts/            CLI entry points: seed, validate-data, migrate
```

## Data

`data/` holds the owner-supplied files (EA SPORTS FC 27 launch ratings). They are the only source
of players and clubs; nothing is generated.

- `players.seed.json` is what gets seeded, because it carries `alt_positions`.
- `players.csv` must describe the same players. Any difference is reported as a warning.
- `clubs.json` provides club names, colours and leagues.

To change the data, edit the files, run `npm run data:validate`, then `npm run seed`. The seed
matches clubs by name and players by club plus name. It inserts new rows, updates changed ones
and leaves identical ones alone. Players removed from the files are listed in the output but
not deleted, because drafts and season history may still reference them.

## Database

SQLite (via better-sqlite3) is the default. Postgres works too: set `DATABASE_URL` to a
`postgres://` URL and run `npm run seed`. The two schemas are kept identical by a parity test,
and the seed tests run against both.

## Deploy

Docker and production build instructions arrive in M7.
