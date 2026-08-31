# Modules and Features That Need Modification

**Scope:** things that already exist in Elixir Books but are incomplete, drifted,
duplicated, or structurally in the way of the ERP build-out.

**Basis:** derived from the codebase on branch `pc-cc`. No requirements documents
were supplied with this request, so this is a code-evidence audit rather than a
spec-conformance review. Every item names the file that demonstrates it.

**Severity key**

| Level | Meaning |
|---|---|
| **P0** | Correctness or access-control defect visible to users today |
| **P1** | Structural blocker — an ERP module cannot be built cleanly until this is fixed |
| **P2** | Drift, duplication, or dead code that raises the cost of every future change |

---

## 1. Contacts migration is half-finished — **P1**

`Contact` was introduced to unify `Customer` and `Supplier`, and the legacy
screens now redirect to the Contacts page. The data layer never followed.

**Evidence**

- 15 controllers still query `prisma.customer` / `prisma.supplier`, including
  every document controller: `Admin/Invoice/invoiceController.ts`,
  `Admin/Invoice/quotationController.ts`, `Admin/Invoice/creditNoteController.ts`,
  `Admin/Purchases/purchaseController.ts`, `purchaseOrderController.ts`,
  `debitNoteController.ts`, `SupplierController.ts`, plus
  `dashboardController.ts`, `reminderController.ts`, `exportController.ts`,
  `customerController.ts`, `externalController.js`, `ConversationController.ts`,
  `TaxRateController.ts`, `Admin/AI/aiController.ts`, `aiExtractionController.ts`
- Only 5 controllers use `prisma.contact`: `accountCreditController.ts`,
  `Admin/Purchases/supplierPaymentController.ts`, `exportController.ts`,
  `TaxRateController.ts`, `timeTracking/projectMemberController.ts`
- `prisma/seedModules.ts` lines 34-41 carry an explicit comment acknowledging
  the split, and seed **both** `contacts` and `customers` permission slugs;
  `routes/adminRoutes.js` accepts either for the contacts endpoints

**Why it matters:** a party can exist twice with divergent data. Every ERP
module in the plan (Sales Order, CRM, GRN, shipments) needs one party master to
point at. Building them against a forked identity doubles the migration cost.

**Action:** finish the cutover. Move the 15 remaining controllers to `Contact`,
backfill and reconcile duplicates, reduce `Customer` / `Supplier` to views or
drop them, then retire the `customers` and `suppliers` permission slugs.

---

## 2. Eight permission modules are seeded but never enforced — **P0**

`prisma/seedModules.ts` creates permission modules that no route checks. Admins
toggle them in the Roles UI and nothing changes.

**Evidence** — zero occurrences in `routes/adminRoutes.js`:

| Seeded slug | Seeded at | Actually enforced by |
|---|---|---|
| `bank-transactions` | seedModules.ts:58 | nothing |
| `system-settings` | seedModules.ts:81 | nothing (`general-settings` gates these routes) |
| `brands` | seedModules.ts:26 | nothing (`product-services`) |
| `categories` | seedModules.ts:25 | nothing (`product-services`) |
| `units` | seedModules.ts:27 | nothing (`product-services`) |
| `transaction` | seedModules.ts:59 | nothing |
| `finance-reports` | seedModules.ts:75 | nothing |
| `other-settings` | seedModules.ts:84 | nothing |

Parent group slugs (`main`, `inventory-sales`, `purchases`,
`finance-accounting`, `reports`, `manage-users`) are also unenforced, but that
is by design — they are headers.

**Why it matters:** an admin who revokes `bank-transactions` or `system-settings`
from a role believes access is gone. It is not. This is a silent
least-privilege failure, and it will be found by the first customer security
review.

**Action:** for each slug, either wire it into the matching
`requirePermission(...)` calls or remove it from the seed. `bank-transactions`
and `system-settings` should be wired; `brands` / `categories` / `units` should
most likely be removed in favour of `product-services`.

---

## 3. Client-side permission gating fails open while the server fails closed — **P0**

**Evidence**

- `elixirbooks-typescript-frontend/src/lib/navigation.tsx:883-892` —
  `canView` returns `true` when no permission row matches the slug
- `elixirbooks-typescript-backend/middleware/requirePermission.ts:40-49` —
  returns 403 when no permission row matches
- All 439 routes in `routes/adminRoutes.js` carry `requirePermission`

**Two consequences**

1. The nav shows entries the user cannot actually open. Clicking gives a 403 or
   an empty screen instead of the item being hidden.
2. The comment at `navigation.tsx:888-889` states *"server-side permissions
   aren't enforced (client-gating only)"*. That is factually wrong today and
   actively misleads anyone reasoning about the security model.

**Action:** flip `canView` to fail closed, correct the comment, and add a test
asserting the nav slug set is a subset of the seeded module slug set.

---

## 4. Nav slug `sales` has no module row — **P2**

`navigation.tsx` gates the Sales group on `slug: "sales"`, but
`prisma/seedModules.ts` has no `sales` module — the parent there is
`inventory-sales`. Because `canView` fails open (§3), the group is visible to
everyone and cannot be revoked. Fixing §3 without fixing this would instead hide
the entire Sales section from every role.

**Action:** align the two. Fix this **before** flipping `canView` to fail closed.

---

## 5. Duplicated screens with divergent implementations — **P2**

| Component | Copies | Routing |
|---|---|---|
| `BankTransactionList.tsx` | `banking/` (1515 lines) and `finance-and-accounting/` (312 lines) | **Both routed.** `finance-and-accounting` serves `/transactions`; `banking` serves `/banking/:bankId` and `/banking/transactions` |
| `ExpenseCategoryList.tsx` | `finance-and-accounting/` (243 lines) and `settings/moduleSettings/expense/` (260 lines) | Only `finance-and-accounting` is routed — the `moduleSettings` copy is **dead code** |

The bank-transaction pair is the more serious of the two: two live screens with a
5x size difference both claim to list bank transactions, so users see different
capabilities depending on the path they arrive by.

**Action:** consolidate the bank-transaction screens onto the richer `banking`
implementation and delete the dead `moduleSettings` expense-category copy.

---

## 6. Inventory model blocks multi-location — **P1**

`prisma/schema.prisma`, `model Inventory`:

- One row per `productId`, with no location dimension
- Two parallel stock fields: `quantity Int` (marked *"legacy integer stock"*) and
  `quantityOnHand Decimal` (ledger-aware WAC)
- `inventory_history Json?` — an unqueryable audit trail

**Why it matters:** this is the single highest-leverage schema change in the
whole ERP plan. Warehouse, stock transfers, GRN, picking, and multi-branch P&L
all require a location dimension, and every additional month of code written
against the single-location assumption raises the migration cost.

**Action:** three steps, in order — retire the legacy `quantity` field, promote
`inventory_history` to a real `InventoryMovement` table, then add the location
dimension. Do this before any Tier-1 ERP module.

---

## 7. Approvals engine is accounting-only — **P1**

`ApprovalsQueue` and the `20260607010000_d_approvals` migration cover journal
entries and accounting documents. Procure-to-pay, order-to-cash, HR leave, and
expense claims each need approval routing, and none can use it as built.

**Action:** generalise to a polymorphic approval engine — entity type, entity id,
rule chain, threshold, delegate, escalation — before building P2P and O2C, which
would otherwise each grow their own.

---

## 8. Notification models are vestigial — **P2**

`NotificationType`, `NotificationTag`, and `NotificationTypeTag` exist in the
schema with no controller, no route, and no UI. All user-facing messaging is
cron plus email (`lib/reminderMailer.ts`, `invoiceReminderCron.ts`,
`quotationReminderCron.ts`).

**Action:** either implement the notification engine — in-app inbox, per-user
delivery preferences, multi-channel fan-out — or drop the three dead models.
Leaving them implies a capability that is not there.

---

## 9. Legacy Mongo layer is dead weight — **P2**

`runner.md:11` confirms the app runs entirely on Postgres/Prisma, and no file in
`routes/` or `controllers/` imports mongoose.

**Still present:**

- `models/` — 58 Mongoose models
- `seedModules.js` — superseded by `prisma/seedModules.ts` (whose header comment
  says the JS version *"never populated the Postgres Module table"*)
- `seedDefaults.js`, `seedNotification.js`

**Why it matters:** 58 stale model files are the first thing a new developer or
an AI assistant finds when searching for the data model, and they contradict the
real schema.

**Action:** delete, or move to an `legacy/` folder excluded from search and
tsconfig.

---

## 10. AI subsystem is the largest namespace and the least tested — **P1**

The AI layer is 39 endpoints — the biggest single API group in the product —
spanning `lib/aiProviders`, `lib/aiPrompts`, `lib/aiTools`, `services/ai`, and
six controllers (`aiChatController`, `aiConfigController`,
`aiExtractionController`, `aiUsageController`, `Admin/AI/aiController`,
`aiSupplierMatcher`).

Test coverage is strong elsewhere — 199 test files, with specs for the ledger,
payroll, report boundaries, recurring runners, tax engine, and custom fields. For
AI, only `lib/aiCrypto.spec.ts` exists, and it covers secret encryption rather
than any AI behaviour.

**Why it matters:** this subsystem writes to financial records via extraction
jobs and supplier matching, and it is the one area with no regression net.

**Action:** add contract tests for the provider adapters, extraction-job state
machine, tool dispatch, and usage metering.

---

## 11. Reports are hard-coded — **P1 for ERP, P2 today**

Roughly 30 report screens are individually built React components with matching
bespoke controllers. Adding a report means writing a page, a route, a controller,
and a permission entry.

**Why it matters:** the ERP modules in
`for_erp_grade_required_modules_and_features.md` add stock ledgers, WIP,
production variance, pipeline, and shipment reporting. Continuing one-component-
per-report multiplies this surface well past the point of maintainability.

**Action:** extract a report engine — dataset definitions, a shared filter or
grouping or drill-down runtime, and a saved-view model — and migrate existing
reports onto it incrementally.

---

## Recommended sequence

Fix in this order; each step removes a blocker for the next.

| Step | Item | Severity | Why first |
|---|---|---|---|
| 1 | §4 nav slug `sales` | P2 | Must land before §3, or Sales disappears for every role |
| 2 | §3 fail-closed gating + §2 unenforced modules | P0 | Access-control defects live in production today |
| 3 | §9 delete legacy Mongo layer | P2 | Cheap; makes everything after it easier to navigate |
| 4 | §5 de-duplicate screens | P2 | Cheap; prevents divergence from widening |
| 5 | §1 finish Contacts migration | P1 | Every ERP module needs one party master |
| 6 | §6 inventory model rework | P1 | Hard blocker for warehouse, GRN, and manufacturing |
| 7 | §7 generalise approvals | P1 | Needed by P2P, O2C, and HR simultaneously |
| 8 | §10 AI test coverage, §11 report engine | P1 | Do before the ERP build-out multiplies both surfaces |
| 9 | §8 notifications — implement or delete | P2 | Decide once the ERP scope is fixed |

Steps 1-4 are days of work. Steps 5-8 are the genuine prerequisites for the
ERP-grade build described in `for_erp_grade_required_modules_and_features.md`.
