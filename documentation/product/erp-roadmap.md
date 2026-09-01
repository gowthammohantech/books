# ERP-Grade Required Modules and Features

> **Point-in-time audit — 2026-08-31.** This describes the codebase as it stood on
> branch `pc-cc` (merged to `master` in #4). It is a planning artefact, not a record
> of current state: nothing regenerates it, so re-verify every count, file path and
> severity below against `master` before acting on it.

**Scope:** the modules Elixir Books must add to be a genuine ERP rather than a
financial and accounting suite, with the data model and feature set each one
implies.

**Basis:** derived from the codebase on branch `pc-cc` and from the gap analysis
in `current-modules.md`. No requirements documents were supplied
with this request — the target feature set below is drawn from standard
mid-market ERP scope, not from a customer specification. **Treat the phasing as a
proposal to confirm, not as agreed scope.**

**Prerequisite:** the P0 and P1 items in
`modules-to-modify.md` — in particular the Contacts migration
(§1), the Inventory model rework (§6), and the generalised approval engine (§7) —
should land before or alongside Phase 1. Building on top of them unfixed roughly
doubles the work.

---

## Phase 1 — Operations foundation

The five modules that separate "books" from "ERP". Nothing in later phases works
properly without these.

### 1.1 Warehouse & multi-location inventory

**Highest-leverage change in the entire plan.** Today `Inventory` is one row per
product with no location dimension.

**New models**

| Model | Purpose |
|---|---|
| `Warehouse` | Physical or logical location; tenant-scoped, optional address |
| `StorageBin` | Bin, rack, or zone within a warehouse |
| `StockLevel` | Replaces flat `Inventory` — quantity per product **per location** |
| `StockMovement` | Immutable ledger of every quantity change; replaces `Inventory.inventory_history` JSON |
| `StockTransfer` + `StockTransferLine` | Inter-warehouse movement with in-transit state |
| `StockAdjustment` | Cycle counts, write-offs, and revaluations, with a reason code |

**Features:** per-location valuation, in-transit stock, stock-transfer approval,
cycle counting, negative-stock policy per warehouse, default warehouse per
document type, warehouse-aware reorder points.

**Touches:** every sales and purchase document, `InventoryCostLayer`, all
inventory reports, ledger posting packs.

### 1.2 Sales Order (order-to-cash)

Closes the gap where the chain jumps Quotation → Invoice.

**New models:** `SalesOrder`, `SalesOrderLine`, `Shipment`, `ShipmentLine`,
`SalesReturn` (RMA).

**Features:** quotation → order conversion, order confirmation and approval,
partial and multi-shipment fulfilment, backorder handling, allocation and
reservation of stock, order → delivery challan → invoice flow with
ordered-vs-delivered-vs-invoiced tracking, order backlog and fill-rate reporting,
credit-limit check at confirmation (`AccountCreditEntry` already exists).

### 1.3 Procure-to-pay

Purchase Orders and Purchases exist as documents; the controlled process does not.

**New models:** `PurchaseRequisition` + lines, `RequestForQuotation` +
`VendorQuotation` + lines, `GoodsReceiptNote` + lines, `PurchaseReturn`,
`VendorPriceList`.

**Features:** requisition → approval → RFQ → quotation comparison → PO,
goods receipt against PO with over- and under-delivery tolerance, **three-way
match** (PO ↔ GRN ↔ Bill) with exception queue, landed-cost allocation on
receipt (`landedCost` already on the line model), vendor price lists and
contracts, vendor scorecard on delivery and quality.

### 1.4 CRM

No Lead, Opportunity, Pipeline, Campaign, or Activity model exists today.

**New models:** `Lead`, `Opportunity`, `Pipeline` + `PipelineStage`, `Activity`
(call, meeting, task, note), `Campaign`, `ContactPerson` (many per `Contact`).

**Features:** lead capture and qualification, lead → opportunity → quotation →
sales order flow, weighted pipeline and forecast, activity timeline on every
contact, task reminders, campaign attribution to revenue, email logging.

**Note:** this is the most credible build-versus-integrate candidate in the plan.
The accounting core is deep enough that a CRM integration may be better value
than a build.

### 1.5 Batch, serial & expiry tracking

**New models:** `StockLot` (batch number, manufacture and expiry dates),
`SerialNumber`, `LotAllocation` linking lots to document lines.

**Features:** lot and serial capture at receipt, allocation at issue, FEFO
(first-expiry-first-out) picking alongside the existing FIFO cost layers, expiry
alerts, full forward and backward traceability, recall reporting.

**Note:** gates pharma, food, and electronics verticals entirely. Sequence it
with 1.1 — retrofitting lot tracking onto stock movements later is expensive.

---

## Phase 2 — Enterprise depth

### 2.1 Manufacturing

**New models:** `BillOfMaterial` + `BomLine`, `Routing` + `RoutingOperation`,
`WorkCenter`, `WorkOrder` + `WorkOrderOperation`, `MaterialIssue`,
`ProductionReceipt`, `Subcontract`.

**Features:** multi-level BOM with phantom assemblies, scrap and yield factors,
work-order scheduling and capacity view, material issue and backflush, WIP
valuation, production variance (material, labour, overhead), subcontracting,
by-product and co-product handling.

### 2.2 Full HRMS

Extends the existing Payroll and Time modules.

**New models:** `Employee` (a real master — payroll currently rides on `User`),
`Department`, `Designation`, `Attendance`, `Shift` + `ShiftRoster`, `JobOpening`,
`Applicant`, `OnboardingTask`, `AppraisalCycle` + `AppraisalReview`,
`ExpenseClaim`.

**Features:** employee lifecycle from hire to exit, biometric or geo attendance,
shift rostering and overtime rules, recruitment pipeline, structured onboarding
and offboarding, goals and appraisal cycles, employee self-service portal,
expense claims with approval, statutory filings (PF, ESI, TDS, Form 16 for India;
P60, P11D, RTI for the UK).

### 2.3 Project accounting

`Project` and `CostCenter` exist as reporting dimensions only.

**New models:** `ProjectPhase` / WBS, `ProjectBudget`, `Milestone`,
`ProjectResource`, `ProjectExpense`.

**Features:** WBS with phase-level budgets, milestone and progress billing,
percentage-of-completion revenue recognition, resource allocation and
utilisation, time and expense capture against WBS (`Timesheet` and `TimeEntry`
already exist), project profitability and budget-burn reporting.

### 2.4 Logistics & shipping

**New models:** `Carrier`, `ShippingRate`, `Package`, `TrackingEvent`,
`FreightCost`.

**Features:** carrier integration with rate shopping, packing lists and package
build, label printing, tracking-event ingestion and customer notification,
freight cost allocation to landed cost, proof of delivery, delivery route
planning (`Vehicle` already exists as a foundation).

### 2.5 Demand planning & MRP

**New models:** `ReorderRule`, `DemandForecast`, `MrpRun` + `MrpSuggestion`.

**Features:** min/max and reorder-point rules per product per warehouse, safety
stock, forecast from sales history, MRP netting across sales orders, stock, and
open POs, automatic requisition and PO suggestions, ABC classification.

---

## Phase 3 — Platform and vertical

### 3.1 Platform capabilities

The extensibility layer the product currently lacks. `TenantApiKey`, in progress
on this branch, is the start of it.

| Capability | Notes |
|---|---|
| Public REST API | Versioned, documented; `lib/swaggerConfig.ts` exists as a base |
| Webhooks | Subscription model, delivery log, retry with backoff, signing secret |
| Event bus | Internal domain events, so modules stop calling each other directly |
| Notification engine | In-app inbox, per-user delivery preferences, multi-channel fan-out — replaces the vestigial `NotificationType` models |
| Document management | `Document` model with versioning, polymorphic record linkage, and access control; replaces the flat `uploads/` folder |
| Report engine | Dataset definitions with shared filter, group, drill-down, and saved-view runtime — see `modules-to-modify.md` §11 |
| Workflow engine | Generalised from the accounting-only `ApprovalsQueue` — see §7 |
| Scheduled jobs UI | Cron runners are currently code-only, with no visibility or retry |
| Import framework | Bulk CSV/XLSX import with mapping, validation, and dry-run, per entity |

### 3.2 Multi-company & consolidation

Tenancy exists; group accounting does not.

**New models:** `CompanyGroup`, `IntercompanyTransaction`, `EliminationRule`,
`ConsolidationRun`.

**Features:** group hierarchy, intercompany invoicing with automatic
counterpart posting, elimination entries, consolidated P&L and balance sheet,
foreign-subsidiary currency translation (`ExchangeRate` already exists),
cross-company reporting.

### 3.3 Quality management

**New models:** `QualityInspection`, `InspectionParameter`, `NonConformanceReport`,
`CorrectiveAction`.

**Features:** inspection plans at incoming, in-process, and final stages,
sampling rules, quarantine or hold status on stock, NCR and CAPA workflow,
supplier quality rating feeding the vendor scorecard.

### 3.4 Asset lifecycle

Extends the existing `FixedAsset` and depreciation.

**New models:** `AssetMaintenance`, `AssetCustody`, `AssetDisposal`,
`AssetCategory`.

**Features:** preventive maintenance schedules, breakdown logging, custody and
assignment to employees or locations, transfer between locations, disposal and
write-off workflow with gain or loss posting, asset barcode or QR tagging.

### 3.5 Service management

**New models:** `ServiceContract` (AMC), `ServiceTicket`, `ServiceVisit`,
`WarrantyClaim`, `SparePartConsumption`.

**Features:** contract creation with SLA terms and renewal reminders, ticket
intake and assignment, field-visit scheduling, spare-part consumption against
inventory, warranty validation from serial numbers, service profitability
reporting.

### 3.6 POS & retail

**New models:** `PosTerminal`, `PosSession`, `PosOrder`, `CashDrawerEntry`.

**Features:** touch-optimised till UI, barcode scanning (`barcode` already on
`Product`), split tender, shift open/close with cash reconciliation, offline mode
with sync, receipt printing, loyalty and gift cards.

### 3.7 Subscription billing

Extends `RecurringInvoiceSchedule` from repeat billing to a revenue engine.

**New models:** `Plan`, `Subscription`, `UsageRecord`, `DunningRule`.

**Features:** plan catalogue with tiered and usage pricing, mid-cycle upgrade and
downgrade with proration, usage metering and rating, automatic dunning and
retries, MRR/ARR, churn, and cohort reporting, revenue recognition per ASC 606
or IFRS 15.

### 3.8 Rental / hire

Notable because `Vehicle` already exists.

**New models:** `RentalAgreement`, `RentalItem`, `AvailabilityCalendar`,
`RentalReturn`.

**Features:** availability calendar and booking, rate cards by hour, day, week,
and month, deposit handling, damage assessment on return, overdue and late-fee
billing.

---

## Sequencing summary

| Phase | Modules | Depends on |
|---|---|---|
| **0 — Remediation** | Contacts migration, inventory model rework, generalised approvals, fail-closed permissions | `modules-to-modify.md` |
| **1 — Operations foundation** | Warehouse, Sales Order, Procure-to-pay, CRM, Batch/serial | Phase 0 |
| **2 — Enterprise depth** | Manufacturing, HRMS, Project accounting, Logistics, MRP | Phase 1 (all five need warehouse and stock movements) |
| **3 — Platform and vertical** | Platform capabilities, consolidation, quality, assets, service, POS, subscriptions, rental | Phase 1; the platform layer is worth pulling earlier if third-party integration is a near-term commercial need |

### Critical path

**Warehouse and multi-location inventory (1.1) is the gate.** Sales Order,
procure-to-pay, batch tracking, manufacturing, logistics, and MRP all require a
location dimension on stock. Every month of new code written against the
single-location `Inventory` model increases the eventual migration cost.

Order it: fix the inventory model (Phase 0 §6) → build warehouse (1.1) → then
fan out to Sales Order and procure-to-pay in parallel.

### Build-versus-integrate candidates

CRM (1.4) and full HRMS (2.2) are the two modules most cleanly separable from the
accounting core, and both have mature third-party options. Given how deep the
financial core already is, integrating either may deliver more value per
engineering month than building it.

---

## Open questions to resolve before committing to this plan

These change the phasing materially, and none can be answered from the code:

1. **Target verticals.** Manufacturing, retail/POS, services, and distribution
   imply very different Phase 2 and 3 priorities.
2. **Target customer size.** Mid-market needs Phase 1 and 2; SMB may never need
   manufacturing or MRP.
3. **Geographic scope.** Ledger packs cover IN / EU / UK / US / AU / NZ.
   Statutory HR and tax filings must follow the same list, and that is a
   significant share of Phase 2.
4. **Build versus integrate** for CRM and HRMS.
5. **Existing customer commitments** — any already-promised module outranks this
   ordering.
