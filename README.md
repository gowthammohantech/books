# Elixir Books

Whitelabel invoicing and accounting, shipped as a self-hosted Docker Compose stack. One install
hosts several workspaces, each with its own data, members and settings.

The stack is Express 5 + Prisma on PostgreSQL 16, a React 19 + Vite SPA, and TypeScript
throughout — no JavaScript source outside tooling configs and vendored static assets.

## Layout

An npm workspace. `apps/*` are the two deployables; `packages/*` are shared between them.

| Path | What |
|---|---|
| `apps/api/` | Express 5 + Prisma backend |
| `apps/web/` | React 19 + Vite SPA |
| `packages/enums/` | Enum unions generated from `schema.prisma`, so the SPA and the API cannot disagree about a status |
| `packages/money/` | Decimal money and tax arithmetic, shared so the on-screen total matches the persisted one |
| `packages/validation/` | Input validators shared between the forms and the API |
| `docker/` | Compose files and `.env.example` |
| `scripts/` | `smoke.sh` and build helpers |
| `documentation/` | Operator, developer, architecture and product docs |

## Development

Requires **Node 20+** and **npm 10+** (see `.nvmrc`). Task running is Turborepo, so every command
below covers all five workspaces in dependency order.

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Two things worth knowing before the first run:

- **The backend suite needs a reachable database.** Three suites reach `lib/actor.ts` unmocked and
  issue a real query, so start Postgres and apply migrations first. Without one, exactly those
  three fail — 7 tests of the backend's 1,849 — and nothing else does. Pointing `DATABASE_URL` at
  a database that is not listening fails the same three.

  ```bash
  export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/elixirbooks_test
  npm run prisma:generate --workspace=@elixirbooks/api
  cd apps/api && npx prisma migrate deploy
  ```

  Turbo caches test results, so `npm run test` can replay a green run from cache even with the
  database down. Use `npx turbo run test --force` when you actually want them re-executed.

- **Build the shared packages before type-checking an app on its own.** `npm run typecheck` at the
  root handles the ordering; running `npx vitest` or `tsc` directly inside `apps/api` or
  `apps/web` does not, and fails to resolve `@elixirbooks/*` until they have been built once.

CI (`.github/workflows/ci.yml`) runs the same four commands against a PostgreSQL service on every
pull request.

## Seeding a company with demo data

To fill a workspace with realistic data across every module — customers, invoices with real
double-entry postings, purchases, expenses, banking, fixed assets, payroll, recurring schedules —
point the seeder at a company by id, name or slug:

```bash
python scripts/seed_company.py --list                          # what workspaces exist
python scripts/seed_company.py --company "Acme Ltd" --create   # DRY RUN: reports, writes nothing
python scripts/seed_company.py --company "Acme Ltd" --create --confirm
python scripts/seed_company.py --company acme-ltd --confirm    # reseed an existing one
```

`--create` provisions the workspace first, through the same `provisionTenant` code path signup
uses, so a seeded company is indistinguishable from a registered one. The owner is
`owner@<slug>.seed.local` with password `Demo123$` unless `--owner-email` / `--owner-password`
say otherwise.

The Python script is only a front door: it resolves nothing itself and never opens a database
connection. Everything lives in `apps/api/prisma/seedCompany.ts`, which is equally usable on its
own (`npm run prisma:seed:company --workspace=@elixirbooks/api -- --company "Acme Ltd"`), or via
`make seed-company COMPANY="Acme Ltd" CREATE=1 CONFIRM=yes`.

**This is destructive, and that is why `--confirm` exists.** Seeding an existing workspace wipes
its business data first — invoices, purchases, contacts, accounts, journal entries and every
non-owner staff user — because the engine reseeds rather than merges. Without `--confirm` you get
a dry run naming the workspace it resolved and counting the rows it would delete. A name matching
more than one workspace is refused outright rather than guessed at (exit 3); pass the id instead.

Only `--country IN` is supported. `lib/ledger/packs` has charts of accounts for six countries, but
the seeded *content* is India-specific (GST regime, CGST/SGST/IGST rates, Indian addresses), so
any other country would staple a foreign chart of accounts onto Indian documents.

Two checks are worth running afterwards, and both take a workspace or run across all of them:

```bash
cd apps/api
npm run prisma:check:tenant   # no foreign key crosses a workspace boundary
npm run prisma:check:ledger   # every entry balances, and nothing that should have posted didn't
```

The second matters more than it looks. `lib/ledger/postingGate.ts` silently declines to post any
document dated before the workspace's go-live date — no error, no log — so a document can exist
with no ledger entry behind it and nothing will tell you.

## Running with Docker

```bash
cp docker/.env.example docker/.env
# edit docker/.env (Postgres password, JWT secret, SMTP, …)
make up
make smoke
```

Then open <http://localhost:8080>.

The common targets — `make help` lists them all:

| Target | What |
|---|---|
| `make up` | Start lean stack (web, api, postgres) |
| `make up-dev` | Start with api hot-reload (binds backend source, nodemon) |
| `make up-redis` | Start with Redis + worker (async jobs) |
| `make down` | Stop containers (keep volumes) |
| `make down-clean` | Stop containers **and remove volumes — destroys data** |
| `make logs` | Tail logs for api + web |
| `make rebuild-api` | Rebuild + restart only the api container (applies new migrations) |
| `make rebuild-web` | Rebuild + restart only the web container |
| `make smoke` | Run `scripts/smoke.sh` against a running stack |
| `make seed` | Run the Postgres baseline seed inside the api container |

The API applies migrations and seeds itself on boot, so an upgrade is `git pull && make up`.

## Documentation

Everything lives in [`documentation/`](documentation/), grouped by audience — see its
[index](documentation/README.md) for the full list.

| Group | Start here |
|---|---|
| [`documentation/operations/`](documentation/operations/) | [installation.md](documentation/operations/installation.md) — install, configure, TLS, backups, troubleshooting |
| [`documentation/development/`](documentation/development/) | [running-locally.md](documentation/development/running-locally.md) — the hot-reload dev loop, without Docker |
| [`documentation/architecture/`](documentation/architecture/) | [erd.dbml](documentation/architecture/erd.dbml) — the entity-relationship diagram |
| [`documentation/product/`](documentation/product/) | [current-modules.md](documentation/product/current-modules.md) — scope audits and the ERP roadmap (dated, re-verify before use) |

## Features

**Documents** — invoices (recurring, templates, public payment links), quotations,
credit and debit notes, delivery challans, purchase orders and bills, expenses with
receipt attachments.

**Finance** — double-entry ledger with six country accounting packs (IN, EU, UK, US,
AU, NZ); opening-balance cutover wizard; P&L, balance sheet and trial balance;
AR/AP aging; budgets and cost centers; fixed assets register; per-document
multi-currency, with an `ExchangeRate` table for expense FX conversion.

**Payments** — Razorpay and Stripe, BYOK, with webhook signature verification, plus
offline payment recording.

**Operations** — 12+ reports (transaction, tax, dimension/P&L, aging, bank
reconciliation); inventory with FIFO and WAC costing; maker-checker approvals (off by
default); five default roles; custom fields on most entities; recurring invoices and
expenses; invoice and quotation reminder emails.

**Integrations** — SMTP or Resend, configurable in-app; AI document extraction and
chat (BYOK Claude or OpenAI, mock fallback with no key); WhatsApp CRM bridge; GST
filing reports for India; signatures. Setup for each is in
[integrations.md](documentation/operations/integrations.md).

## Licence

[`LICENSE.md`](LICENSE.md). Release history is in [`CHANGELOG.md`](CHANGELOG.md).
