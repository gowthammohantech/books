# Elixir Books Backend — Deployment Guide

## Database setup (all deploy methods)

The server self-applies database migrations and seeds baseline lookup data on
every boot. This means **no manual DB setup step is required** — just start the
server and it handles the rest.

### How it works

On startup, `server.ts` runs a boot bootstrap before accepting HTTP traffic:

1. **`prisma migrate deploy`** — applies any pending schema migrations
   (idempotent; only runs pending ones).
2. **`runBaselineSeed()`** — upserts lookup tables (modules, field types,
   currencies, timezones, roles, etc.) that the UI depends on (idempotent;
   existing rows are left untouched).
3. **Contact data migration** — `migrateContacts()` populates the unified
   Contact table from any legacy Customer/Supplier rows, then
   `backfillContactFks()` repoints legacy FKs (Invoice, Quotation,
   CreditNote, Purchase, etc.) at the new Contact records. This is how
   self-hosted installs upgrading from the pre-Contact model get their
   Contact table populated automatically — no manual script run required.
   Both steps are idempotent (they skip rows/records already migrated), so
   on an install that's already caught up this is a cheap no-op every boot.
4. **Geo dataset import** — `importGeoDataset()` upserts the Country/State
   lookup tables from the bundled dataset. Without this, a fresh install has
   empty/sparse Country/State tables and saving a Country/State in Company
   Settings would fail its foreign-key constraint. Match-then-update by
   iso2/code preserves fixed seeded ids, so this is a cheap no-op once an
   install is caught up.

All four steps are **non-fatal**: if any fails, a warning is logged and the
server starts anyway (to prevent a stale migration hiccup from taking down a
running install).

### Disabling auto-setup

Set environment variables to skip individual steps — useful in CI pipelines
where you control the sequencing externally:

```
MIGRATE_ON_BOOT=false     # skip prisma migrate deploy at boot
SEED_ON_BOOT=false        # skip baseline seed at boot
BACKFILL_ON_BOOT=false    # skip the on-boot Contact data migration
GEO_ON_BOOT=false         # skip the on-boot Country/State geo dataset import
```

When both are disabled, run setup manually:

```bash
npm run setup
# equivalent to: prisma migrate deploy && prisma generate && prisma db seed
```

### Docker

The Docker entrypoint (`docker-entrypoint.sh`) waits for the database to be
reachable and then hands control to the app process. The app applies
migrations and seeds itself — no duplicate work in the entrypoint.

```bash
docker compose up -d   # DB-ready wait → node dist/server.js → migrate → seed → backfill → geo import → listen
```

### PM2

No special configuration needed. PM2 just needs to launch the server:

```bash
npm run build                                  # produces dist/
pm2 start npm --name elixirbooks -- start      # runs node dist/server.js
```

The boot bootstrap runs automatically on each start/restart.

### Bare node

```bash
npm run build   # produces dist/
npm start       # node dist/server.js
```

Same auto-setup applies. `npm start` runs the compiled output — ts-node is a
devDependency and is not installed by a production install. Operator scripts
under `prisma/` ship compiled too, so inside the container use e.g.
`node dist/prisma/seed-demo.js` rather than `npx ts-node prisma/seed-demo.ts`.

### Manual setup (CI / scripted deploys)

If you prefer to control the order explicitly (e.g., run migrations before
deploying new app instances), disable the auto steps and run setup manually:

```bash
MIGRATE_ON_BOOT=false SEED_ON_BOOT=false npm start &
npm run setup   # prisma migrate deploy && prisma generate && prisma db seed
```

Or run `npm run setup` as a pre-deploy step, then start the server with the
defaults (it will no-op the already-applied migration and already-seeded rows).

## Data migrations / upgrade runbook

The Contact data migration (legacy Customer/Supplier -> unified Contact) and
the Country/State geo dataset import now run automatically on every boot (see
above) — no manual step needed for either. Disable them individually with
`BACKFILL_ON_BOOT=false` / `GEO_ON_BOOT=false` if you'd rather run them by
hand (`npm run prisma:backfill:contacts` / `npm run prisma:import:geo`).

A few older, more specialized data backfills are **not** run automatically
and still need to be run knowingly by whoever operates the upgrade, since they
touch financial/ledger data and are scoped to specific historical migrations:

```bash
npm run prisma:backfill:ledger              # ledger engine initialization
npm run prisma:backfill:disposal-accounts   # capital asset disposal accounts
npm run prisma:backfill:employee-payable    # employee payable account setup
```

Run these once, in order, when upgrading an existing self-hosted install past
the release that introduced each feature. They are idempotent, but are kept
manual (rather than boot-wired) because they should be run with an operator
watching the output on installs with real ledger data.

The Contact migration also has standalone scripts if you ever need to re-run
it by hand (e.g. after restoring a backup, or to inspect output outside of
the boot log):

```bash
npm run prisma:migrate:contacts       # Customer/Supplier -> Contact
npm run prisma:backfill:contact-fks   # repoint legacy FKs at the new Contacts
npm run prisma:backfill:contacts      # both, in order
```
