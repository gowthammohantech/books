# Elixir Books — Production Deployment Guide

This guide deploys the full Elixir Books stack (API + web + PostgreSQL) with Docker
Compose. PostgreSQL is the only datastore; Redis is optional and off by
default.

---

## 1. Prerequisites

- A Linux server (2 vCPU / 4 GB RAM is a comfortable start) with:
  - **Docker Engine** + the **Docker Compose plugin** (`docker compose`, not the
    legacy `docker-compose`).
  - Ports **80/443** reachable (for the web app + TLS).
- The repository checked out with its layout intact (the compose build contexts
  are relative — do not rearrange):
  ```
  elixirbooks/
  ├── docker/                       # compose files + .env
  ├── apps/api/
  └── apps/web/
  ```
  Run `make` targets from the repository root.

---

## 2. Configuration — the `docker/.env` file

The **entire stack reads one file: `docker/.env`** (it is gitignored, so your
secrets are never committed). `docker/.env.example` is the template.

```bash
cd elixirbooks
cp docker/.env.example docker/.env
```

Then edit `docker/.env` and set, at minimum:

| Variable | What to set | How |
|---|---|---|
| `NODE_ENV` | `production` | |
| `JWT_SECRET` | a long random string | `openssl rand -hex 32` |
| `AI_ENCRYPTION_KEY` | a fresh 32-byte hex key | `openssl rand -hex 32` — **must be unique per install**; encrypts stored API keys |
| `POSTGRES_PASSWORD` | a strong unique password | and put the **same** password inside `DATABASE_URL` |
| `DATABASE_URL` | `postgresql://elixirbooks:<password>@postgres:5432/elixirbooks?schema=public` | host stays `postgres` (the compose service name) |
| `SMTP_*` | your real mail provider | needed for invoice emails / reminders |
| `VITE_DEMO_MODE` | `false` | demo banners off |
| `VITE_API_BASE_URL` | **leave empty** | see note below |
| `WEB_PORT` | `8080` (or `80` if no reverse proxy) | host port the web container binds |

### Runtime vs build-time variables (important)

- **Backend (runtime):** `JWT_SECRET`, `DATABASE_URL`, `SMTP_*`, `AI_ENCRYPTION_KEY`,
  … — read when the API container starts. Change → just restart: `docker compose ... up -d api`.
- **Frontend (build-time):** `VITE_API_BASE_URL`, `VITE_DEMO_MODE` — these are
  **baked into the static JavaScript when the web image is built**. Changing them
  requires a **rebuild**: `docker compose ... build web && docker compose ... up -d web`.

### Why leave `VITE_API_BASE_URL` empty

The web container's nginx proxies `/api` → the API container. With the variable
empty, the frontend calls a **relative `/api`**, which works on any domain and
needs **no CORS setup**. Only set it to an absolute URL if you host the API on a
**different** domain from the web app.

---

## 3. Start the stack

From the repo root:

```bash
make up
# equivalent to:
# docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build
```

On boot the API container automatically:
1. runs `prisma migrate deploy` (applies any pending DB migrations), then
2. seeds baseline lookup data (currencies, modules, custom-field types,
   notification types) — idempotent, and
3. starts the server.

So **you do not run migrations by hand** — a deploy or an update is just
`make up`. (To skip the seed step after first boot, set `SEED_ON_BOOT=false` in
`docker/.env`.)

Check it came up:

```bash
make ps
curl -fsS http://localhost:8080/api/healthz   # -> ok
make logs                                       # tail api + web
```

Only **api**, **postgres**, and **web** run by default. Redis is opt-in
(`--profile redis`).

---

## 4. TLS / HTTPS (put a reverse proxy in front)

The web container serves plain HTTP on `WEB_PORT`. **Do not expose it directly on
the public internet without TLS.** Terminate HTTPS with a reverse proxy. Simplest
is **Caddy** (automatic Let's Encrypt certificates):

```
# /etc/caddy/Caddyfile
app.yourdomain.com {
    reverse_proxy localhost:8080
}
```
```bash
# install caddy, then:
sudo systemctl reload caddy
```

That's it — Caddy obtains and renews the certificate and proxies HTTPS → the web
container on 8080. (nginx or Traefik work equally well if you prefer.)

---

## 5. First run

1. Open `https://app.yourdomain.com`.
2. Register the **first admin** (registration is single-admin gated — after the
   first account, registration is closed; everyone else is added under
   Users / Roles).
3. Configure the company, then run **Settings → Finance Settings → Ledger Setup**
   to choose your country accounting pack and go live.

---

## 6. Updating to a new version

```bash
cd elixirbooks
git pull            # single repository — one pull covers both apps
make up             # rebuilds changed images; entrypoint auto-applies new migrations
```

No manual migration step. If only frontend env/config changed, rebuild web:
`docker compose --env-file docker/.env -f docker/docker-compose.yml build web && ... up -d web`.

---

## 7. Backups (do this before you have real data)

Two things hold all state — back both up regularly:

- **Postgres data** — volume `elixirbooks-pg-data`. Logical dump:
  ```bash
  docker compose --env-file docker/.env -f docker/docker-compose.yml \
    exec -T postgres pg_dump -U elixirbooks elixirbooks | gzip > elixirbooks-$(date +%F).sql.gz
  ```
  Restore: `gunzip -c backup.sql.gz | docker compose ... exec -T postgres psql -U elixirbooks elixirbooks`.
- **Uploaded files** — volume `elixirbooks-uploads` (invoice logos, attachments, etc.):
  ```bash
  docker run --rm -v elixirbooks_elixirbooks-uploads:/data -v "$PWD":/backup alpine \
    tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
  ```

Automate both with a daily cron and copy them off-box.

---

## 8. Operations cheat-sheet

| Task | Command (from repo root) |
|---|---|
| Start / update | `make up` |
| Stop (keep data) | `make down` |
| Stop **and wipe data** | `make down-clean` ⚠️ destroys volumes |
| Logs (api + web) | `make logs` |
| Re-run baseline seed | `make seed` |
| Apply migrations manually | `docker compose --env-file docker/.env -f docker/docker-compose.yml exec api npx prisma migrate deploy` |
| Open a DB shell | `docker compose --env-file docker/.env -f docker/docker-compose.yml exec postgres psql -U elixirbooks elixirbooks` |
| Enable async worker | `make up-redis` (Redis + worker) |

---

## 9. Production checklist

- [ ] `docker/.env` created; `JWT_SECRET` and `AI_ENCRYPTION_KEY` are **freshly
      generated** (not the example values).
- [ ] `POSTGRES_PASSWORD` is strong and matches `DATABASE_URL`.
- [ ] `NODE_ENV=production`, `VITE_DEMO_MODE=false`.
- [ ] HTTPS terminated by a reverse proxy; HTTP not exposed publicly.
- [ ] `make up` succeeds; `/api/healthz` returns `ok`; you can log in.
- [ ] Postgres + uploads backups scheduled and tested (restore once).
- [ ] SMTP configured and a test email sends.
