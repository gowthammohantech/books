# Elixir Books — Documentation

Elixir Books is a self-hosted invoicing and accounting application, distributed as a
Docker Compose stack (Express 5 API + React 19 SPA + PostgreSQL 16). One install
hosts several workspaces, each with its own data, members and settings.

Docs are grouped by who reads them. Start with the group that matches what you are
doing; the root [`README.md`](../README.md) covers the workspace layout and the
day-to-day build commands.

---

## [operations/](operations/) — running an install

For whoever deploys and looks after a server. Read in this order for a first install.

| Doc | What it covers |
|---|---|
| [installation.md](operations/installation.md) | Quick start, detailed install, TLS, smoke test |
| [deployment.md](operations/deployment.md) | Condensed production checklist — prerequisites through backups |
| [configuration.md](operations/configuration.md) | Every `docker/.env` variable, and which changes need a rebuild vs a restart |
| [first-run.md](operations/first-run.md) | Admin registration, company setup, ledger setup, roles, demo mode |
| [integrations.md](operations/integrations.md) | SMTP, Razorpay, Stripe, AI (BYOK), WhatsApp CRM |
| [backup-restore-upgrade.md](operations/backup-restore-upgrade.md) | Backups, restore, upgrade flow, rollback |
| [troubleshooting.md](operations/troubleshooting.md) | Common failure modes and their fixes |

`installation.md` and `deployment.md` overlap by design: the first walks you through
a first install, the second is the checklist to re-read before going to production.

## [development/](development/) — working on the code

| Doc | What it covers |
|---|---|
| [running-locally.md](development/running-locally.md) | Hot-reload dev loop (API + SPA on the host), and the full Docker alternative |
| [monorepo-migration.md](development/monorepo-migration.md) | What the workspace + JS→TS migration changed, and why each decision went the way it did |

## [architecture/](architecture/) — how the system is shaped

| Doc | What it covers |
|---|---|
| [erd.dbml](architecture/erd.dbml) | Entity-relationship diagram, 101 tables and 82 enums. Generated from `apps/api/prisma/schema.prisma`; paste into [dbdiagram.io](https://dbdiagram.io) to render |
| [refactor-proposal.md](architecture/refactor-proposal.md) | Assessment of the current backend and frontend architecture, and a staged plan to move to class-based services, repositories and API clients. Point-in-time against `bc0cebd` — re-verify its counts before acting |

## [product/](product/) — scope and roadmap

Point-in-time audits of branch `pc-cc`, taken 2026-08-31. Planning artefacts, not a
record of current state — nothing regenerates them, so re-verify against `master`
before acting on anything in them.

| Doc | What it covers |
|---|---|
| [current-modules.md](product/current-modules.md) | What ships today, and what is missing relative to a full ERP |
| [modules-to-modify.md](product/modules-to-modify.md) | Existing modules that are incomplete, drifted or duplicated, ranked P0–P2 |
| [erp-roadmap.md](product/erp-roadmap.md) | Proposed modules and phasing to reach ERP scope — a proposal to confirm, not agreed scope |

---

## Elsewhere in the repository

| Path | What |
|---|---|
| [`../README.md`](../README.md) | Workspace layout, build and test commands, `make` targets |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Release history |
| [`../LICENSE.md`](../LICENSE.md) | Licence |
| [`../apps/api/DEPLOYMENT.md`](../apps/api/DEPLOYMENT.md) | Backend-specific notes — boot-time migrations, baseline seed, contact backfill |
| [`../docker/.env.example`](../docker/.env.example) | The configuration template every install starts from |

---

## Support

Raise a ticket via the CodeCanyon item page. Include your Elixir Books version
(`/api/healthz` reports it), your OS and Docker Engine version, and the relevant
section of `make logs` output.
