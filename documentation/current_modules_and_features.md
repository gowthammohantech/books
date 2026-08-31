# Current Modules and Features

**Scope:** what Elixir Books ships today, and which modules are absent relative to a
full ERP.

**Basis:** derived from the codebase on branch `pc-cc`. No requirements documents
were supplied with this request, so every claim below is traceable to a file in
this repo rather than to a product spec.

**Sources of truth**

- Navigation tree — `apps/web/src/lib/navigation.tsx`
- Route table — `apps/web/src/routes/AdminRoute.tsx`
- API surface — `apps/api/routes/adminRoutes.js`
- Data model — `apps/api/prisma/schema.prisma`
- Permission modules — `apps/api/prisma/seedModules.ts`

**Scale at a glance**

| Dimension | Count |
|---|---|
| Prisma models | 101 |
| Backend controllers | 101 |
| Admin API routes (all permission-gated) | 439 |
| Frontend admin routes | 162 |
| Frontend page components | 199 |
| Test files (`*.spec.ts` + `tests/*.test.ts`) | 199 |

**Stack:** PostgreSQL 16 + Prisma · Express 5 + TypeScript · React 19 + Vite.
Multi-tenant (`Tenant`, `TenantMembership`, `TenantApiKey`). PostgreSQL is the
sole datastore.

---

## Part 1 — Modules and features that exist today

### 1. Dashboard

Three role-oriented views plus a switcher.

| Feature | Location |
|---|---|
| Sales dashboard | `pages/admin/dashboard/SalesDashboard.tsx` |
| Expenses dashboard | `pages/admin/dashboard/ExpensesDashboard.tsx` |
| Accounts dashboard | `pages/admin/dashboard/AccountsDashboard.tsx` |
| Dashboard switcher | `components/admin/DashboardSwitcher.tsx` |
| Backend | `controllers/Admin/dashboardController.ts`, `dashboardPlanningController.ts` |

### 2. Contacts

Unified party master intended to replace the separate Customers and Suppliers
screens.

- Contact list, contact card, contact form
- Credit grants (`GrantCreditModal`, `AccountCreditEntry` model)
- Customer statement (`pages/admin/customers/CustomerStatement.tsx`)
- Models: `Contact`, plus legacy `Customer` and `Supplier` still in place

> The migration is incomplete. See `need_to_modify_modules_and_features.md` §1.

### 3. Sales

| Sub-module | Features |
|---|---|
| Invoices | Create / edit / view / email, three print templates (A, A5 landscape, B), template manager, numbering config, payment modal, bank-account and signature modals |
| Recurring Invoices | Schedule builder, cron runner (`lib/recurringInvoiceRunner.ts`) |
| Credit Notes | Create / edit / overview |
| Quotations | Create / edit / view / email, print template, convert-to-invoice, reminder cron |
| Delivery Challans | Create / edit / view, print template |
| Vehicles | Create / edit / list (delivery logistics) |
| Public viewers | Token-based invoice and quotation viewers, no login required |

### 4. Purchases

Purchases, Purchase Orders, Debit Notes, Supplier Payments, Supplier Balances,
payment capture modals.

### 5. Items & Inventory

Products/Services (with custom fields and a `barcode` field), Categories, Brands,
Units, Inventory stock view, FIFO Cost Layers (`InventoryCostLayer`),
weighted-average cost (`quantityOnHand` / `avgCost`), landed-cost allocation.

### 6. Banking & Finance

Bank accounts, bank transactions, statement import, reconciliation with an
auto-matcher (`lib/reconciliationMatcher.ts`), transaction explanation hints,
Expenses and expense categories, Recurring Expenses, Payment Transactions,
Petty Cash, and a "My Money" personal ledger.

### 7. Payroll & Time

Payroll Profiles, Pay Runs (`PayRun`, `PayRunLine`), Timesheets and approvals,
Time Reports, Leave (my leave, approvals, types, allocations, report), Holidays.

### 8. Accounting

The deepest area of the product.

- Chart of Accounts, Journal Entries, Accounting Periods, Ledger Setup wizard
  with country packs (IN / EU / UK / US / AU / NZ), ledger cutover
- E-Invoices (IRN) via pluggable providers
- Budgets, Fixed Assets with depreciation, Approvals Queue
- Dimensions: Cost Centers (profit centers) and Projects
- **Financial statements:** P&L, Balance Sheet, Trial Balance, Tally Check
- **Finance reports:** AR Aging, AP Aging, Collections, Budget Variance,
  Cash Flow Forecast, P&L by Dimension, P&L by Department
- **Tax reports:** Tax Summary, GSTR-1, GSTR-3B, Tax Returns, UK HMRC MTD panel

### 9. Operational Reports

- **Transaction:** Sales, Sales Return, Purchase, Purchase Order,
  Purchase Return, Quotation, Staff Activity
- **Accounting:** Income, Expense
- **Inventory:** Stock, Low Stock, Out of Stock

### 10. Administration

Users/Staff, Roles & Permissions (slug-based, four actions — view / create /
edit / delete — plus `allowAll`), Activity Log backed by a Prisma audit extension
(`lib/auditExtension.ts`, `AuditLog`), AI Extraction history.

### 11. Settings

| Group | Contents |
|---|---|
| General | Company settings, Localization |
| System | Email settings, Email templates, Signatures, Reminders |
| Finance | Bank accounts, Tax rates and groups, Currencies and exchange rates, Ledger Setup, Document Defaults, Transaction Categories |
| Payments | Payment gateways, Stripe, Razorpay, payment-link methods, refunds |
| Integrations | Accounting integrations, Messaging (WhatsApp) |
| AI | AI provider configuration |
| Module Settings | Per-module custom fields and preferences for Invoice, Purchase, PO, Quotation, Expense, Product, Category, Brand, Unit |

### 12. Cross-cutting subsystems (no nav entry)

| Subsystem | Location |
|---|---|
| AI layer — providers, prompts, tools, chat, extraction jobs, usage metering (39 endpoints, the largest single namespace) | `lib/aiProviders`, `lib/aiPrompts`, `lib/aiTools`, `services/ai` |
| Tax engine — GST, EU VAT, VIES validation | `lib/taxEngine.ts`, `lib/euVat.ts`, `lib/vies.ts` |
| E-invoice providers | `lib/einvoiceProviders` |
| Ledger posting packs | `lib/ledger/packs` |
| Export engine | `lib/export` |
| Cron runners — invoice and quotation reminders, recurring invoices, recurring expenses | `*Cron.ts` at backend root |
| Multi-currency and exchange rates | `ExchangeRate`, `currencyController.ts` |
| Multi-tenancy and API keys | `lib/tenantContext.ts`, `lib/tenantGuard.ts`, `lib/tenantApiKey.ts` |
| Document numbering | `lib/documentNumbering.ts`, `Counter` |
| Custom fields | `CustomField`, `CustomFieldValue`, `lib/customFieldValues.ts` |

---

## Part 2 — Modules missing for ERP

Each gap below was verified by probing `prisma/schema.prisma` for the
corresponding domain concept. Grouped by how badly it blocks the ERP label.

### Tier 1 — Blocks the ERP claim outright

| Missing module | Evidence | Consequence |
|---|---|---|
| **Warehouse / multi-location inventory** | No `Warehouse` or `Location` model. `Inventory` is one row per product with a single `quantityOnHand`. `branchName` appears only on `BankDetail`, where it means a bank branch. | No stock transfers, no bin/rack, no per-location valuation, no multi-branch stock or P&L. Every fulfilment feature depends on this. |
| **Manufacturing / production** | No BOM, routing, work order, work centre, or job-costing models. | Cannot serve make-to-stock or assemble-to-order businesses. No kitting. |
| **Procure-to-pay workflow** | No Purchase Requisition, no RFQ or vendor-quotation comparison, no Goods Receipt Note as a distinct document, no three-way match. | Purchasing is document entry, not a controlled process. `ApprovalsQueue` is accounting-scoped only. |
| **Order-to-cash workflow** | No Sales Order model. The chain jumps Quotation → Invoice. | No order backlog, no partial fulfilment, no ordered-vs-delivered-vs-invoiced tracking. |
| **CRM** | No Lead, Opportunity, Pipeline, Campaign, or Activity/Task models. `Contact` is a billing entity. | No pre-sales pipeline at all. |

### Tier 2 — Expected in any mid-market ERP

| Missing module | Notes |
|---|---|
| **HRMS beyond payroll** | Present: PayrollProfile, PayRun, Leave, Holidays, Timesheets. Missing: employee master (payroll rides on `User`), attendance and shift management, recruitment, onboarding, appraisal, org chart, statutory filings (PF/ESI/TDS, P60/P11D). |
| **Batch / serial / expiry tracking** | No lot or serial models. Blocks pharma, food, electronics, and every regulated vertical. |
| **Logistics & shipping** | No shipment, carrier, tracking, or freight models. `DeliveryChallan` is a printable document, not a fulfilment record. |
| **Project accounting** | `Project` and `CostCenter` are reporting dimensions only. No WBS, milestone billing, percentage-of-completion revenue, or budget-vs-actual burn. |
| **Subscription / recurring revenue** | `RecurringInvoiceSchedule` covers repeat billing. No plan catalogue, usage metering, proration, dunning, or MRR/churn reporting. |
| **Document management** | `uploads/` is a flat folder. No document model, versioning, or attachment-to-record linkage. |
| **Notification engine** | `NotificationType`, `NotificationTag`, and `NotificationTypeTag` models exist but are vestigial. No in-app inbox, no delivery preferences. Reminders are cron plus email only. |

### Tier 3 — Vertical and maturity gaps

| Missing module | Notes |
|---|---|
| POS & retail | `barcode` is a product field only. No scanning, till, shift-close, or offline mode. |
| Quality management | No inspection, NCR, or CAPA. |
| Multi-company consolidation | Tenancy exists; intercompany transactions, eliminations, and group consolidation do not. |
| Asset lifecycle | `FixedAsset` and depreciation exist; maintenance schedules, custody/assignment, and disposal workflow do not. |
| Service management | No ticketing, AMC or warranty contracts, or field service. |
| Demand planning | No reorder point, safety stock, MRP, or forecasting. |
| Rental / hire | No rental agreements or availability calendar — notable, since `Vehicle` already exists. |
| BI layer | Reports are fixed. No ad-hoc report builder, no user-defined dashboards. |
| Extensibility | `CustomField` covers extra fields. No webhooks, event bus, or public API. `TenantApiKey`, in progress on this branch, is the start of it. |

---

## Summary judgement

Elixir Books is a **complete financial and accounting core** — arguably stronger
in double-entry accounting, multi-jurisdiction tax, and AI-assisted document
capture than many full ERPs. What it is not, yet, is an ERP: it has no
**operations** layer. The five Tier-1 gaps — warehouse, manufacturing,
procure-to-pay, order-to-cash, and CRM — are what separate "books" from
"enterprise resource planning".

See `for_erp_grade_required_modules_and_features.md` for the build-out plan, and
`need_to_modify_modules_and_features.md` for the existing modules that must be
reworked first.
