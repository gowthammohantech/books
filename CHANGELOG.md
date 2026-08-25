# Changelog

All notable changes to Elixir Books are documented here.

---

## [2.9.0] — 2026-07-17

### Changed
- Banking: the explain form is now always editable — expand a transaction and it shows the current
  selection (saved fields or the AI suggestion) ready to change and Save. The lock/unlock
  ("Edit / Un-explain" to unlock a green read-only panel) flow is gone; saving an already-explained
  transaction transparently voids the old ledger posting and posts the new one in a single
  transaction. A status pill (Explained — posted / Awaiting approval / Unexplained) replaces the
  locked-state UI. Un-explain remains as a quiet secondary action that keeps the form open and
  prefilled.
- Banking: rows created by recording a payment at the source document (invoice, purchase, expense,
  petty cash) show a read-only "Linked to source" panel with a link to the document — these mirror
  a real payment record and are edited at the source. Un-explain converts them into normal editable
  bank lines.

### Fixed
- Banking: transactions explained as invoice/supplier payments no longer get permanently stuck as
  green non-editable rows after Un-explain (the underlying linkage is now cleared and a migration
  repairs previously stuck rows).
- Banking: editing an explained invoice/bill transaction and pressing Save no longer fails with a
  not-found error — the form now submits the linked document's id rather than the internal payment
  id.
- Banking: system-generated reversal rows (payment voids, deleted-expense reversals) are now marked
  read-only so they can no longer be explained a second time and double-count cash the reversal
  already booked; a migration repairs historical rows.

---

## [2.8.0] — 2026-07-17

### Added
- Line-item custom fields: define custom columns (HSN Code, Batch Number, MPN, Serial Number, …)
  per document module in Settings → Module Settings → Custom Fields with placement "Line item".
  Columns appear in the item tables of invoices, purchases, purchase orders, quotations, credit/debit
  notes, delivery challans and recurring schedules; values persist per line, print on documents, and
  auto-fill from a matching product custom field (same slug on Product/Services), e.g. define
  `hsn_code` on both Products and Invoices to have HSN auto-populate per line.

### Changed
- Printed line custom-field columns now follow the field-definition order (columns without a live
  definition print last), dropdown/radio values print their option labels, and date values print as
  "17 Jul 2026" instead of raw ISO strings.
- Mandatory line custom fields are grandfathered: a mandatory field defined after a document was
  created no longer blocks saving edits of that older document (new documents still enforce it).

### Fixed
- Creating a custom field without a data type (or with an unknown one) now returns a clear
  validation error instead of a server error.

---

## [2.7.0] — 2026-07-13

Products & Services become simply **Items**, and Tax Rates + Tax Groups merge
into one **Taxes** concept — across web and mobile. Creating an item now takes
one field; picking a tax on a document line is one dropdown.

### Features
- **Items replace Products & Services.** The Product/Service choice is gone —
  it never changed anything except inventory, so the "Track inventory"
  checkbox is now the only switch. The Item form is five fields (Name is the
  only required one; Unit offers "-no unit-", which leaves the unit column
  blank on documents), everything else lives under "More options", and a
  "Create & Add Another" button speeds up bulk entry. Same lean form in the
  invoice's quick-add modal and the mobile app. List pages filter by
  "Tracks inventory" instead of Product/Service.
- **One Taxes page.** A tax is now just a name + rate + country. The separate
  Tax Groups page, modal, and pickers are gone; old
  `/settings/tax-groups` links redirect to Taxes.
- **One tax dropdown per document line.** The per-line multi-rate checkbox
  picker and the "Apply Tax Group" dropdown are replaced by a single Tax
  dropdown on invoices, purchases, quotations, purchase orders, credit
  notes, debit notes, and recurring schedules (web) and invoices (mobile).
- **India GST splits automatically.** Pick a single "GST 18%" tax and the
  engine derives CGST 9% + SGST 9% for intra-state sales (UTGST for union
  territories) or IGST 18% inter-state, based on the customer's state. The
  India country pack now seeds the standard GST 5/12/18/28 slabs. GSTR-style
  reporting by component keeps working via hidden system rates.

### Fixes
- Line-tax resolution now accepts unified **Contact** ids (falls back through
  the contact's legacy customer/supplier link), so state-aware GST splits work
  when parties are picked from the Contacts screen.
- Kind-less GST rates (e.g. "GST 18%") can be created through the API/UI
  (the validator previously required a component kind).
- Inventory reports no longer crash on items without a unit.
- Restored sidebar accessibility attributes (icon-only add-links keep their
  labels and keyboard focus visibility).

### Upgrade notes (self-hosted)
- Database changes are **additive only** (`prisma migrate deploy` — new
  nullable columns, no data loss). All old API payloads (`item_type`,
  `tax` group ids) and the Tax Group endpoints keep working.
- Recommended once after upgrading: `npm run prisma:migrate:taxes` — points
  existing products at direct tax rates (idempotent; safe to re-run; the app
  works without it via a read-time fallback).

## [2.6.0] — 2026-07-10

Faster product/service entry, simpler roles-only user management, staff
permission fixes reported from production installs, and a pharmacy-friendly
A5 landscape invoice template.

### Features
- **Quick-add products & services.** Description and Unit are now the only
  required fields — brand, category, tax group, prices, code, barcode,
  discount and alert quantity are all optional (collapsed under "More
  options"). Product codes auto-generate, duplicate descriptions are allowed,
  and the invoice's inline "Add New Item" modal uses the same minimal form.
  New seeded units: Days, Weeks, Months, Package (services and products share
  one unit list).
- **A5 Landscape invoice template.** New "Pharmacy A5 Landscape" print
  template (dense 210×148 mm layout, common for pharmacy billing) selectable
  under Invoice Templates alongside the two existing formats.

### Fixes
- **Staff roles no longer need Settings permissions to create documents.**
  Lookup and compute APIs used by the invoice/purchase forms (tax rates,
  line-tax resolution, currencies, payment modes, custom fields, contact
  picker incl. quick-add) now accept any role with document permissions.
  Settings permissions gate the Settings pages only. Fixes "Permission
  denied" errors for invoice-only staff roles on production installs.
- A5/standard print styles are now selected per template, and the new
  template's per-line tax falls back to the flat line amount on invoices
  created before the tax-breakdown format.

### UI
- **Users page is roles-only.** The confusing "Type" column is gone — a
  user's Role is the single source of truth in the UI (internal system
  markers are unaffected).
- **Sidebar: single Dashboard entry.** The Dashboards dropdown is now one
  clickable menu item; switching between Overview / Sales / Accounts /
  Expenses happens via the in-page dashboard top bar.

## [2.5.1] — 2026-07-07

### UI
- **Quick dashboard switcher.** Added a compact switcher in the top bar of all 4
  dashboards (Overview, Sales & Invoices, Accounts & P&L, Expenses) so you can
  jump between them directly, without going back to the left sidebar menu each
  time.

## [2.5.0] — 2026-07-06

Customer account credit, staff activity reporting, permissions/role improvements,
and a round of customer-reported fixes.

### Features
- **Account Credit.** Grant a customer a running credit balance (goodwill, a
  timely-payment bonus, a promotional credit) from their Contact page, properly
  posted to the ledger as a liability — not a cosmetic discount. Redeem it as a
  payment method on any future invoice (no real cash/bank movement); voiding a
  credit-funded payment, or deleting the invoice it was applied to, automatically
  restores the balance. Voiding a grant is blocked if any of it has already been
  redeemed.
- **Staff Activity report.** New report (Reports → Transaction Reports) showing
  invoices created/updated/deleted and total value created, per staff member,
  with a date-range filter — built on the existing audit trail, every staff
  member appears even with zero activity.
- **Configurable default landing page per role.** Roles without Dashboard access
  no longer land on a dead-end "Unauthorized" page after login — configure a
  default landing page per role (falls back to the first module that role can
  actually view).
- **Contacts permission module.** The unified Contacts page never had its own
  entry in Role Permissions — there was no way to enable or disable it for a
  role. Added a proper "Contacts" module; existing roles with Customers access
  keep working unchanged.
- **Public quotation viewer.** Quotations can now be shared via a public,
  token-gated link (no login required) — the same pattern invoices already use.

### Fixes
- **Emailed invoice/quotation links pointed to a staff-only admin page** and
  404'd (or hit a login wall) for external recipients. Both now link to the
  correct public, token-gated viewer.
- **Invoice/purchase actions required unrelated Settings permissions.** Five
  endpoints (tax groups, the "Bill From" picker, signatures, document numbering,
  sending an invoice via WhatsApp) were gated on Settings-family modules instead
  of the document module actually using them — a role with Invoices access but
  no Settings access got silent failures or "Permission denied." Now grants
  access via either module; nothing is narrowed for existing roles.
- **UPI payment QR wasn't rendering on invoice view/print templates** (it read
  the wrong data source) and, everywhere it did render, wasn't tappable — it's
  now a real link, so tapping it on a phone opens the UPI app directly.
- **Company tax ID (GSTIN/VAT/ABN/GST No.) was missing from thermal receipts**
  even though the normal print templates already showed it.
- **Contact summary tiles (You Owe / Net Balance / Total Received / Total Paid)
  disagreed with the Statement of Account** below them on the same page — fixed
  three underlying bugs (a silent 12-month cap on totals, supplier payments
  missed when resolved only through their purchase, and draft purchases counted
  as payable).
- **Company Settings couldn't save Country/State/City** — a 500 from an
  unvalidated foreign key (now a clear error instead of a crash), plus the geo
  dataset now auto-imports on boot so country/state options are actually
  populated on self-hosted installs. Country/State accept free-typed text as a
  fallback; City is now plain text (it never needed to match a dataset).

## [2.4.1] — 2026-07-05

Deploy hardening and a round of UI polish from live-system feedback.

### Fixes — Deploy
- **Self-hosted upgrades no longer get an empty Contacts page.** The unified-Contact
  data migration (populating Contact from legacy Customer/Supplier and repointing
  document FKs) previously required a manual script; it now runs automatically and
  idempotently on `make up`/container boot, alongside the existing schema migration
  and baseline seed. Fixed a harmless-but-noisy trailing error in the migration
  (a leftover check against a column dropped by an earlier release).
- Corrected the seeded 24-hour/12-hour time-format presets, which used tokens the
  date formatter didn't recognize and rendered garbled duplicated time text (e.g.
  "1818:0707") instead of a real time.

### Fixes — Profile & navigation
- Country/state/city are no longer mandatory on the user profile — some countries
  have no city dataset, which made the profile impossible to save. Name, email,
  address, and postal code remain required.
- Removed the redundant "General Settings" entry from the left sidebar (it only
  ever linked to Profile, which is reachable from the top-right profile menu).
  Renamed the sidebar's "Website Settings" group to "General Settings".

### UI polish
- Contact/party avatars now get a distinct, consistent color per name instead of
  always purple, making long lists (invoices, purchases, contacts) easier to scan.
- Inline "Delete" buttons in list rows use a softer outlined red instead of a solid
  fill; the solid red is now reserved for the actual delete-confirmation step.
- The bank transactions list shows a helpful "Import a statement to get started"
  prompt when there are truly no transactions yet, instead of a bare empty row.
- Line-item tables on invoice/purchase/quotation/credit-debit-note/delivery-challan
  screens now use the same light-grey header as every other table in the app.
- Report summary tiles (Income, Expense, Sales, Sales Return, Quotation) no longer
  tint their icon badge red/green based on month-over-month trend — a plain metric
  like "Total Income" was rendering an alarming red badge just because the month
  was down. Added a "This month" caption so a zero value reads as a time-window
  fact, not a data bug.

## [2.4.0] — 2026-07-05

New invoicing controls (stock-aware item picker, company tax IDs on documents),
a rules-based bank auto-post tier, a design-system UI refresh across the admin,
and a large batch of customer-reported accounting fixes.

### Features
- **Company tax ID on documents.** Invoice and purchase views + print templates (and
  the public invoice viewer) now show the company's own tax registration — GSTIN
  (India), VAT No. (UK/EU), ABN (Australia), or GST No. (NZ) — chosen by the active
  tax regime.
- **Stock-aware invoice item picker.** Out-of-stock inventory-tracked products are
  blocked (unselectable) when adding invoice lines, the available quantity is shown,
  and the entered qty is clamped to stock. Services and non-tracked products are never
  blocked; purchases are unaffected (they restock).
- **Configurable item-picker fields.** New Company Settings toggles choose which fields
  show in the invoice item picker: rate, stock quantity, and product image.
- **Bank auto-post tier.** Opt-in, rules-based auto-posting for near-certain
  bank-statement matches, with an inline confidence proposal and one-click undo.
  Statement import now captures the reference/cheque column.
- **Design-system UI refresh.** New shared primitives (Button variants, FormField,
  Select, Tabs, Checkbox, Switch, Skeleton) rolled across invoices, purchases, expenses,
  banking, settings, reports, and payroll — consistent styling, accessible forms,
  overflow-safe tables, and proper empty/loading states.

### Fixes — "Deleted User" / party names
- Supplier payments, the income report, AR aging, collections, invoice/quotation email
  merge tags, AI follow-up emails, the accounts-planning dashboard, expenses
  (list/view/recurring), vehicles, the supplier-payment bank-transaction detail,
  reminders, and CSV/backup exports now resolve the party from the unified Contact
  first, so contact-linked records no longer display "Deleted User" / a blank name.

### Fixes — Accounts payable & payments
- **AP aging no longer shows a negative balance when nothing is due.** Recording a
  payment against an unapproved (pending/rejected) purchase — which has no posted bill —
  is now rejected, so an AP debit can't exist without its matching bill credit.
- **Supplier payment reference is truly optional.** A blank reference (sent as null) no
  longer fails validation; the same null-handling fix was applied to petty cash,
  expense, debit note, and purchase order forms.
- **Contact Statement of Account now includes the supplier side** (bills + payments), so
  a supplier's statement is no longer empty and partial payments are reflected.

### Fixes — Ledger, banking & reports
- Void/delete symmetry hardened: register reversals move the real amount (Decimal-safe),
  the bank register isn't double-adjusted, and the void-reversal line is marked explained
  so it stays out of the Unexplained queue.
- Period lock enforced in voidDocument; point-in-time cutover opening balances;
  balance-sheet liability buckets and fixed-asset totals reconcile.
- FX symmetry on create-as-PAID invoices; safe invoice status transitions;
  credit-note-aware payment voids; petty-cash returns reject non-positive/NaN amounts.
- UTC-safe, inclusive month boundaries across accounting/transaction reports; summary
  tiles computed over the full filtered set; draft debit notes excluded from supplier
  balances.
- Bank reconciliation link exclusivity + unlink protection; already-explained
  transactions can't be re-linked.

## [2.3.5] — 2026-07-01

Bug-report fixes (purchases, invoices, payments), robust image-upload handling,
and mobile app fixes.

### Fixes — Purchases & Invoices (web)
- **New purchase now moves inventory stock.** The Add Purchase form defaulted the
  status so a directly-created purchase sat below the inventory gate (only PO→purchase
  conversion moved stock). It now defaults to `pending` (goods received); the `new`
  status is relabelled "New (Draft — no stock)".
- **Editing a purchase no longer fails with "Invalid bill from user or supplier".**
  `updatePurchase` was legacy-supplier-only and rejected contact-based purchases; it is
  now contact-aware (accepts `contactId`, treats empty `supplierId` as none).
- **Converted purchases keep their supplier** instead of showing "Deleted User" — the
  PO→purchase conversion now carries the `contactId` through. Dashboard "Recent
  Purchases" also falls back to the legacy supplier name.
- **Purchase "Bill To" and invoice "Invoice To" now show address + GSTIN.** Contact
  address fields were never selected and `billingAddress` was hardcoded null; both are
  now populated from the unified Contact.
- **Deleting an invoice restores inventory stock** (mirroring purchase-delete), skipping
  PROFORMA and service items.
- **Record Payment** surfaces the real backend error instead of a generic "Failed to
  record payment"; the reference/cheque number is confirmed optional. Petty-cash `dueAmount`
  hardened against NaN.

### Fixes — Image uploads (web)
- **Wrong file types no longer cause 500/404.** The shared upload middleware (used by
  customers, suppliers, profiles, signatures, staff, expenses, etc.) had no file filter
  or size limit. It now rejects non-images with a clean 400 (documents/PDF still allowed
  on attachment fields), enforces a 10MB limit, and the shared cropper rejects bad
  type/size up front with a clear message and hides broken thumbnails.

### Fixes — Mobile app
- App no longer crashes on launch (root wrapped in `GestureHandlerRootView`).
- Icons render correctly (react-native-vector-icons fonts registered in iOS `Info.plist`).
- Dashboard "Add a Quick" cards, Quick Access icons, and the bottom "Add New" sheet now
  navigate (dead/no-op handlers wired; a PanResponder that swallowed taps fixed).
- Optional default server URL so demo builds land straight on login.

---

## [2.3.3] — 2026-06-30

A bugfix release for baseline-seed data persistence.

### Fixes
- **Deleted/disabled currencies no longer reappear after a restart, and the
  chosen default currency is no longer reset.** The baseline boot seed (which
  runs on every container start) upserted currencies with an `update` clause
  that forced `status=true`, `isDeleted=false`, and the seed `isDefault` values
  on existing rows. So each restart resurrected user-deleted currencies,
  re-enabled disabled ones, and flipped the default currency back to INR. The
  seed now refreshes display fields only (name/code/symbol) and never overrides
  a tenant's status/deletion/default choices. `create` still applies sensible
  defaults for brand-new currencies.
- The same fix is applied to **payment modes** — a disabled payment mode is no
  longer re-enabled on the next boot.

  Note: currencies already resurrected by a prior restart need to be deleted
  once more after upgrading; from then on they stay deleted.

---

## [2.3.2] — 2026-06-30

A bugfix release for first-run onboarding.

### Fixes
- **Setup no longer flickers between `/setup` and `/admin/login`** — the
  organization-setup screen fetched its dropdown data without an auth header,
  which returned 401 and triggered the global handler to bounce to
  `/admin/login`; that route doesn't exist in the setup-pending state, so the
  router redirected straight back to `/setup`, producing an infinite loop.
  The setup screen now sends its auth token with the dropdown request.
- The global 401 handler (and the session-expiry watchdog) no longer redirect
  to login while on the `/setup` or `/register` onboarding pages, so a transient
  401 there can never re-introduce the redirect loop.
- **Empty state & unit dropdowns on a fresh install** — the baseline boot seed
  now loads the full country/state dataset (250 countries / 5308 states) and a
  base set of units (Pieces, Hours, Kilograms, Box, Litres). Previously only a
  handful of states were seeded and units were demo-only, leaving those
  dropdowns blank on a clean install. The geo import is idempotent and runs once
  (guarded by a state-count check), so reboots are not slowed.
- **Tax rates/accounts now seed at company setup** — completing the setup wizard
  applies the matching country pack (chart of accounts, ledger role mappings,
  tax regime, and default tax rates/groups) for the chosen country, and persists
  the country FK so that resolution works. Previously the pack only ran from the
  settings page, so a freshly set-up tenant had empty tax-rate dropdowns. The
  selected currency is also marked active + default. Idempotent and non-fatal —
  it never blocks setup, and the Ledger Setup Wizard cutover is unaffected.

---

## [2.3.1] — 2026-06-29

A functional + UX hardening release: a rebuilt recurring-invoice engine,
read-only detail views across the app, and a batch of save/display fixes.

### Recurring invoices (rebuilt)
- Recurring invoices are now a **separate, non-posting schedule** instead of a
  live posted invoice. Creating/editing a schedule no longer books to the
  ledger or moves stock — only the invoices it generates do.
- Full lifecycle: **Active / Paused / Resume / End / Completed**, with end
  conditions (end date or after N occurrences) and an occurrences history.
- A dedicated schedule editor (no longer editing a real invoice); the legacy
  "Is Recurring" toggle was removed from the invoice editor.

### New detail (view) pages
- Read-only **view pages** for Purchase Orders, Products, Inventory items, and
  Expenses (with an inline attachment viewer). Clicking a row opens the view;
  Edit/Delete remain as inline actions.
- Inventory item view shows stock details + full **activity history** (signed
  movements with running balance).

### Fixes
- **Logos now show on a fresh install** — every logo render site falls back to
  the bundled logo when no company logo is uploaded (previously blank).
- **Editing invoices / quotations / credit notes / delivery challans** no
  longer fails to save — the contact party is resolved and written correctly
  (was a Customer foreign-key error / silent drop after the Contacts migration).
- **Inventory history** shows signed adjustments (+ for stock-in, − for
  stock-out) and distinguishes **Sales Return** vs **Purchase Return**.
- Document detail views no longer crash on amounts (currency values coerced
  before formatting).
- **Supplier Balances** report added (bills / payments & returns / balance due);
  a contact's "You Owe" now matches it.
- Outgoing email **From** address is taken from Settings → Email.
- List cleanups: redundant "View" three-dots removed (row opens the view);
  Categories / Brands / Units show Edit/Delete as inline buttons.
- The sidebar keeps the correct menu highlighted on document view pages.

---

## [2.3.0] — 2026-06-26

A design-system + UX release: one consistent look across every page, a
consolidated navigation, app-wide date/time/timezone formatting, and a batch
of functional fixes.

### Design system (unified look across all pages)
- New typeface **Instrument Sans** loaded app-wide (the app previously rendered
  the system font everywhere)
- A single brand colour (`#7539FF`) and a navy-tinted neutral palette, defined
  as theme tokens — retiring ~90 hardcoded colours and the three competing
  "primary" button styles
- Generic **Button / Card / Badge** components adopted across the app
  (~200 buttons, status pills now consistent soft-colour badges)
- Colourful stat cards + status badges; charts recoloured to the brand palette
- Consistent flat controls (one radius, one card shadow, one input style)

### Navigation & layout
- Every page's title + primary actions now live in the **top bar** (consistent
  page headers everywhere)
- **Sidebar consolidated** from 47 top-level entries to ~12 grouped sections
  (Sales, Purchases, Products & Inventory, Banking & Finance, Payroll,
  Accounting, Reports, Administration, …) with accordion behaviour
- Content now **scrolls to top on navigation** (no more landing mid-page after
  clicking a menu item)
- Top-bar dropdowns no longer hide behind page content; dashboard tables aligned

### Localization (now applies everywhere, not just tables)
- The configured **date format, time format, and timezone** now apply across
  create/edit forms, reports, documents, emails, and dashboards
- Dates render in the organisation's configured timezone (was the viewer's
  browser timezone)

### Fixes
- **Editing an invoice/proforma** no longer 500s (party resolved correctly
  after the Customers→Contacts migration)
- **Recording a supplier payment** no longer fails validation (422)
- **Products** can be added with a "Track inventory + opening stock" option so
  they appear on the Inventory page
- **Banking**: explained transactions show the type + details; un-explaining
  keeps your prior selection for re-edit; redundant column removed
- **Purchase view**: status + payment summary moved into the page body (was
  cramped into the top bar), matching the invoice view
- Demo seed now creates **Contacts** (Contacts page populated) + budgets,
  approvals, banking categories, and a default tax group

---

## [2.2.3] — 2026-06-25

QA bug-fix release. Resolves ~45 issues from the testing pass across blockers,
currency, reports, modules, and UI.

### Blockers
- Bank account creation works (clear field validation + opening balance 0 allowed)
- Purchase / Purchase-Order product dropdown lists all products (was filtered to the default currency)
- Cash payments no longer require a bank account; payment modes are seeded on every install
- Sending invoice/quotation email fails gracefully ("configure email in Settings") instead of erroring
- Editing a Purchase Order works for contact-based POs

### Currency
- The configured default currency now applies across the app — Purchase Orders converted to Purchases keep their currency, and report/summary totals use the configured currency instead of a fixed ₹

### Reports
- Suppliers/customers resolve correctly in all reports (no more "Deleted user")
- Sales-Return report honours its filters; Sales report stat cards reflect active filters
- AR/AP aging amounts format correctly and the report refreshes on date change
- Sales report surfaces load errors instead of a silent blank

### Modules
- Product status can be set inactive; inventory-enabled products appear on the Inventory page
- Transaction categories save (correct group values + account selection)
- Custom field types are respected (date/number/email/etc.), and saved settings display
- Invoice number auto-generation honours the configured next-number and prefix; recurring-invoice children appear in the invoice list; recurring-expense "Run" creates the entry
- Expense editing works; profile mandatory-field validation shows errors
- Quotation send-email no longer overwrites a declined quote, and the quotation view no longer crashes
- Credit-note editing keeps the saved e-signature
- Budgets page loads accounts; payroll employee dropdown lists workspace staff; manual payments appear under Payment Transactions
- Purchase list shows the real payment mode; dashboard expense widget no longer errors; P&L-by-dimension renders correctly

### UI
- Dropdown menus have a solid background; tables scroll on overflow; long inputs are length-capped
- Terms & Conditions preserve line breaks on invoice/quotation/challan templates; logos are sized cleanly; report print views exclude on-screen chrome
- Inventory history shows dates; create/edit date pickers honour the configured date format

### Notes
- Custom roles need a manual grant for the new Payroll / My-Money permission modules
- Email, payment gateways, and bill-scan remain bring-your-own-key with demo fallbacks; running the geo import populates states for all countries

---

## [2.2.2] — 2026-06-25

Feature + maintenance release: bank reconciliation overhaul, supplier-payment
completion, and security hardening.

### Bank reconciliation

- **Per-bank reconciliation.** Each bank account now has its own ledger account,
  so every bank reconciles independently: opening balance + explained
  transactions ties to the bank's balance and to the general ledger
- **Clicking a bank** opens that bank's transactions with the full
  explanation/approval workflow (previously a bare reconcile toggle)
- **Each transaction shows what it's explained as** — e.g. "Invoice INV-000123 —
  Acme Corp", the bill and supplier, or the expense category — with a link to the
  source document
- **Automatic matching + one-click approval.** Unexplained transactions are
  auto-analysed against open invoices, bills and expenses (by amount, date,
  party and reference) and learn from how similar payees were explained before;
  a confident match is queued for approval and posts with a single click
- Payments recorded against invoices/bills now auto-explain their bank line on
  creation (and can no longer be double-posted by explaining them again)
- Clearer filters (search, category, type, status, reconciled, date) and a
  per-bank in-balance / difference indicator

### Contacts

- Fixed the contact detail tabs (Invoices, Bills, Estimates, Recurring, Account
  History, Notes) that failed to load or crashed; each now loads and shows the
  related documents
- **Contacts** is now a top-level menu item; the separate Customers and Suppliers
  menu entries are removed (the unified Contacts list replaces both)
- Suppliers resolve correctly across the app (no more "Supplier Deleted User")

### Supplier payments & security

- Supplier payment list, update and "new payment" work with the unified Contact;
  payments show the correct party
- Tenant-isolation hardening: purchase and supplier-payment records are scoped to
  the authenticated account on read, update and delete (closes cross-account
  access paths)

---

## [2.2.1] — 2026-06-25

Maintenance release. Fixes field-reported regressions from the 2.2.0 Contacts
migration and completes document-driven inventory.

### Authentication & session

- **Registration no longer loops between setup and login.** The token issued at
  registration is now stored where the rest of the app reads it (cookie + state)
  so the first sign-in after setup is recognised
- **Idle/expired sessions now sign out cleanly.** Previously an expired session
  still rendered the full menu and errored on click; the app now checks token
  validity at startup and proactively while idle, and redirects to login
- Auth cookies are marked `secure` only over HTTPS, so the session persists on
  HTTP-only self-hosted installs

### Contacts display

- Fixed a white screen on the Dashboard and several list/template/email pages
  caused by reading a party field on a contact-based document that has no legacy
  customer/supplier record; party details now resolve from the unified Contact
- Suppliers now resolve from Contacts across the Dashboard and purchase lists
  (no more "Supplier Deleted User"); supplier counts and recent-supplier widgets
  reflect real transaction relationships

### Inventory

- **Stock now adjusts on every document** through one shared engine: purchases
  increase stock on goods-receipt (not only when paid), invoices decrease it,
  debit notes (purchase returns) decrease it, and credit notes (sales returns)
  increase it — with WAC/FIFO valuation and movement history. Editing a document
  reverses and re-applies its stock symmetrically
- Product pages and the product list now show **live** stock (from the inventory
  ledger, not a frozen field) with low-stock / out-of-stock badges
- A purchase payment no longer incorrectly moved stock; returned goods restock at
  book cost (no valuation drift)

### Documents

- Debit Note (purchase return): the source-purchase selector is populated again
  (it previously listed only fully-paid purchases)
- Supplier Payments: "New Payment" works again — the party is sent and validated
  as a Contact
- New/Edit Quotation: the Sales Person dropdown falls back to all users when no
  sales-person role is configured, so the field is never blocked

---

## [2.2.0] — 2026-06-24

Feature release. Unifies Customers and Suppliers into a single organisation-centric
**Contacts** model, and adds **per-contact tax treatment** that drives how tax is
applied and posted across every supported country.

### Contacts

- **Customers and Suppliers are now one Contacts list.** A contact is built around
  its organisation, with separate person + company identity, full invoicing address,
  communication details, currency, and per-contact invoicing options. Whether a
  contact is a *client* or a *supplier* is derived from its transactions — the same
  contact can be both
- The contacts list offers grid/list views and derived filters (active clients,
  active suppliers, clients with open invoices, suppliers with open bills, hidden,
  all), with search, alphabetical sort, and pagination
- Each contact has a profile card: a 12-month received/paid chart, outstanding
  balances ("they owe" / "you owe"), all-time totals, a per-currency statement,
  account history, notes, and a downloadable vCard
- **Every document is contact-based** — invoices, quotations, credit notes, delivery
  challans, purchases, purchase orders and debit notes now select a Contact, and a
  document's currency defaults from the chosen contact. Existing Customer/Supplier
  data was migrated into Contacts (matching parties merged); legacy customer/supplier
  list pages redirect to Contacts
- CSV import/export for contacts

### Tax treatment

- **Per-contact tax treatment** (Standard / Zero-rated / Exempt / Reverse charge /
  Out of scope) sets the default tax behaviour for that contact's documents, and is
  overridable per document on create and edit
- A non-standard treatment suppresses tax authoritatively: the document posts no
  output/input VAT/GST leg and the line taxes are zeroed — applied uniformly across
  all country packs (UK, EU, India, US, Australia, New Zealand). Standard documents
  are completely unchanged
- Invoice and estimate templates label the treatment (e.g. "Reverse charge —
  recipient to account for tax", "Zero-rated supply") and show the party's
  VAT/GST registration number; the tax summary surfaces a reverse-charge total

### Notes

- Statutory tax filing for EU/UK/AU/NZ, automatic place-of-supply, reverse-charge
  self-accounting entries, and US sales-tax automation remain planned (Spec H);
  India GSTR-1/3B export is unchanged

---

## [2.1.0] — 2026-06-23

Feature release. Adds **"My Money" Phase 2 — payroll**: manual monthly pay runs
that accrue a salary-owed liability, settled from the bank, surfaced as
owed / paid / outstanding per person. Also ships a scoped demo-data purge
script and a sidebar fix.

### Payroll (My Money Phase 2)

- **Pay runs**: maintain per-employee payroll profiles and run payroll for a UK
  tax-month, entering gross pay and manual deductions → net. Finalizing a run
  posts a balanced accrual per employee — **Dr Net Salary & Payroll (9230) /
  Cr Net Wages Payable (9260) / Cr Payroll Deductions Payable (9270)** — and
  can be voided (reverses the entries), guarded against voiding a settled run
- **Settlement**: a new bank payment reason **"Salary — settles payroll run"**
  clears the Net Wages Payable liability (Dr 9260 / Cr Bank). Existing direct
  "Net Salary" payments are unchanged
- **My Money → Salary** now shows real **owed − paid = outstanding** (replacing
  the Phase-1 placeholder), with legacy direct payments listed separately
- New ledger accounts **9260 Net Wages Payable** and **9270 Payroll Deductions
  Payable** are provisioned automatically (with a backfill for existing
  companies). No PAYE/NI/RTI/payslips yet (planned Phase 3)

### Tooling

- **Scoped demo-data purge** (`npm run prisma:clear:demo`): removes the demo
  tenant's data and users while leaving baseline/global data intact. Dry-run by
  default; pass `--confirm` to execute. Counterpart to the demo seeders

### Fixes

- **Sidebar**: the *Inventory* item no longer stays highlighted on the
  *Cost Layers (FIFO)* page (sub-link active-match is now exact)

---

## [2.0.1] — 2026-06-22

Maintenance release. Fixes invoice payment/recurring workflows, completes the
purchase vendor→Supplier migration for debit notes, and clears several
console errors and save failures.

### Invoicing

- Partial-payment dialog no longer renders off-screen / unscrollable — the
  modal now renders through a portal so it isn't trapped by the toolbar's
  backdrop blur
- Edit Invoice now shows correct **Paid** and **Remaining** amounts (the
  single-invoice endpoint now returns payment totals)
- Disabling **recurring** on an invoice now saves correctly (multipart boolean
  flags were parsed as always-true); also fixes the related roundOff /
  neverExpire / stopped flags
- Saving an issued (non-draft) invoice no longer triggers an erroneous full
  update; editing a draft no longer fails with a "locked period" (423) error
- Recording a partial payment no longer fires a stray invoice update

### Purchases

- **Debit notes**: vendor and bill-to are now sourced from the Supplier table
  (completing the vendor→Supplier migration). Creating a debit note — selecting
  the Bill To supplier and saving — works again (was "invalid vendor id" / 422)
- Supplier with no logo no longer requests a missing default image (console 404)

### Settings

- Updating the profile photo no longer fails when no gender is selected (500)

### Other

- E-invoice lookup returns an empty result instead of a noisy 404 when no IRN
  record exists yet

---

## [2.0.0] — 2026-06-19

Second CodeCanyon release. Adds configurable payment-link methods and a
gateway settings UI, restores shared-workspace multi-admin data access, and
delivers a broad pass of accounting-report and invoice-workflow fixes.

### Payments

- Configurable payment methods per public payment link — choose which
  gateways/methods a customer sees on the token-gated payment page
  (new payment-link method controller + public route)
- Payment Gateways settings screen (Settings → Payment Gateways) for
  managing Razorpay / Stripe BYOK keys and enabling methods from the UI

### Accounts and Users

- Shared-workspace tenancy restored: all admins in a workspace now see the
  same data (tenant-scope helper + auth middleware)
- User-owner model: new `user_owner` and related migrations with an
  idempotent owner seed for consistent data attribution
- `/api/healthz` now exposes a `demo` flag for environment detection

### Reporting

- Accuracy and formatting fixes across GSTR-1, GSTR-3B, Profit & Loss,
  Balance Sheet, Trial Balance, Tax Summary, AR/AP Aging, Cash Flow
  Forecast, Budget Variance, and Collections reports
- New shared aging-bucket and invoice-status utilities for consistent
  status and ageing calculations across reports and lists

### Invoicing

- Invoice create / edit / view, templates A and B, email invoice, and the
  public invoice viewer refined for consistency and correctness
- Unified invoice-status handling across invoice and purchase lists

### Other

- Bank-detail, customer, expense, and purchase handling improvements and
  validation fixes

---

## [1.0.0] — 2026-06-11

Initial CodeCanyon release.

### Invoicing and Documents

- Invoices with recurring schedules, customisable templates, and public
  payment links (token-gated, no login required for customers)
- Quotations / estimates with convert-to-invoice workflow
- Credit notes and debit notes
- Delivery challans
- Purchase orders and purchase bills
- Expenses with receipt file attachments

### Finance and Accounting

- Double-entry ledger engine with six country accounting packs: India (IN),
  EU, UK, US, Australia (AU), New Zealand (NZ)
- Opening-balance cutover wizard (Settings → Finance → Ledger Setup)
- Profit & Loss, Balance Sheet, and Trial Balance statements
- AR and AP aging reports
- Budgets and cost centres
- Fixed assets register
- FIFO and weighted-average cost (WAC) inventory valuation
- Per-document multi-currency: customers and suppliers each carry an
  independent currency; ExchangeRate table for expense foreign-exchange
  conversion
- Maker-checker approvals workflow (off by default, configurable per
  document type)

### Payments

- Razorpay and Stripe payment gateways (BYOK — Bring Your Own Key)
- Webhook signature verification for both gateways
- Offline payment recording
- Partial payments and refunds

### Reporting

- Transaction reports, tax reports, GST filing reports (India), dimension
  / P&L reports, bank reconciliation, and summary dashboards

### Customers and Suppliers

- Customer master with per-customer currency and contact management
- Supplier master with per-supplier currency
- AR/AP aging per customer and supplier

### Roles and Users

- Five default roles seeded on first boot: Admin, Vendor, Staff, Maintainer,
  Supplier
- Permission checkboxes for UI-level access control
- Custom roles configurable in Settings

### Integrations

- SMTP email (env or in-app UI configuration; Resend also supported)
- AI document extraction and chat assistant (BYOK Claude or OpenAI; built-in
  mock fallback when no key configured)
- WhatsApp CRM bridge: SSO exchange and server-to-server customer sync
- Signature capture and storage

### Operations

- Docker Compose stack: PostgreSQL 16, Node.js 20 API, React + nginx web app
- Automatic database migration on container boot (`prisma migrate deploy`)
- Idempotent baseline seed (currencies, timezones, roles, modules)
- Optional demo seed with pre-provisioned admin account
- Make targets for common operations (`make up`, `make logs`, `make smoke`, etc.)
- `/api/healthz` and `/healthz` health check endpoints
