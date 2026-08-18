# Installation

---

## Quick Start (5-minute Docker path)

These steps get a running stack in one go. Read [configuration.md](configuration.md)
afterward to harden the install for production.

**Prerequisites on the host:**
- Docker Engine 24+ and the Docker Compose plugin (`docker compose version` should
  print v2.x).
- Ports 80 and 443 available (or whichever `WEB_PORT` you choose).

```bash
# 1. Copy the environment template
cp docker/.env.example docker/.env

# 2. Set the two mandatory secrets (minimum for a working stack)
#    Open docker/.env in your editor and replace:
#      JWT_SECRET=change-me-to-a-long-random-string
#      POSTGRES_PASSWORD=change-me-strong-password
#    with values from:
openssl rand -hex 32   # use this output for JWT_SECRET
openssl rand -hex 32   # use this output for POSTGRES_PASSWORD (and DATABASE_URL)
openssl rand -hex 32   # use this output for AI_ENCRYPTION_KEY

# 3. Start the stack (builds images on first run)
make up

# 4. Verify it came up
curl -fsS http://localhost:8080/api/healthz
# Expected: {"status":"ok","service":"kanakku-api",...}
```

Open `http://localhost:8080` (or `https://your-domain.com` after setting up TLS)
and register the first admin account.

---

## Detailed Installation

### 1. Directory layout

The three project folders must sit side by side — the compose build contexts are
relative paths and will fail if the layout is changed:

```
kanakku/                          <- repo root (run all commands from here)
├── docker/
│   ├── docker-compose.yml
│   └── .env                      <- you create this from .env.example
├── kanakku-typescript-backend/
└── kanakku-typescript-frontend/
```

### 2. Create and edit `docker/.env`

```bash
cp docker/.env.example docker/.env
```

Edit `docker/.env`. At minimum set:

| Variable | Action |
|---|---|
| `JWT_SECRET` | Replace with `openssl rand -hex 32` output |
| `POSTGRES_PASSWORD` | Replace with a strong password |
| `DATABASE_URL` | Set the password component to match `POSTGRES_PASSWORD` |
| `AI_ENCRYPTION_KEY` | Replace with `openssl rand -hex 32` output |
| `NODE_ENV` | Set to `production` |
| `VITE_DEMO_MODE` | Set to `false` for a production install |

See [configuration.md](configuration.md) for the complete variable reference.

### 3. Start the stack

From the repo root:

```bash
make up
```

This is equivalent to:
```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build
```

On first boot the API container automatically:
1. Applies any pending database migrations (`prisma migrate deploy`).
2. Seeds baseline lookup data (currencies, timezones, date formats, modules,
   roles) — this is idempotent and safe to run repeatedly.
3. Starts the API server.

You do not run migrations by hand. A deploy or an update is always `make up`.

### 4. Check the stack is healthy

```bash
make ps
# All three containers (postgres, api, web) should show status "healthy" or "running"

curl -fsS http://localhost:8080/api/healthz
# {"status":"ok","service":"kanakku-api","uptime":...}

make logs
# tail api + web logs
```

The nginx `/healthz` endpoint (served by the web container itself, not the API):

```bash
curl -fsS http://localhost:8080/healthz
# ok
```

### 5. Run the smoke test

```bash
make smoke
```

This script brings up the stack (idempotently), waits up to 90 seconds for
`/api/healthz`, verifies the web root returns HTTP 200, and scans the API logs
for errors.

---

## TLS / HTTPS

The web container serves plain HTTP on `WEB_PORT` (default 8080). **Do not
expose it on the public internet without TLS.**

The simplest approach is Caddy — it obtains and renews Let's Encrypt certificates
automatically:

```
# /etc/caddy/Caddyfile
app.yourdomain.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

nginx and Traefik work equally well. The web container only needs to receive
plain HTTP from the reverse proxy — do not configure TLS inside the container.

**Important:** After adding TLS and pointing a domain at the stack, if you use
the WhatsApp integration or payment gateway webhooks you must set
`companySettings.publicBaseUrl` from the admin UI so generated public links use
your HTTPS domain.

---

## Non-Docker Install (advanced / unsupported)

Running the stack without Docker requires Node.js 20, PostgreSQL 16, and manual
configuration of both services. There is no supported bare-metal install path
for this release — if you need it, refer to the `package.json` scripts and
`Dockerfile` files in the backend and frontend subdirectories for the
build and run commands. This path is entirely at your own discretion.

---

## Make Targets Reference

| Target | What it does |
|---|---|
| `make up` | Build images and start the stack (api, postgres, web) |
| `make down` | Stop containers, keep volumes (data preserved) |
| `make down-clean` | Stop containers **and delete all volumes** — destroys data |
| `make logs` | Tail api + web logs (last 200 lines, then follow) |
| `make ps` | Show container status |
| `make build` | Rebuild images without starting |
| `make rebuild-web` | Rebuild and restart only the web container |
| `make rebuild-api` | Rebuild and restart only the api container (also applies migrations) |
| `make smoke` | Run the smoke test against a running stack |
| `make seed` | Re-run the baseline seed inside the running api container |
| `make up-redis` | Start the stack with the optional Redis + worker service |
| `make up-dev` | Start the stack with API hot-reload (development only) |
