# Running Elixir Books for Development

The stack is three parts:

| Part | Path | Tech |
|---|---|---|
| Datastore | (container) | PostgreSQL 16 + Prisma |
| API | `apps/api/` | Express 5 + TypeScript (ts-node in dev, compiled `dist/` in prod), port `3001` |
| SPA | `apps/web/` | React 19 + Vite, port `3000` |

The app runs entirely on Postgres/Prisma — it is the sole datastore.

## Prerequisites

- Node.js 20+ (images build on Node 20; Node 22 works locally)
- npm 10+
- Docker (with Compose v2)
- GNU Make + a POSIX shell for the `make` targets (Git Bash on Windows)

---

## Option A — Hot-reload dev (recommended for day-to-day work)

### 1. Start Postgres

The compose `postgres` service does not publish a host port, so run a standalone
container for host-side development:

```bash
docker run -d --name elixirbooks-pg -p 5432:5432 \
  -e POSTGRES_USER=elixirbooks \
  -e POSTGRES_PASSWORD=elixirbooks \
  -e POSTGRES_DB=elixirbooks \
  -v elixirbooks-dev-pg:/var/lib/postgresql/data \
  postgres:16-alpine
```

PowerShell equivalent (backtick continuations):

```powershell
docker run -d --name elixirbooks-pg -p 5432:5432 `
  -e POSTGRES_USER=elixirbooks -e POSTGRES_PASSWORD=elixirbooks -e POSTGRES_DB=elixirbooks `
  -v elixirbooks-dev-pg:/var/lib/postgresql/data postgres:16-alpine
```

### 2. Backend env

Create `apps/api/.env` (gitignored):

```env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://elixirbooks:elixirbooks@localhost:5432/elixirbooks?schema=public
JWT_SECRET=dev-secret-change-me
```

Generate a real secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Run the API

```bash
cd apps/api
npm install          # not `npm ci` — the lockfile is out of sync with package.json
npm run prisma:generate
npm run dev          # nodemon → ts-node server.ts → http://localhost:3001
```

First boot handles all schema and data setup itself. The bootstrap in
`server.ts` runs, in order:

1. `prisma migrate deploy`
2. baseline seed (currencies, date/time formats, timezones, module hierarchy, custom-field types)
3. legacy Customer/Supplier → Contact backfill + account-credit role backfill
4. Country/State geo dataset import

Every step is idempotent and non-fatal — a failure logs a warning and the server
still starts. Skip them individually with `MIGRATE_ON_BOOT=false`,
`SEED_ON_BOOT=false`, `BACKFILL_ON_BOOT=false`, `GEO_ON_BOOT=false`.

Health check: <http://localhost:3001/api/healthz>

### 4. Frontend env

Create `apps/web/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:3001
VITE_DEMO_MODE=false
```

`VITE_API_BASE_URL` is **not optional** in local dev. `src/constants/api.ts` does
`BASE_URL + "/api"` with no fallback, so leaving it unset produces literal
`undefined/api` request URLs. No trailing slash.

### 5. Run the SPA

```bash
cd apps/web
npm install
npm run dev          # Vite → http://localhost:3000
```

Port `3000` is already in the API's CORS allowlist (along with `5173` and `8080`),
so no extra config is needed. Add more origins via `CORS_ORIGINS` (comma-separated)
or `FRONTEND_URL` in the backend `.env`.

### 6. First run

Open <http://localhost:3000>.

- A fresh database shows the **admin registration** form. That endpoint closes
  permanently once the first admin exists — further users come from the Users
  section of the admin UI.
- Complete company setup, then **Settings → Finance Settings → Ledger Setup** to
  pick a country pack (IN / EU / UK / US / AU / NZ). Financial statements stay
  empty until this is done.

See `documentation/first-run.md` for the full walkthrough.

---

## Option B — Full Docker stack (prod-shaped)

Use this to verify the real build, nginx proxying, and the container entrypoint.

```bash
cp docker/.env.example docker/.env
# edit docker/.env — set JWT_SECRET and POSTGRES_PASSWORD
# (the password must match the one embedded in DATABASE_URL)
make up
make smoke
```

Open <http://localhost:8080>.

Here nginx proxies `/api` to `api:3001`, so `VITE_API_BASE_URL` stays **empty** in
`docker/.env` — the SPA calls a relative `/api`.

**Caveat for development:** the frontend is compiled into the nginx image, so there
is no hot reload in this stack. Rebuild after changes:

| Command | Effect |
|---|---|
| `make rebuild-web` | Rebuild + restart only the web container (frontend changes) |
| `make rebuild-api` | Rebuild + restart only the api container (backend changes + migrations) |
| `make up-dev` | API-only hot reload — binds backend source, runs nodemon (`docker/docker-compose.override.yml`). Frontend still needs a rebuild. |

Other targets:

| Command | Effect |
|---|---|
| `make up` | Start lean stack (web, api, postgres) |
| `make up-redis` | Start with Redis + async worker |
| `make logs` | Tail api + web logs |
| `make ps` | `docker compose ps` |
| `make seed` | Run the Postgres baseline seed inside the api container |
| `make smoke` | End-to-end smoke test (`scripts/smoke.sh`) |
| `make down` | Stop containers, keep volumes |
| `make down-clean` | ⚠️ Stop containers **and destroy volumes/data** |

---

## Checks before pushing

Run in either repo:

```bash
npm run typecheck    # backend only
npm run lint
npm test             # vitest
```

---

## Gotchas

- **Don't mix Options A and B against one database.** The compose Postgres lives on
  a different named volume from the standalone dev container.
- **`npm install`, not `npm ci`** in the backend — the committed lockfile is out of
  sync with `package.json` (the Dockerfile does the same).
- **The Redis worker is an opt-in compose profile.** `make up-redis` starts it.
- **Vite env vars are build-time.** Changing `VITE_*` requires restarting the dev
  server (Option A) or rebuilding the web image (Option B).
- To point a host-side API at the *compose* Postgres instead of a standalone
  container, add `ports: ["5432:5432"]` to the `postgres` service and use
  `localhost:5432` in `DATABASE_URL`.
- Uploads live in the `elixirbooks-uploads` volume (Option B) or `./uploads`
  (Option A, gitignored).
