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
| M3 | Draft room: snake, linear and Pack Pick modes, pick validation in transactions, server timers, auto-pick, queue, bots, host controls, disconnect handling, Team Reveal | Done |
| M4 | Season: stored simulation, synchronized or own-pace playback, matchday results, live table, match ticker, key moments, League Teams, Run It Back, multi-season, Expected Strength (Monte Carlo) | Done |
| M5 | Results: awards, draft grades and pick tags, team pages, head to head, share text and image, export, rematch, profiles, Hall of Fame, leaderboard, record book | Done |
| M6 | Admin panel: overview and data health, players (search, inline and bulk edit, import and export with diff preview, duplicates, rebalance), clubs (colours, pool, strength override, custom clubs, AI preview), games, settings, Simulation Lab and Test Draft, users, audit log, announcements | Done |
| Rounds | Two seasons per round; mini transfer window after matchday 19 (1 transfer), big window between seasons (3); trades between teams (both accept); captain (+3); one re-spin per draft; golden spins (any club); game leaderboard (1 point per round won); Play again / Restart; season stat leaders; head-to-head rivalries on profiles | Done |
| Club Spin | Before every pick a reel lands on a club and the team on the clock must draft from it (game setting, on by default, not used with Pack Pick); drafted players stay locked in their slot. `GET /api/games/:code/spin` | Done |
| M7 | Polish: How to Play and first-visit walkthrough, error boundary and skeleton loaders, sound toggle, phone draft room (bottom-sheet pool, filter chips) and swipeable season tabs, accessibility, Docker and docker-compose, Playwright smoke test | Done |

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
| `npm run test:e2e` | Playwright smoke test: builds the web app, starts the production server on port 3100 (`E2E_PORT`) with a fresh `var/e2e.db` and instant bots, then in Chromium signs in as a guest, creates a game, adds bots, lets bots draft every pick, starts the season and plays it to the results page. First time only: `npx playwright install chromium`. |

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
| `BOT_PICK_DELAY_MS` | `1500` | How long a bot (or a team on auto-draft) waits before picking. |
| `DISCONNECT_GRACE_SECONDS` | `60` | How long a human can be offline during the draft before the host's choice (auto-pick or bot) applies. |
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
  src/games/        Lobby and start flow (service.ts), the draft (draft.ts), seasons and playback (season.ts)
  src/http/         Fastify app and routes (/api/auth, /api/games, /api/admin)
  src/realtime/     Socket.IO: per-game rooms, snapshots and events
  src/settings/     Site settings (app_settings table) and the team-name filter
  src/db/           One query API over SQLite and Postgres (database.ts) and both schemas
  drizzle/          Generated migrations: sqlite/ and pg/
  src/data/         Reading, validating and seeding the data files
apps/web            React + Vite + Tailwind web app: home, sign-in, create, solo, lobby, draft room,
                    team reveal, season playback, League Teams
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

Main endpoints (all under `/api`):

| Area | Endpoints |
| --- | --- |
| Pool | `GET /pool` (clubs and every draftable player) |
| Draft | `POST /games/:code/picks` `{ playerId, slotKey }`, `PUT /games/:code/queue` `{ playerIds }`, `GET /games/:code/pack`, `POST /games/:code/pack/reroll` |
| Host draft controls | `POST /games/:code/draft/{pause,resume,skip,undo,extend,end,bot,disconnect-policy}` |
| Results | `GET /games/:code/results?season=n`, `GET /games/:code/teams/:teamId?season=n`, `GET /games/:code/export?format=json\|csv` (host), `POST /games/:code/rematch` `{ mode: 'next' \| 'restart' }` (host, once the round is over) |
| Rounds | `GET /games/:code/round`, `PUT /games/:code/captain` `{ playerId }`, `POST /games/:code/transfers` `{ slotKey, playerId }`, `POST /games/:code/trades` `{ toParticipantId, offerPlayerId, requestPlayerId }`, `POST /games/:code/trades/:id` `{ action: accept\|decline\|cancel }`, `POST /games/:code/window/ready` `{ ready }`, `POST /games/:code/window/close` (host), `GET /games/:code/leaderboard`, `POST /games/:code/spin/respin` |
| Admin (admin role only, re-checked on every request) | `GET /admin/overview`; `GET,POST /admin/players`, `PATCH,DELETE /admin/players/:id`, `POST /admin/players/bulk`, `GET /admin/players/export?format=`, `POST /admin/players/import/{preview,apply}`, `GET /admin/players/duplicates`; `GET,POST /admin/clubs`, `PATCH /admin/clubs/:id`, `POST /admin/clubs/:id/rebalance`, `GET /admin/clubs/ranking?humans=`; `GET /admin/games`, `POST /admin/games/:code/{reset-draft,rerun,seed}`, `DELETE /admin/games/:code`; `GET /admin/settings`, `PUT /admin/settings/:key`; `POST /admin/lab/run`, `POST /admin/lab/test-draft`; `GET /admin/users`, `PATCH /admin/users/:id/role`, `POST /admin/users/:id/ban`, `GET /admin/users/:id/games`, `DELETE /admin/users/:id`; `GET /admin/audit?actor=&action=&game=&from=&to=&format=`; `PUT /admin/announcement` |
| History | `GET /profile`, `GET /users/:id/profile`, `GET /hall-of-fame`, `GET /leaderboard`, `GET /records` |
| Season | `POST /games/:code/season` (start), `POST /games/:code/seasons` (retired: answers 409, rounds replace Run It Back), `GET /games/:code/seasons`, `GET /games/:code/seasons/:n`, `GET /games/:code/league`, `GET /games/:code/montecarlo?runs=1000`, `POST /games/:code/playback` `{ action, speed?, matchday?, seasonNumber? }` |

With Club Spin on, the wheel's club for each turn comes from `GET /games/:code/spin`; picks from any other club are refused with `wrong_club`, and auto-picks and bots draft from it too.

A round runs: draft → pre-season (captain, trades) → season 1 matchdays 1-19 → mini window → matchdays 20-38 → big window → season 2 the same way → round over. The snapshot's `round` field carries the phase, every team's current XI, captains, trades and window progress; `seasons[].matchdays` is 19 while a season's second half is not played yet, and playback is capped there (`playback.cap`).

Pick timers are stored in the database (`games.pick_deadline`) and re-armed when the server
starts, so a restart mid-draft keeps the clock.

## Deploy

```bash
npm install
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=3000 ADMIN_USERNAME=yourname npm start
```

Put it behind an HTTPS proxy (cookies are `Secure` in production).

### Docker

The `Dockerfile` builds the web app and runs the production server (API, Socket.IO and web app
on port 3000). On its own it uses SQLite in the `/app/var` volume:

```bash
docker build -t draft-xi .
docker run -p 3000:3000 -v draftxi-data:/app/var -e ADMIN_USERNAME=yourname -e COOKIE_SECURE=false draft-xi
```

`docker-compose.yml` runs the app with Postgres 17:

```bash
ADMIN_USERNAME=yourname docker compose up --build
```

Then open http://localhost:3000. Compose reads `ADMIN_USERNAME`, `POSTGRES_PASSWORD` (default
`draftxi`, change it outside local use), `PORT` (host port, default 3000) and `COOKIE_SECURE`
(default `false` for plain http on localhost; set `true` behind HTTPS). The database is migrated
and seeded from `data/` on first boot.
