#!/bin/sh
# Production entrypoint for the Kanakku API container.
#
# As of the boot-seed refactor, the application self-applies migrations,
# seeds baseline lookup data, runs the legacy Customer/Supplier -> Contact
# data migration, and imports the Country/State geo dataset on startup (see
# server.js bootstrap IIFE). This entrypoint therefore only needs to gate on
# the database being reachable before handing control to the app process.
#
# Disable the in-app steps via env vars if you need external control:
#   MIGRATE_ON_BOOT=false    — skip prisma migrate deploy at boot
#   SEED_ON_BOOT=false       — skip baseline seed at boot
#   BACKFILL_ON_BOOT=false   — skip the on-boot Contact data migration
#                              (e.g. if you prefer to run it manually via
#                              `npm run prisma:backfill:contacts`)
#   GEO_ON_BOOT=false        — skip the on-boot Country/State geo dataset
#                              import (e.g. if you prefer to run it manually
#                              via `npm run prisma:import:geo`)
#
# The app always starts regardless of migrate/seed/backfill/geo outcome (non-fatal design).
set -e

# Brief retry loop until the DB accepts connections. Compose already gates on
# the postgres healthcheck, so this is belt-and-suspenders for edge cases where
# the healthcheck passes before Postgres is fully ready for migrations.
echo "[entrypoint] Waiting for database to be ready..."
n=0
until npx prisma migrate status > /dev/null 2>&1; do
  n=$((n + 1))
  if [ "$n" -ge 10 ]; then
    echo "[entrypoint] Database not reachable after $n attempts — proceeding anyway." >&2
    break
  fi
  echo "[entrypoint] DB not ready yet (attempt $n/10) — retrying in 2s..."
  sleep 2
done
echo "[entrypoint] Database is reachable. Starting application..."

exec "$@"
