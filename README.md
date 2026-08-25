# Elixir Books Deploy

Docker Compose stack for Elixir Books Core (whitelabel single-tenant invoicing).

## Quick start

```bash
cp docker/.env.example docker/.env
# edit docker/.env (set Mongo password, JWT secret, etc.)
make up
make smoke
```

Open http://localhost:8080.

## Targets

- `make up` — start lean stack (web, api, mongo)
- `make up-redis` — start with Redis + worker (async jobs)
- `make down` — stop containers
- `make down-clean` — stop containers and remove volumes (destroys data)
- `make logs` — tail logs for api + web
- `make smoke` — run end-to-end smoke test
- `make seed` — run backend seed scripts

## Layout

- `docker/` — compose files + env example
- `scripts/` — verification helpers (`smoke.sh`)
- `docs/` — design specs and implementation plans
- `tasks/` — backlog (`todo.md`) and lessons (`lessons.md`)

The two app repos `../elixirbooks-typescript-backend/` and `../elixirbooks-typescript-frontend/` are independent git repos. Compose builds them from relative paths.
