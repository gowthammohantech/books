# Configuration

All configuration lives in a single file: **`docker/.env`**.

```bash
cp docker/.env.example docker/.env
# then edit docker/.env
```

`docker/.env` is gitignored — your secrets are never committed to the repository.

---

## The One-File Rule

The entire stack (API, web, database) reads from `docker/.env`. Do not split
configuration across multiple files or set environment variables in the shell —
the compose command always passes `--env-file docker/.env` so only that file
is read.

---

## Rebuild vs Restart

This is the most important operational rule in Elixir Books:

| Variable type | Examples | How to apply a change |
|---|---|---|
| **Runtime** (backend) | `JWT_SECRET`, `DATABASE_URL`, `SMTP_*`, `AI_ENCRYPTION_KEY`, `SEED_ON_BOOT`, `PORT` | `make rebuild-api` (or `make up` for a full stack restart) |
| **Build-time** (frontend) | `VITE_DEMO_MODE`, `VITE_API_BASE_URL` | `make rebuild-web` — the Vite build bakes these values into the JavaScript bundle at image build time; restarting the container without rebuilding has no effect |

---

## Environment Variable Reference

### API — Runtime Variables

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `NODE_ENV` | Yes | — | Node environment. Set to `production`. | `production` |
| `PORT` | No | `3001` | Port the API listens on inside the container. Do not change unless you have a conflict inside the container network. | `3001` |
| `JWT_SECRET` | Yes | — | Signs authentication tokens. Generate with `openssl rand -hex 32`. Rotating this value invalidates all active sessions. | `a1b2c3...` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. The hostname must be `postgres` (the compose service name). The password must match `POSTGRES_PASSWORD`. | `postgresql://elixirbooks:yourpass@postgres:5432/elixirbooks?schema=public` |
| `SEED_ON_BOOT` | No | `true` | When `true`, runs the idempotent baseline seed on every container start. Safe to leave `true`. Set to `false` after the first successful boot for marginally faster restarts. | `false` |

### API — AI / BYOK Variables (Runtime)

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `AI_ENCRYPTION_KEY` | Recommended | Derived from `JWT_SECRET` | 32-byte hex key (AES-256-GCM) used to encrypt stored BYOK provider API keys at rest. Generate with `openssl rand -hex 32`. **Must be unique per install.** If absent, the app derives a key from `JWT_SECRET` with a warning — set this explicitly so encrypted keys survive `JWT_SECRET` rotations. | `deadbeef...` (64 hex chars) |
| `AI_MAX_CALLS_PER_DAY` | No | `200` | Per-user daily AI call quota. Blank uses the default of 200. | `100` |
| `ANTHROPIC_API_KEY` | No | — | Server-level Anthropic (Claude) API key. Optional — also configurable per-user in-app as BYOK under Settings → AI. | `sk-ant-...` |
| `OPENAI_API_KEY` | No | — | Server-level OpenAI API key. Optional — also configurable per-user in-app as BYOK. | `sk-...` |

### API — SMTP Variables (Runtime)

SMTP configuration in `docker/.env` is the fallback mail path. Once you
configure email settings through the admin UI (Settings → Email Settings),
the UI-saved settings take precedence. See [integrations.md](integrations.md)
for details.

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `SMTP_HOST` | No | `smtp.gmail.com` | SMTP server hostname | `smtp.mailgun.org` |
| `SMTP_PORT` | No | `465` | SMTP port | `587` |
| `SMTP_USER` | No | — | SMTP username / login | `user@example.com` |
| `SMTP_PASS` | No | — | SMTP password | `app-password` |
| `SMTP_FROM` | No | — | Sender address shown on outgoing mail | `Elixir Books <billing@example.com>` |

### API — Integration Variables (Runtime)

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `WHATSAPPCRM_API_KEY` | No | — | Shared secret for server-to-server requests from the WhatsApp CRM external service. When unset the `/api/external/*` endpoints return 503. | `a-long-random-string` |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection URL, used only when the `redis` profile is active (`make up-redis`). | `redis://redis:6379` |

### PostgreSQL Variables (Runtime)

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `POSTGRES_USER` | Yes | `elixirbooks` | Database username. Must match the user in `DATABASE_URL`. | `elixirbooks` |
| `POSTGRES_PASSWORD` | Yes | — | Database password. **Change this.** Must match the password in `DATABASE_URL`. | `str0ng-unique-pass` |
| `POSTGRES_DB` | Yes | `elixirbooks` | Database name. Must match the database in `DATABASE_URL`. | `elixirbooks` |

### Web / Frontend Variables

These are **build-time** — changing them requires `make rebuild-web`.

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `WEB_PORT` | No | `8080` | Host port the web container binds. This is a runtime compose variable (not baked into the image) — changing it does not require a rebuild, only a restart. | `80` |
| `VITE_DEMO_MODE` | No | `false` | When `true`, pre-fills the login form with the demo credentials and shows a demo banner. Set to `false` for production. **BUILD-TIME.** | `false` |
| `VITE_API_BASE_URL` | No | `` (empty) | Base URL for API calls. **Leave empty** in almost all cases — the web container's nginx proxies `/api` to the API container, so relative calls work on any domain with no CORS setup. Only set this to an absolute URL (e.g. `https://api.yourdomain.com`) if you host the API on a different domain from the web app. **BUILD-TIME.** | `` |

### Optional Services

| Variable | Used by | Purpose |
|---|---|---|
| `REDIS_URL` | `worker` container (redis profile) | Queue URL for the async worker |
| `MONGO_URI` | `mongo` service (mongo profile) | Legacy. The app does not require MongoDB. Only uncomment if you have a specific need. |
| `MONGO_INITDB_ROOT_USERNAME` | `mongo` service | Mongo root user |
| `MONGO_INITDB_ROOT_PASSWORD` | `mongo` service | Mongo root password |
| `MONGO_INITDB_DATABASE` | `mongo` service | Mongo initial database |

---

## Applying Changes

### Backend (runtime) variable changed

```bash
make rebuild-api
# Rebuilds and restarts the api container. Also re-runs prisma migrate deploy.
```

Or if you changed only non-image-affecting runtime env vars and want a faster
restart without a full image rebuild:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d api
```

### Frontend (build-time) variable changed

```bash
make rebuild-web
# Rebuilds the web image (runs the Vite build with the new env values) and restarts.
```

### Full stack restart (e.g. after a `git pull`)

```bash
make up
# Rebuilds any changed images and restarts all containers.
```

---

## Compose Services

The stack defines these services in `docker/docker-compose.yml`:

| Service | Always starts | Profile | Notes |
|---|---|---|---|
| `postgres` | Yes | — | PostgreSQL 16. Data persisted in `elixirbooks-pg-data` volume. |
| `api` | Yes | — | Node.js 20 API. Uploads persisted in `elixirbooks-uploads` volume. |
| `web` | Yes | — | nginx serving the React SPA + proxying `/api` and `/uploads` to `api`. |
| `redis` | No | `redis` | Start with `make up-redis`. |
| `worker` | No | `redis` | Async job worker (same image as `api`). Starts alongside Redis. |
| `mongo` | No | `mongo` | Legacy. Start with `docker compose --profile mongo up -d`. |

Docker volumes created by the stack:

| Volume | Contents |
|---|---|
| `elixirbooks_elixirbooks-pg-data` | All PostgreSQL data |
| `elixirbooks_elixirbooks-uploads` | Invoice logos, expense receipt attachments, company logos |
| `elixirbooks_elixirbooks-redis-data` | Redis persistence (redis profile only) |
| `elixirbooks_elixirbooks-mongo-data` | MongoDB data (mongo profile only) |
