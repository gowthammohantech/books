# First Run

This guide covers what happens the first time you open Elixir Books after installation,
and the decisions you make during initial setup.

---

## 1. Admin Registration (Single-Admin Gate)

Navigate to `http://localhost:8080` (or your domain). On a fresh install the
app detects that no admin account exists and shows the registration form.

**Register the first admin account.** Once one admin is registered, the
registration endpoint is permanently closed — subsequent users must be invited
or created through the Users section of the admin UI. There is no second
registration route.

Fill in your name, email, and a strong password, then submit. You will be
logged in automatically.

---

## 2. Company Setup

After registration, the onboarding flow prompts you to create your company
profile. Fill in:

- Company name, address, phone, and email
- Logo (uploaded file, stored in the blob container, not on disk)
- Tax identification numbers relevant to your jurisdiction

These settings are editable later under **Settings → Company Settings**.

---

## 3. Accounting Country Pack and Ledger Setup

Elixir Books ships with six accounting country packs, each with a pre-configured
chart of accounts, tax codes, and report layouts:

| Pack | Jurisdiction |
|---|---|
| IN | India (GST, TDS) |
| EU | European Union (VAT) |
| UK | United Kingdom (VAT) |
| US | United States |
| AU | Australia (GST) |
| NZ | New Zealand (GST) |

To activate accounting:

1. Go to **Settings → Finance Settings → Ledger Setup**.
2. Choose your country pack.
3. Enter your opening balances (the wizard walks through each account class).
4. Confirm the cutover date — transactions from this date onward will post
   double-entry journal entries.

Until Ledger Setup is completed the system functions as a transactional
invoicing tool but financial statements (P&L, Balance Sheet, Trial Balance)
will be empty.

---

## 4. Tax Rates and Currencies

**Tax rates** are configured under **Settings → Tax Rates**. The India pack
seeds GST rate groups (CGST/SGST/IGST) automatically; other packs provide
standard VAT/GST rates. You can add, edit, or deactivate rates at any time.

**Currencies**: The baseline seed provisions nine currencies (INR, USD, EUR,
GBP, AUD, CAD, SGD, JPY, AED) with INR as the default. Change the default
currency in **Settings → Currencies**. Customers and suppliers each carry
their own independent currency setting, separate from the global default.

---

## 5. Default Roles

Five roles are seeded automatically on first boot:

| Role name | `user_type` | Intended for |
|---|---|---|
| Admin | 1 | Full access |
| Vendor | 2 | External vendor portal |
| Staff | 3 | Internal staff (create/edit documents) |
| Maintainer | 4 | Operations / IT |
| Supplier | 5 | Supplier portal |

Roles control access in the UI. **Note:** permission checkboxes are UI-level
guards that show or hide menu items and block form submissions in the browser.
Fine-grained API-level permission enforcement is on the roadmap. Do not
rely on role gating to prevent determined direct API access.

Roles can be customised under **Settings → Roles & Permissions**.

---

## 6. Demo Mode

Demo mode pre-fills the login page with the demo credentials and shows a
"demo" banner in the UI. It is controlled by the **build-time** variable
`VITE_DEMO_MODE` in `docker/.env`.

### Production install (default)

`VITE_DEMO_MODE=false` — the login page is a normal blank form. This is
correct for all real deployments.

### CodeCanyon demo / evaluation install

If you want to run the demo with pre-provisioned sample data and pre-filled
credentials:

**Step 1** — Set `VITE_DEMO_MODE=true` in `docker/.env` and rebuild:

```bash
# In docker/.env:
VITE_DEMO_MODE=true

make rebuild-web
```

**Step 2** — Seed the demo admin account (run once after `make up`):

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec api npx ts-node prisma/seed-demo.ts
```

This creates:
- User: `admin@demo.elixirbooks.local`
- Password: `Demo123$`
- A default company profile (Elixir Books)

The demo seed is idempotent — re-running it updates the password without
touching other data.

**Demo credentials:**

| Field | Value |
|---|---|
| Email | `admin@demo.elixirbooks.local` |
| Password | `Demo123$` |

### Switching from demo to clean production

To wipe demo data and start a real deployment:

```bash
# Stop the stack and delete all data volumes
make down-clean

# Edit docker/.env: set VITE_DEMO_MODE=false, set real SMTP/secrets
# Then bring the stack back up fresh
make up
```

The `down-clean` target removes the `elixirbooks-pg-data` and
`elixirbooks-azurite-data` volumes — the database and, locally, every uploaded
file. This is irreversible — ensure you have a backup if there is any data worth
keeping. (In a real deployment the uploads live in the storage account, which
`down-clean` cannot touch.)

---

## 7. Inviting Additional Users

After the admin account is created, all other users are added through the
admin UI:

1. **Settings → Users** → Add User
2. Assign a role (from the five default roles or one you created)
3. The user receives an email invitation (requires SMTP to be configured)
4. They set their own password on first login

There is no self-service sign-up for non-admin users.
