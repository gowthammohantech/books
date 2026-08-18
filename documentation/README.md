# Kanakku — Documentation Index

Kanakku is a self-hosted invoicing and accounting application distributed as a
Docker Compose stack (Node.js API + React SPA + PostgreSQL). You own your data
and deploy it on any Linux server or VPS.

---

## Documentation

| File | What it covers |
|---|---|
| [installation.md](installation.md) | Quick-start (Docker), detailed install, TLS, smoke test |
| [configuration.md](configuration.md) | Full environment variable reference, rebuild vs restart rules |
| [first-run.md](first-run.md) | Admin registration, company setup, ledger setup, roles, demo mode |
| [integrations.md](integrations.md) | SMTP, Razorpay, Stripe, AI (BYOK), WhatsApp CRM |
| [backup-restore-upgrade.md](backup-restore-upgrade.md) | Backups, restore, upgrade flow, rollback |
| [troubleshooting.md](troubleshooting.md) | FAQs and common failure modes |

The original [`DEPLOYMENT.md`](../DEPLOYMENT.md) at the repo root is also
included in the package and contains a concise production checklist.

---

## Features

**Documents**
- Invoices (recurring, templates, public payment links)
- Quotations / Estimates
- Credit notes and debit notes
- Delivery challans
- Purchase orders and purchase bills
- Expenses with receipt attachments (FIFO/WAC valuation)

**Finance**
- Double-entry ledger engine with six country accounting packs: India (IN), EU, UK (UK), US, Australia (AU), New Zealand (NZ)
- Opening-balance cutover wizard (Settings → Finance → Ledger Setup)
- Profit & Loss, Balance Sheet, Trial Balance statements
- AR/AP aging reports
- Budgets and cost centers
- Fixed assets register
- Per-document multi-currency (customers and suppliers each carry an independent currency; ExchangeRate table for expense FX conversion)

**Payments**
- Razorpay and Stripe (BYOK — bring your own keys; webhook signature verification)
- Offline payment recording

**Operations**
- 12+ reports (transaction, tax, dimension/P&L, aging, bank reconciliation)
- Inventory with FIFO and WAC costing
- Maker-checker approvals workflow (off by default)
- Roles and permissions (5 default roles: Admin, Vendor, Staff, Maintainer, Supplier)
- Custom fields on most entities
- Recurring invoices and recurring expenses (cron-driven)
- Invoice and quotation reminder emails

**Integrations**
- SMTP email (or Resend) — configurable in-app
- AI document extraction and chat (BYOK Claude or OpenAI; mock fallback when no key)
- WhatsApp CRM bridge (server-to-server customer sync + SSO)
- GST filing reports (India)
- Signatures

---

## System Requirements

| Component | Minimum |
|---|---|
| CPU | 2 vCPU |
| RAM | 4 GB |
| Disk | 20 GB (plus upload storage) |
| OS | Linux (any modern distro) |
| Docker Engine | 24+ |
| Docker Compose plugin | v2 (`docker compose`, not legacy `docker-compose`) |
| PostgreSQL | 16 (provided by the compose stack — no separate install needed) |
| Node.js | 20 (inside the API container — no host install needed) |
| Ports | 80 and 443 reachable for web + TLS |

No MongoDB or Redis install is required. Both are optional opt-in services
described in [configuration.md](configuration.md).

---

## Support and License

- **Support**: Raise a ticket via the CodeCanyon item page. Include your Kanakku
  version (`/api/healthz` reports it), OS, Docker Engine version, and the
  relevant section of `make logs` output.
- **License**: See [../LICENSE.md](../LICENSE.md).
- **Changelog**: See [../CHANGELOG.md](../CHANGELOG.md).
