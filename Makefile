COMPOSE := docker compose --env-file docker/.env -f docker/docker-compose.yml
COMPOSE_DEV := $(COMPOSE) -f docker/docker-compose.override.yml
SHELL := /bin/bash

.PHONY: help env up up-dev up-redis down down-clean logs build rebuild-web rebuild-api smoke seed seed-company seed-company-docker ps package

VERSION ?= 1.0.0

help:
	@echo "Targets:"
	@echo "  env              Copy docker/.env.example to docker/.env if missing"
	@echo "  up               Start lean stack (web, api, postgres)"
	@echo "  up-dev           Start with api hot-reload (binds backend source, nodemon)"
	@echo "  up-redis         Start with Redis + worker (async jobs)"
	@echo "  down             Stop containers (keep volumes)"
	@echo "  down-clean       Stop containers AND remove volumes (destroys data)"
	@echo "  logs             Tail logs for api + web"
	@echo "  build            Rebuild images without starting"
	@echo "  rebuild-web      Rebuild + restart ONLY the web container (apply frontend changes)"
	@echo "  rebuild-api      Rebuild + restart ONLY the api container (apply backend changes + migrations)"
	@echo "  smoke            Run scripts/smoke.sh against running stack"
	@echo "  seed             Run the Postgres baseline seed inside the api container"
	@echo "  seed-company     Seed one company with data for every module (dry run unless CONFIRM=yes)"
	@echo "                   e.g. make seed-company COMPANY=\"Acme Ltd\" CREATE=1 CONFIRM=yes"
	@echo "  seed-company-docker  Same, but inside the running api container"
	@echo "  ps               docker compose ps"
	@echo "  package          Build CodeCanyon release zips (default VERSION=1.0.0)"
	@echo "  package VERSION=x.y.z  Build release zips with specific version"

env:
	@test -f docker/.env || cp docker/.env.example docker/.env
	@echo "docker/.env ready"

up: env
	$(COMPOSE) up -d --build

up-dev: env
	$(COMPOSE_DEV) up -d --build

up-redis: env
	$(COMPOSE) --profile redis up -d --build

down:
	$(COMPOSE) down

down-clean:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f --tail=200 api web

build: env
	$(COMPOSE) build

# Frontend (Vite) is compiled into the nginx web image — there is no hot-reload
# in the prod stack, so FE source changes only appear after the web image is
# rebuilt. Use this after any frontend change.
rebuild-web: env
	$(COMPOSE) up -d --build web

# Backend runs migrate deploy + seed via the entrypoint on boot, so this also
# applies any new DB migrations. Use this after any backend change.
rebuild-api: env
	$(COMPOSE) up -d --build api

smoke:
	bash scripts/smoke.sh

seed:
	# Postgres baseline seed (currencies, date/time formats, timezones, module
	# hierarchy, custom-field types). This is the only seed path — the legacy
	# node seed*.js scripts targeted MongoDB and have been deleted.
	$(COMPOSE) exec api npx prisma db seed

# Seed one company (tenant) with realistic data across every module.
#
# DRY RUN BY DEFAULT: without CONFIRM=yes this reports the company it resolved
# and the rows it WOULD delete, and writes nothing. Seeding an existing
# workspace wipes its business data first, so that default is deliberate.
#
#   make seed-company COMPANY="Acme Ltd"                    # dry run
#   make seed-company COMPANY="Acme Ltd" CREATE=1 CONFIRM=yes
#   make seed-company COMPANY=acme-ltd CONFIRM=yes
COMPANY ?=
seed-company:
	@test -n "$(COMPANY)" || { echo 'Set COMPANY, e.g. make seed-company COMPANY="Acme Ltd"'; exit 1; }
	python scripts/seed_company.py --company "$(COMPANY)" $(if $(CREATE),--create,) $(if $(filter yes,$(CONFIRM)),--confirm,)

seed-company-docker:
	@test -n "$(COMPANY)" || { echo 'Set COMPANY, e.g. make seed-company-docker COMPANY="Acme Ltd"'; exit 1; }
	python scripts/seed_company.py --docker --company "$(COMPANY)" $(if $(CREATE),--create,) $(if $(filter yes,$(CONFIRM)),--confirm,)

ps:
	$(COMPOSE) ps

# Build CodeCanyon buyer-ready release zips.
# Produces: release/elixirbooks-web-v$(VERSION).zip
#           release/elixirbooks-mobile-addon-v$(VERSION).zip
# Example:  make package VERSION=2.1.0
package:
	@if [ ! -f scripts/package-release.sh ]; then \
	  echo "make package: scripts/package-release.sh is not in this repository."; \
	  echo "The target and its documentation predate the script; nothing has ever"; \
	  echo "produced the release/*.zip artefacts it describes. Add the script, or"; \
	  echo "drop this target and the 'package' lines from the help text above."; \
	  exit 1; \
	fi
	bash scripts/package-release.sh $(VERSION)
