# Elixir Books Deploy

Docker Compose stack for Elixir Books Core (whitelabel single-tenant invoicing).

## Quick start

```bash
cp docker/.env.example docker/.env
# edit docker/.env (set Postgres password, JWT secret, etc.)
make up
make smoke
```

Open http://localhost:8080.

## Targets

- `make up` — start lean stack (web, api, postgres)
- `make up-redis` — start with Redis + worker (async jobs)
- `make down` — stop containers
- `make down-clean` — stop containers and remove volumes (destroys data)
- `make logs` — tail logs for api + web
- `make smoke` — run end-to-end smoke test
- `make seed` — run backend seed scripts

## Layout

- `apps/api/` — Express 5 + Prisma backend
- `apps/web/` — React 19 + Vite frontend
- `docker/` — compose files + env example
- `scripts/` — verification helpers (`smoke.sh`)
- `documentation/` — operator guides (install, configure, backup, troubleshoot)

This is a single repository containing both applications. Compose builds them
from paths relative to `docker/`.
