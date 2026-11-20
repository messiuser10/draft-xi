# Draft XI League

A multiplayer web game: friends each draft a starting XI of real footballers from 20 clubs, then
the app simulates a 38-matchday league season against AI-controlled clubs. See [SPEC.md](SPEC.md)
for the full design and [DECISIONS.md](DECISIONS.md) for choices the spec left open.

Unofficial fan game, not affiliated with any club, league or player.

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Monorepo, TypeScript, lint, tests, database schema and migrations, seed and data validation | Done |
| M1 | Engine: formations, ratings, AI lineups, fixtures, match and season simulation, Monte Carlo, awards, draft grades, `npm run sim` | Done |
| M2 | Server foundation: accounts, guests, admin roles, lobby, host controls, Socket.IO, start-game flow; web app with home, sign-in, create, lobby and kickoff | Done |
| M3 | Draft room, pick validation, timers, auto-pick, bots | Next |
| M4 to M7 | Season, results, admin, polish | Not started |

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
| `npm run dev` | Runs the API server (http://127.0.0.1:3000, restarts on change) and the web app (http://localhost:5173, proxies `/api` and `/socket.io` to the server) together. Open http://localhost:5173. The server migrates the database on boot and seeds it from `data/` if it is empty. |
| `npm run build` | Builds the web app into `apps/web/dist`. |
| `npm start` | Production mode: one process serves the API, Socket.IO and the built web app on `PORT`. Run `npm run build` first. |
| `npm run data:validate` | Checks `data/` against the data rules (618 players, 20 known clubs, at least 22 players and 2 GKs per club, valid positions, ratings 40 to 99, no duplicate names within a club). Exits 1 on errors. |
| `npm run seed` | Applies migrations, validates `data/`, then loads clubs and players into the database. Idempotent: run it as often as you like. |
| `npm run sim -- --humans 3 --seed 42` | Random-drafts N human teams, adds the (20 - N) strongest clubs, simulates a season and prints the table, awards and draft grades. Add `--monte-carlo 1000` for expected strength, `--seasons 5` for a titles table, `--injuries`, `--no-chemistry`, `--keep-drafted`, or override `--base-goals`, `--home-advantage`, `--sensitivity`, `--chaos`. |
| `npm run db:migrate` | Applies pending migrations only. |
| `npm run db:generate` | After changing a schema in `apps/server/src/db/schema/`, generates new SQLite and Postgres migrations. |
| `npm test` | Runs all Vitest tests (engine and server, including the Postgres tests on in-process PGlite). |
| `npm run typecheck` | TypeScript strict checks for every workspace. |
| `npm run lint` | ESLint with type-aware rules. |
| `npm run check` | typecheck, lint and test in one go. |

## Environment variables

Copy `.env.example` to `.env` to override defaults. Real environment variables take precedence.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `file:var/draft-xi.db` | `postgres://` or `postgresql://` URL selects Postgres. Anything else is a SQLite file path (optional `file:` prefix), resolved from the repo root. `:memory:` gives a throwaway database. |
| `NODE_ENV` | `development` | `production` serves the built web app, trusts the proxy's `X-Forwarded-*` headers and turns on secure cookies. `test` is used by the test suite. |
| `HOST` | `127.0.0.1` | Interface the server listens on. Use `0.0.0.0` in a container. |
| `PORT` | `3000` | Server port. |
| `ADMIN_USERNAME` | (none) | Whoever registers with this username becomes an admin (even if registrations are closed). Admins can promote other users. |
| `COOKIE_SECURE` | `true` in production, else `false` | Send the session cookie only over HTTPS. Set `false` to test a production build over plain HTTP. |
| `START_COUNTDOWN_SECONDS` | `5` | Countdown between the host pressing Start and the draft opening. |
| `WEB_DIST` | `apps/web/dist` in production | Folder of built web assets the server serves. |
| `VITE_API_TARGET` | `http://127.0.0.1:3000` | Development only: where the Vite dev server proxies API and socket requests. |

## Project layout

```
packages/engine     Pure, deterministic game logic, no I/O: positions and formations, AI lineups,
                    ratings and club strength, fixtures, match and season sim, Monte Carlo,
                    draft order and auto-pick, awards, draft grades
apps/server         Fastify API, Socket.IO, database, data loading
  src/contracts.ts  Zod input schemas and response types shared with the web app
  src/auth/         Accounts, guest sessions, roles
  src/games/        Game lifecycle: lobby, host controls, start flow
  src/http/         Fastify app and routes (/api/auth, /api/games, /api/admin)
  src/realtime/     Socket.IO: per-game rooms, snapshots and events
  src/settings/     Site settings (app_settings table) and the team-name filter
  src/db/           One query API over SQLite and Postgres (database.ts) and both schemas
  drizzle/          Generated migrations: sqlite/ and pg/
  src/data/         Reading, validating and seeding the data files
apps/web            React + Vite + Tailwind web app: home, sign-in, create, solo, lobby, kickoff
data/               Owner-supplied seed data: players.seed.json, players.csv, clubs.json
scripts/            CLI entry points: seed, validate-data, migrate, sim
```

## Data

`data/` holds the owner-supplied files (EA SPORTS FC 27 launch ratings). They are the only source
of players and clubs; nothing is generated.

- `players.seed.json` is what gets seeded, because it carries `alt_positions`.
- `players.csv` must describe the same players. Any difference is reported as a warning.
- `clubs.json` provides club names, colours and leagues. Its `strength_rating` is cross-checked
  against the engine's own calculation (they match exactly); the seed stores the computed value.

To change the data, edit the files, run `npm run data:validate`, then `npm run seed`. The seed
matches clubs by name and players by club plus name. It inserts new rows, updates changed ones
and leaves identical ones alone. Players removed from the files are listed in the output but
not deleted, because drafts and season history may still reference them.

## Simulation defaults

| Parameter | Default | Note |
| --- | --- | --- |
| base_goals | 1.25 | Spec suggested 1.35; tuned down for 2.6 to 2.9 goals per match |
| home_advantage | 1.10 | |
| sensitivity | 0.09 | Spec suggested 0.05; tuned up so champions reach 80 to 95 points |
| chaos | 0.5 | |
| out_of_position_penalty | 8 | |
| chemistry | on | |
| injuries | off | |
| points | 3, 1, 0 | |

With these, a 3-human league averages about 87 points for the champion, 29 for the bottom team
and 2.76 goals per match (see the realism tests in `packages/engine/test/montecarlo.test.ts`).

## Database

SQLite (via better-sqlite3) is the default. Postgres works too: set `DATABASE_URL` to a
`postgres://` URL and run `npm run seed`. The two schemas are kept identical by a parity test,
and the seed tests run against both.

## API and realtime

All input is validated with zod (`apps/server/src/contracts.ts`); errors come back as
`{ "error": { "code", "message", "issues"? } }`. Sessions are an httpOnly `dxl_session` cookie
(30 days); only a SHA-256 hash of the token is stored. Login, register and guest are rate
limited to 20 requests per minute per IP.

Socket.IO clients send `game:subscribe` with a join code and receive a full `game:snapshot`,
then small `game:event`s. A client that reconnects subscribes again and gets a fresh snapshot.
Anyone with the code can watch; the cookie, if present, identifies the viewer.

## Deploy

```bash
npm install
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=3000 ADMIN_USERNAME=yourname npm start
```

Put it behind an HTTPS proxy (cookies are `Secure` in production). Docker files arrive in M7.
