/**
 * Full demo data seed — populates substantial demo data across all features
 * (clusters A-G) for the CodeCanyon listing demo account.
 *
 * IDEMPOTENT — running this deletes existing data owned by the demo admin
 * and re-inserts a freshly curated dataset. Safe to re-run as many times as
 * needed; each run finishes with identical counts.
 *
 * Pre-requisites:
 *   1. `npm run prisma:seed`       — provisions lookup data (countries etc.)
 *   2. `npm run prisma:seed:demo`  — provisions the demo admin user
 *   3. `npm run prisma:seed:demo:full` — THIS script
 *
 * Run via:
 *   npx ts-node prisma/seed-demo-full.ts
 *   or
 *   npm run prisma:seed:demo:full
 */

import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { applyPack, type ApplyPackTx } from '../lib/ledger/applyPack';
import { buildLeaveDays } from '../lib/timeTracking/leaveDays';
import {
  postInvoiceIssued,
  postInvoicePayment,
  postPurchaseReceived,
  postSupplierPayment,
  postExpense,
  postCreditNoteIssued,
  type PostingTx,
} from '../lib/ledger/ledgerPosting';
import { post } from '../lib/ledger/postingEngine';
import { seedTransactionCategoriesForUser } from './seedTransactionCategories';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'admin@demo.elixirbooks.local';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const D = (n: number | string): Prisma.Decimal => new Prisma.Decimal(n);

function daysAgo(d: number): Date {
  const r = new Date();
  r.setHours(12, 0, 0, 0);
  r.setDate(r.getDate() - d);
  return r;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Counts (filled in as we go for the summary print at the end)
// ---------------------------------------------------------------------------
const counts: Record<string, number> = {};
function record(k: string, n: number): void {
  counts[k] = n;
}

// ===========================================================================
// Phase 1: WIPE
// ===========================================================================

async function wipe(userId: string): Promise<void> {
  console.log(`Phase 1: wiping existing demo data for userId=${userId}`);

  // --- Payments / refunds (deepest first) ---------------------------------
  await prisma.refund.deleteMany({ where: { userId } });

  // InvoicePayment references PaymentTransaction; null it before deleting txns
  await prisma.invoicePayment.updateMany({
    where: { paymentTransactionId: { not: null }, invoice: { userId } },
    data: { paymentTransactionId: null },
  });

  // E-invoice records (must precede invoice deletion)
  await prisma.eInvoiceRecord.deleteMany({ where: { userId } });

  // Invoice payments (FK to Invoice + BankDetail + User)
  await prisma.invoicePayment.deleteMany({ where: { invoice: { userId } } });

  // Payment transactions (after invoice payment FK is nulled)
  await prisma.paymentTransaction.deleteMany({ where: { userId } });

  // --- Journal lines (cascade on delete) then entries ----------------------
  await prisma.journalEntry.deleteMany({ where: { userId } });

  // --- Bank transactions (no userId FK; scope via bankAccount.userId) -----
  await prisma.bankTransaction.deleteMany({
    where: { bankAccount: { userId } },
  });

  // --- PettyCash transactions + PettyCash (global; wipe demo-prefixed rows) ---
  // PettyCash has no userId FK. We scope by demo "remarks" prefix on transactions
  // (DEMO-PC-...) and by deleting any PettyCash row that has only demo transactions
  // attached. Simpler: nuke any PettyCash row whose transactions all start with
  // "DEMO-PC-" remarks. To stay safe across re-runs we also clear orphan rows
  // tagged via openingBalance + a sentinel description we don't add. In practice
  // PettyCash is small and only ever populated by this seed, so we wipe all
  // transactions with DEMO remarks then delete any PettyCash row left with zero
  // transactions and a demo-shaped opening balance.
  await prisma.pettyCashTransaction.deleteMany({
    where: { remarks: { startsWith: 'DEMO-PC' } },
  });
  await prisma.pettyCash.deleteMany({
    where: { transactions: { none: {} } },
  });

  // --- Purchase chain ------------------------------------------------------
  await prisma.supplierPayment.deleteMany({
    where: { purchase: { userId } },
  });
  await prisma.debitNote.deleteMany({ where: { userId } });
  await prisma.purchase.deleteMany({ where: { userId } });
  await prisma.purchaseOrder.deleteMany({ where: { userId } });

  // --- Quotations / credit notes / delivery challans ----------------------
  // Scope by userId OR by customer-owned-by-demo to catch strays
  await prisma.creditNote.deleteMany({
    where: { OR: [{ userId }, { customer: { userId } }, { billToCustomer: { userId } }] },
  });
  await prisma.deliveryChallan.deleteMany({
    where: { OR: [{ userId }, { customer: { userId } }, { billToCustomer: { userId } }] },
  });
  await prisma.quotation.deleteMany({
    where: { OR: [{ userId }, { customer: { userId } }, { billToCustomer: { userId } }] },
  });
  // Reminders link to customer/invoice/quotation but in practice we delete by user
  await prisma.reminder.deleteMany({
    where: { OR: [{ createdBy: userId }, { targetCustomerRel: { userId } }] },
  });

  // --- Expenses: children first, then parents -----------------------------
  await prisma.expenseChangeLog.deleteMany({
    where: { expense: { userId } },
  });
  await prisma.expense.deleteMany({
    where: { userId, parentExpense: { not: null } },
  });
  await prisma.expense.deleteMany({ where: { userId } });

  // --- Invoices: children & conversions first, then parents ---------------
  // Scope: anything owned by the demo admin OR referencing a customer owned
  // by them (catches stray invoices from prior test runs that lingered with
  // a different userId but pointed at a demo-owned customer).
  const invoiceScope: Prisma.InvoiceWhereInput = {
    OR: [{ userId }, { customer: { userId } }],
  };
  // Null self-references first so deletes are unambiguous
  await prisma.invoice.updateMany({
    where: { AND: [invoiceScope, { OR: [{ parentInvoice: { not: null } }, { convertedFromId: { not: null } }] }] },
    data: { parentInvoice: null, convertedFromId: null, convertedAt: null },
  });
  // Also wipe any payments/e-invoices/payment-transactions for those scoped invoices
  await prisma.invoicePayment.updateMany({
    where: { paymentTransactionId: { not: null }, invoice: invoiceScope },
    data: { paymentTransactionId: null },
  });
  await prisma.eInvoiceRecord.deleteMany({ where: { invoice: invoiceScope } });
  await prisma.invoicePayment.deleteMany({ where: { invoice: invoiceScope } });
  await prisma.paymentTransaction.deleteMany({ where: { invoice: invoiceScope } });
  await prisma.creditNote.deleteMany({ where: { invoice: invoiceScope } });
  await prisma.deliveryChallan.deleteMany({ where: { invoice: invoiceScope } });
  await prisma.quotation.deleteMany({ where: { invoice: invoiceScope } });
  await prisma.invoice.deleteMany({ where: invoiceScope });

  // --- Vehicles (scoped by userId OR by customer-owned-by-demo) ----------
  await prisma.vehicle.deleteMany({
    where: { OR: [{ userId }, { customer: { userId } }] },
  });

  // --- Inventory + Products (Products are global by name unique; only delete user-scoped inventory) ---
  await prisma.inventory.deleteMany({ where: { userId } });
  // Products are global (no userId FK). We delete products we created with the
  // "DEMO_" code prefix so re-runs don't trip the unique constraint. First drop
  // ANY inventory still referencing those products (possibly under other users
  // from prior test runs) so the product delete doesn't trip the FK.
  await prisma.inventory.deleteMany({ where: { product: { code: { startsWith: 'DEMO-' } } } });
  await prisma.product.deleteMany({ where: { code: { startsWith: 'DEMO-' } } });

  // --- TaxRate (user-scoped) ----------------------------------------------
  await prisma.taxRate.deleteMany({ where: { userId } });

  // --- Contacts -----------------------------------------------------------
  // The app derives clients/suppliers from Contact rows that have transactions
  // (contactViewWhere). All documents above are deleted first, so their
  // contactId FKs are already gone; now wipe the demo owner's contacts so a
  // re-seed starts clean (also clears stale test contacts on the page).
  await prisma.contact.deleteMany({ where: { userId } });

  // --- Customer & Supplier ------------------------------------------------
  await prisma.customer.deleteMany({ where: { userId } });
  await prisma.supplier.deleteMany({ where: { user_id: userId } });

  // --- Bank details (user-scoped) -----------------------------------------
  await prisma.bankDetail.deleteMany({ where: { userId } });

  // --- ExpenseCategory (global table, no userId). Delete demo-prefixed ----
  await prisma.expenseCategory.deleteMany({ where: { title: { startsWith: 'Demo ' } } });

  // --- Gateway / messaging / integration / period configs -----------------
  await prisma.gatewayConfig.deleteMany({ where: { userId } });
  await prisma.messagingConfig.deleteMany({ where: { userId } });
  await prisma.accountingIntegration.deleteMany({ where: { userId } });
  await prisma.accountingPeriod.deleteMany({ where: { userId } });

  // --- Account FK dependents (must go before deleting accounts) ------------
  // JournalLine cascades with JournalEntry (deleted above); these three are
  // user-scoped, accountId-required, and otherwise block account.deleteMany.
  await prisma.ledgerAccountMapping.deleteMany({ where: { userId } });
  // Reset ledger init flag so a re-run's applyPack guard passes (the guard
  // throws when ledgerInitialized is true). goLiveDate is re-set by applyPack.
  await prisma.companySettings.updateMany({
    where: { userId },
    data: { ledgerInitialized: false },
  });
  await prisma.budget.deleteMany({ where: { userId } });
  await prisma.transactionCategory.deleteMany({ where: { userId } });

  // --- Chart of accounts: children first, then top-level -------------------
  await prisma.account.deleteMany({ where: { userId, parentId: { not: null } } });
  await prisma.account.deleteMany({ where: { userId } });

  // --- Time-tracking (Phase 1) + Leaves/Holidays (Phase C) -----------------
  // Children before parents (most FKs cascade, but explicit deletes keep the
  // wipe order-independent and the re-seed clean). TimeEntry cascades with
  // Timesheet, ProjectMember + TimeEntry cascade with Project, and
  // LeaveRequestDay cascades with LeaveRequest — we still delete each so a
  // partial/older dataset is fully cleared.
  await prisma.timeEntry.deleteMany({ where: { timesheet: { userId } } });
  await prisma.timesheet.deleteMany({ where: { userId } });
  await prisma.projectMember.deleteMany({ where: { userId } });
  await prisma.timeEntry.deleteMany({ where: { project: { userId } } });
  await prisma.project.deleteMany({ where: { userId } });
  await prisma.leaveRequestDay.deleteMany({ where: { leaveRequest: { userId } } });
  await prisma.leaveRequest.deleteMany({ where: { userId } });
  await prisma.leaveAllocation.deleteMany({ where: { userId } });
  await prisma.leaveType.deleteMany({ where: { userId } });
  await prisma.holiday.deleteMany({ where: { userId } });
  // Demo staff users (employees) created by this script — `ownerId == owner`.
  // Deleted AFTER all rows that FK to them (project members, timesheets, leave
  // rows above) so the delete does not violate referential integrity.
  // LoginActivity FKs to User with no cascade, so clear those rows for the
  // staff first (they accumulate from logins) or the user delete violates the
  // LoginActivity_userId_fkey constraint.
  await prisma.loginActivity.deleteMany({ where: { user: { ownerId: userId } } });
  await prisma.user.deleteMany({ where: { ownerId: userId } });

  // --- AI feature data (cluster H, slice H.4) ------------------------------
  // Messages cascade-delete with their session, but we delete explicitly so
  // the wipe is order-independent. Extraction jobs and usage logs are owned
  // by userId; the AiConfig is upserted (not deleted) in seedAll.
  const demoSessions = await prisma.aiChatSession.findMany({
    where: { userId },
    select: { id: true },
  });
  if (demoSessions.length) {
    await prisma.aiChatMessage.deleteMany({
      where: { sessionId: { in: demoSessions.map((s) => s.id) } },
    });
  }
  await prisma.aiChatSession.deleteMany({ where: { userId } });
  await prisma.aiExtractionJob.deleteMany({ where: { userId } });
  await prisma.aiUsageLog.deleteMany({ where: { userId } });

  console.log('  ...wipe complete');
}

// ===========================================================================
// Phase 2: SEED
// ===========================================================================

async function ensurePaymentMode(name: string, slug: string): Promise<string> {
  const existing = await prisma.paymentMode.findUnique({ where: { slug } });
  if (existing) return existing.id;
  const row = await prisma.paymentMode.create({ data: { name, slug, status: true } });
  return row.id;
}

async function ensureTaxGroup(name: string): Promise<string> {
  const existing = await prisma.taxGroup.findFirst({ where: { tax_name: name } });
  if (existing) return existing.id;
  const row = await prisma.taxGroup.create({ data: { tax_name: name, status: true } });
  return row.id;
}

async function ensureUnit(unitName: string, shortName: string): Promise<string> {
  const existing = await prisma.unit.findFirst({ where: { unit_name: unitName } });
  if (existing) return existing.id;
  const row = await prisma.unit.create({ data: { unit_name: unitName, short_name: shortName, status: true } });
  return row.id;
}

async function ensureBrand(name: string): Promise<string> {
  const existing = await prisma.brand.findUnique({ where: { brand_name: name } });
  if (existing) return existing.id;
  const row = await prisma.brand.create({ data: { brand_name: name, status: true } });
  return row.id;
}

async function ensureCategory(name: string, slug: string): Promise<string> {
  const existing = await prisma.category.findUnique({ where: { category_name: name } });
  if (existing) return existing.id;
  const row = await prisma.category.create({ data: { category_name: name, slug, status: true } });
  return row.id;
}

/**
 * Idempotent find-or-create for a Contact, keyed on (userId, organisation).
 * Mirrors the ensureCustomer/ensureSupplier pattern. The app's Contacts page
 * derives clients/suppliers from contacts that have transactions, so every
 * demo party (customer or supplier) gets a real Contact row whose id is then
 * threaded onto the documents via contactId/billToContactId.
 */
async function ensureContact(
  userId: string,
  data: {
    organisation: string;
    email?: string | null;
    mobile?: string | null;
    telephone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    addressLine1?: string | null;
    town?: string | null;
    region?: string | null;
    postcode?: string | null;
    gstin?: string | null;
    currencyCode?: string | null;
    legacyCustomerId?: string | null;
    legacySupplierId?: string | null;
  },
): Promise<string> {
  const existing = await prisma.contact.findFirst({
    where: { userId, organisation: data.organisation },
  });
  if (existing) {
    // Keep the existing row but ensure legacy links are populated on re-run.
    if (
      (data.legacyCustomerId && existing.legacyCustomerId !== data.legacyCustomerId) ||
      (data.legacySupplierId && existing.legacySupplierId !== data.legacySupplierId)
    ) {
      await prisma.contact.update({
        where: { id: existing.id },
        data: {
          legacyCustomerId: data.legacyCustomerId ?? existing.legacyCustomerId,
          legacySupplierId: data.legacySupplierId ?? existing.legacySupplierId,
        },
      });
    }
    return existing.id;
  }
  const row = await prisma.contact.create({
    data: {
      userId,
      organisation: data.organisation,
      showNameOnInvoice: true,
      email: data.email ?? null,
      mobile: data.mobile ?? null,
      telephone: data.telephone ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      addressLine1: data.addressLine1 ?? null,
      town: data.town ?? null,
      region: data.region ?? null,
      postcode: data.postcode ?? null,
      gstin: data.gstin ?? null,
      currencyCode: data.currencyCode ?? 'INR',
      countryId: 'c-india',
      status: 'ACTIVE',
      legacyCustomerId: data.legacyCustomerId ?? null,
      legacySupplierId: data.legacySupplierId ?? null,
    },
  });
  return row.id;
}

async function seedAll(userId: string): Promise<void> {
  console.log('Phase 2: seeding demo data');

  // The ledger engine + applyPack take a structural Prisma slice. Mirror the
  // controllers' `tx as unknown as PostingTx` pattern: the plain client
  // satisfies the structural type at runtime; the cast just appeases tsc.
  const ledgerTx = prisma as unknown as PostingTx & ApplyPackTx;

  // -------------------------------------------------------------------------
  // CompanySettings — update or create (CompanySettings.userId is unique)
  // -------------------------------------------------------------------------
  await prisma.companySettings.upsert({
    where: { userId },
    update: {
      companyName: 'Demo Company',
      email: 'support@example.com',
      phone: '+91-9876543210',
      address: '123 MG Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      pincode: '600001',
      taxRegime: 'GST_INDIA',
      countryId: 'c-india',
      publicBaseUrl: 'http://localhost:8080',
      merchantUpiId: 'demo@upi',
      merchantName: 'Demo Company',
    },
    create: {
      companyName: 'Demo Company',
      email: 'support@example.com',
      phone: '+91-9876543210',
      address: '123 MG Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      pincode: '600001',
      taxRegime: 'GST_INDIA',
      countryId: 'c-india',
      publicBaseUrl: 'http://localhost:8080',
      merchantUpiId: 'demo@upi',
      merchantName: 'Demo Company',
      userId,
    },
  });
  record('companySettings', 1);

  // -------------------------------------------------------------------------
  // PaymentModes (global) — ensure required ones exist
  // -------------------------------------------------------------------------
  const pmCashId = await ensurePaymentMode('Cash', 'cash');
  const pmBankId = await ensurePaymentMode('Bank Transfer', 'bank-transfer');
  const pmUpiId = await ensurePaymentMode('UPI', 'upi');
  const pmCardId = await ensurePaymentMode('Card', 'card');
  const pmChequeId = await ensurePaymentMode('Cheque', 'cheque');

  // -------------------------------------------------------------------------
  // TaxRates (10) — user-scoped
  // -------------------------------------------------------------------------
  const taxRatesSpec: Array<{
    name: string;
    taxKind: 'CGST' | 'SGST' | 'IGST' | 'VAT' | null;
    regime: 'GST_INDIA' | 'VAT_GENERIC';
    rate: string;
    isSystemComponent?: boolean;
  }> = [
    // User-facing kind-less GST slab — demo products point here (unified tax);
    // the engine splits it into CGST/SGST vs IGST at resolve time.
    { name: 'GST 18%', taxKind: null, regime: 'GST_INDIA', rate: '18' },
    // Component rows: engine/report plumbing (GSTR by taxKind), hidden from
    // the Taxes list via isSystemComponent.
    { name: 'CGST 2.5%', taxKind: 'CGST', regime: 'GST_INDIA', rate: '2.5', isSystemComponent: true },
    { name: 'CGST 6%', taxKind: 'CGST', regime: 'GST_INDIA', rate: '6', isSystemComponent: true },
    { name: 'CGST 9%', taxKind: 'CGST', regime: 'GST_INDIA', rate: '9', isSystemComponent: true },
    { name: 'CGST 14%', taxKind: 'CGST', regime: 'GST_INDIA', rate: '14', isSystemComponent: true },
    { name: 'SGST 2.5%', taxKind: 'SGST', regime: 'GST_INDIA', rate: '2.5', isSystemComponent: true },
    { name: 'SGST 6%', taxKind: 'SGST', regime: 'GST_INDIA', rate: '6', isSystemComponent: true },
    { name: 'SGST 9%', taxKind: 'SGST', regime: 'GST_INDIA', rate: '9', isSystemComponent: true },
    { name: 'SGST 14%', taxKind: 'SGST', regime: 'GST_INDIA', rate: '14', isSystemComponent: true },
    { name: 'IGST 5%', taxKind: 'IGST', regime: 'GST_INDIA', rate: '5', isSystemComponent: true },
    { name: 'IGST 12%', taxKind: 'IGST', regime: 'GST_INDIA', rate: '12', isSystemComponent: true },
    { name: 'IGST 18%', taxKind: 'IGST', regime: 'GST_INDIA', rate: '18', isSystemComponent: true },
    { name: 'IGST 28%', taxKind: 'IGST', regime: 'GST_INDIA', rate: '28', isSystemComponent: true },
    { name: 'VAT 20%', taxKind: 'VAT', regime: 'VAT_GENERIC', rate: '20' },
  ];
  const taxRateByName: Record<string, { id: string; name: string; percent: number; kind: string | null }> = {};
  for (const spec of taxRatesSpec) {
    const row = await prisma.taxRate.create({
      data: {
        userId,
        regime: spec.regime,
        taxKind: spec.taxKind,
        name: spec.name,
        rate: D(spec.rate),
        countryId: 'c-india',
        isActive: true,
        isSystemComponent: spec.isSystemComponent ?? false,
      },
    });
    taxRateByName[spec.name] = { id: row.id, name: row.name, percent: Number(spec.rate), kind: spec.taxKind };
  }
  record('taxRates', taxRatesSpec.length);

  // -------------------------------------------------------------------------
  // Brands (6), Categories (8), Units (5) — global (idempotent via ensure*)
  // -------------------------------------------------------------------------
  const brandIds: string[] = [];
  for (const b of ['Apple', 'Dell', 'HP', 'Samsung', 'Lenovo', 'Microsoft']) {
    brandIds.push(await ensureBrand(b));
  }
  record('brands', brandIds.length);

  const categorySpecs = [
    ['Electronics', 'electronics'],
    ['Office Supplies', 'office-supplies'],
    ['Furniture', 'furniture'],
    ['Services', 'services'],
    ['Software', 'software'],
    ['Stationery', 'stationery'],
    ['Hardware', 'hardware'],
    ['Consulting', 'consulting'],
  ] as const;
  const categoryIds: string[] = [];
  for (const [name, slug] of categorySpecs) {
    categoryIds.push(await ensureCategory(name, slug));
  }
  record('categories', categoryIds.length);

  const unitSpecs = [
    ['Pieces', 'pcs'],
    ['Hours', 'hr'],
    ['Kilograms', 'kg'],
    ['Box', 'box'],
    ['Litres', 'ltr'],
    ['Days', 'day'],
    ['Weeks', 'wk'],
    ['Months', 'mo'],
    ['Package', 'pkg'],
  ] as const;
  const unitIds: string[] = [];
  for (const [u, s] of unitSpecs) {
    unitIds.push(await ensureUnit(u, s));
  }
  record('units', unitIds.length);

  // TaxGroup used by Product (Product has required taxGroupId)
  const taxGroupGst18 = await ensureTaxGroup('GST 18%');

  // -------------------------------------------------------------------------
  // Products (10 + 5 services = 15) — global, demo-prefixed code
  // -------------------------------------------------------------------------
  const productSpecs = [
    { code: 'DEMO-LAPTOP-01', name: 'Demo Dell Latitude 5420 Laptop', type: 'Product', sell: 65000, buy: 55000, cat: 0, brand: 1, unit: 0 },
    { code: 'DEMO-LAPTOP-02', name: 'Demo HP EliteBook 840', type: 'Product', sell: 72000, buy: 60000, cat: 0, brand: 2, unit: 0 },
    { code: 'DEMO-MONITOR-01', name: 'Demo Dell 27" UltraSharp Monitor', type: 'Product', sell: 28000, buy: 22000, cat: 0, brand: 1, unit: 0 },
    { code: 'DEMO-KBD-01', name: 'Demo Apple Magic Keyboard', type: 'Product', sell: 12500, buy: 9500, cat: 0, brand: 0, unit: 0 },
    { code: 'DEMO-MOUSE-01', name: 'Demo Logitech MX Master 3S', type: 'Product', sell: 8500, buy: 6800, cat: 0, brand: 0, unit: 0 },
    { code: 'DEMO-DESK-01', name: 'Demo Executive Office Desk', type: 'Product', sell: 25000, buy: 18000, cat: 2, brand: 3, unit: 0 },
    { code: 'DEMO-CHAIR-01', name: 'Demo Ergonomic Office Chair', type: 'Product', sell: 18000, buy: 12000, cat: 2, brand: 3, unit: 0 },
    { code: 'DEMO-PAPER-01', name: 'Demo A4 Paper (500 sheets)', type: 'Product', sell: 350, buy: 250, cat: 5, brand: 4, unit: 3 },
    { code: 'DEMO-INK-01', name: 'Demo HP LaserJet Toner Cartridge', type: 'Product', sell: 4500, buy: 3200, cat: 1, brand: 2, unit: 0 },
    { code: 'DEMO-MS365-01', name: 'Demo Microsoft 365 Business Premium (1yr)', type: 'Product', sell: 14000, buy: 11500, cat: 4, brand: 5, unit: 0 },
    // 5 services
    { code: 'DEMO-SVC-01', name: 'Demo Web Development (Hourly)', type: 'Service', sell: 2500, buy: 1500, cat: 3, brand: 5, unit: 1 },
    { code: 'DEMO-SVC-02', name: 'Demo IT Consulting (Hourly)', type: 'Service', sell: 3500, buy: 2000, cat: 7, brand: 5, unit: 1 },
    { code: 'DEMO-SVC-03', name: 'Demo Monthly IT Support Retainer', type: 'Service', sell: 25000, buy: 12000, cat: 3, brand: 5, unit: 0 },
    { code: 'DEMO-SVC-04', name: 'Demo Cloud Migration (Project)', type: 'Service', sell: 150000, buy: 80000, cat: 3, brand: 5, unit: 0 },
    { code: 'DEMO-SVC-05', name: 'Demo Cybersecurity Audit', type: 'Service', sell: 75000, buy: 40000, cat: 7, brand: 5, unit: 0 },
  ];

  type Prod = { id: string; name: string; code: string; type: 'Product' | 'Service'; sell: number; buy: number };
  const products: Prod[] = [];
  for (const p of productSpecs) {
    const row = await prisma.product.create({
      data: {
        item_type: p.type as 'Product' | 'Service',
        name: p.name,
        code: p.code,
        categoryId: categoryIds[p.cat] ?? categoryIds[0],
        brandId: brandIds[p.brand] ?? brandIds[0],
        unitId: unitIds[p.unit] ?? unitIds[0],
        selling_price: p.sell,
        purchase_price: p.buy,
        discount_type: 'percentage',
        discount_value: 0,
        taxGroupId: taxGroupGst18,
        taxRateId: taxRateByName['GST 18%'].id,
        barcode: `BC-${p.code}-${randomBytes(3).toString('hex').toUpperCase()}`,
        alert_quantity: p.type === 'Product' ? 5 : 0,
        description: `${p.name} — demo seed entry.`,
        product_image: '',
        enable_inventory: p.type === 'Product',
        stock: p.type === 'Product' ? 25 : 0,
        status: true,
      },
    });
    products.push({ id: row.id, name: row.name, code: row.code, type: p.type as 'Product' | 'Service', sell: p.sell, buy: p.buy });
  }
  record('products', products.length);

  // Inventory rows for each Product (not Service) — initial stock
  let invCount = 0;
  for (const p of products) {
    if (p.type !== 'Product') continue;
    await prisma.inventory.create({
      data: {
        productId: p.id,
        quantity: 25,
        userId,
        notes: 'Initial demo stock',
      },
    });
    invCount++;
  }
  record('inventory', invCount);

  // -------------------------------------------------------------------------
  // Customers (10) — 4 B2B + 6 B2C
  // -------------------------------------------------------------------------
  const customerSpecs = [
    { name: 'Acme Corp Pvt Ltd', email: 'billing@acme.in', phone: '9876543211', gstin: '33AAACR1234R1Z5', state: 'Tamil Nadu', city: 'Chennai', stateId: 's-tn' },
    { name: 'Global Trading Co', email: 'ar@globaltrading.com', phone: '9876543212', gstin: '27AABCG5678R1Z9', state: 'Maharashtra', city: 'Mumbai', stateId: 's-mh' },
    { name: 'Tech Solutions LLP', email: 'finance@techsol.in', phone: '9876543213', gstin: '29AABCT9012R1Z3', state: 'Karnataka', city: 'Bangalore', stateId: 's-ka' },
    { name: 'Marketing Hub India', email: 'pay@mkthub.com', phone: '9876543214', gstin: '33AABCM3456R1Z7', state: 'Tamil Nadu', city: 'Chennai', stateId: 's-tn' },
    { name: 'Rahul Sharma', email: 'rahul.sharma@gmail.com', phone: '9876543215', state: 'Tamil Nadu', city: 'Chennai', stateId: 's-tn' },
    { name: 'Priya Iyer', email: 'priya.iyer@gmail.com', phone: '9876543216', state: 'Karnataka', city: 'Bangalore', stateId: 's-ka' },
    { name: 'Karthik Ramesh', email: 'karthik.r@yahoo.com', phone: '9876543217', state: 'Tamil Nadu', city: 'Coimbatore', stateId: 's-tn' },
    { name: 'Anita Krishnan', email: 'anita.k@outlook.com', phone: '9876543218', state: 'Kerala', city: 'Kochi', stateId: 's-kl' },
    { name: 'Vikram Patel', email: 'vikram.patel@gmail.com', phone: '9876543219', state: 'Maharashtra', city: 'Pune', stateId: 's-mh' },
    { name: 'Sneha Reddy', email: 'sneha.reddy@gmail.com', phone: '9876543220', state: 'Telangana', city: 'Hyderabad', stateId: 's-tg' },
  ];

  type Cust = (typeof customerSpecs)[number] & { id: string };
  const customers: Cust[] = [];
  for (const c of customerSpecs) {
    const row = await prisma.customer.create({
      data: {
        name: c.name,
        email: c.email,
        phone: c.phone,
        gstin: c.gstin ?? null,
        status: 'Active',
        billingAddress: {
          line1: `${Math.floor(Math.random() * 999) + 1} ${c.city} Main Rd`,
          city: c.city,
          state: c.state,
          country: 'India',
          pincode: '600001',
          stateId: c.stateId,
        },
        shippingAddress: {
          line1: `${Math.floor(Math.random() * 999) + 1} ${c.city} Main Rd`,
          city: c.city,
          state: c.state,
          country: 'India',
          pincode: '600001',
          stateId: c.stateId,
        },
        userId,
      },
    });
    customers.push({ ...c, id: row.id });
  }
  record('customers', customers.length);

  // -------------------------------------------------------------------------
  // Suppliers (5)
  // -------------------------------------------------------------------------
  const supplierSpecs = [
    { name: 'Pinnacle Distributors Pvt Ltd', email: 'sales@pinnacle.in', phone: '9988776601' },
    { name: 'TechSource India', email: 'orders@techsource.in', phone: '9988776602' },
    { name: 'Office Mart', email: 'b2b@officemart.in', phone: '9988776603' },
    { name: 'Cloud Hosting Co', email: 'billing@cloudhost.in', phone: '9988776604' },
    { name: 'Reliable Logistics', email: 'accounts@reliablelog.in', phone: '9988776605' },
  ];
  type Supp = { id: string; name: string };
  const suppliers: Supp[] = [];
  for (const s of supplierSpecs) {
    const row = await prisma.supplier.create({
      data: {
        user_id: userId,
        supplier_name: s.name,
        supplier_email: s.email,
        supplier_phone: s.phone,
        balance: 0,
        status: true,
      },
    });
    suppliers.push({ id: row.id, name: s.name });
  }
  record('suppliers', suppliers.length);

  // -------------------------------------------------------------------------
  // Contacts (15) — the unified party model the app now uses. The Contacts
  // page (and contact detail tabs, dashboard, reports) derives clients =
  // contacts with invoices/quotations/challans and suppliers = contacts with
  // purchases/POs/debit-notes/expenses, all keyed off Contact.id via the
  // documents' contactId. We create one Contact per demo customer and one per
  // demo supplier, link each back to its legacy row, and below thread the
  // resulting contactId onto every document. customerContactIds[i] /
  // supplierContactIds[i] mirror the customers[] / suppliers[] arrays.
  // -------------------------------------------------------------------------
  const customerContactIds: string[] = [];
  for (const c of customers) {
    const billing = (c as Cust & { billingAddress?: { line1?: string } }).billingAddress;
    const contactId = await ensureContact(userId, {
      organisation: c.name,
      email: c.email,
      mobile: c.phone,
      gstin: c.gstin ?? null,
      addressLine1: (billing && billing.line1) || `${c.city} Main Rd`,
      town: c.city,
      region: c.state,
      postcode: '600001',
      legacyCustomerId: c.id,
    });
    customerContactIds.push(contactId);
  }

  const supplierContactIds: string[] = [];
  for (let i = 0; i < suppliers.length; i++) {
    const s = suppliers[i];
    const spec = supplierSpecs[i];
    const contactId = await ensureContact(userId, {
      organisation: s.name,
      email: spec.email,
      mobile: spec.phone,
      legacySupplierId: s.id,
    });
    supplierContactIds.push(contactId);
  }
  record('contacts', customerContactIds.length + supplierContactIds.length);

  // -------------------------------------------------------------------------
  // Vehicles (4) — linked to first 4 customers
  // -------------------------------------------------------------------------
  const vehicleSpecs = [
    { customerIdx: 0, name: 'Company Sedan', make: 'Toyota', model: 'Camry', year: 2022, reg: 'TN-01-AB-1234', vin: 'JT2BF22K1W0123456' },
    { customerIdx: 1, name: 'Executive SUV', make: 'Honda', model: 'CR-V', year: 2023, reg: 'MH-02-CD-5678', vin: 'JHLRD7861YC012345' },
    { customerIdx: 2, name: 'Delivery Van', make: 'Mahindra', model: 'Bolero Pickup', year: 2021, reg: 'KA-03-EF-9012', vin: 'MA1TA2GAKM1A12345' },
    { customerIdx: 4, name: 'Family Hatchback', make: 'Maruti', model: 'Swift', year: 2024, reg: 'TN-04-GH-3456', vin: 'MA3EYDF1SK0123456' },
  ];
  let vehicleCount = 0;
  for (const v of vehicleSpecs) {
    await prisma.vehicle.create({
      data: {
        customerId: customers[v.customerIdx].id,
        userId,
        name: v.name,
        make: v.make,
        model: v.model,
        year: v.year,
        registrationNumber: v.reg,
        vin: v.vin,
        mileage: 25000,
        status: true,
      },
    });
    vehicleCount++;
  }
  record('vehicles', vehicleCount);

  // -------------------------------------------------------------------------
  // BankDetails (3)
  // -------------------------------------------------------------------------
  const bankSpecs = [
    {
      accountHoldername: 'Elixir Books',
      bankName: 'HDFC Bank',
      branchName: 'MG Road Chennai',
      accountNumber: `DEMO-${randomBytes(4).toString('hex').toUpperCase()}-01`,
      IFSCCode: 'HDFC0000001',
      accountType: 'current' as const,
      openingBalance: '500000',
    },
    {
      accountHoldername: 'Elixir Books',
      bankName: 'ICICI Bank',
      branchName: 'Anna Salai Chennai',
      accountNumber: `DEMO-${randomBytes(4).toString('hex').toUpperCase()}-02`,
      IFSCCode: 'ICIC0000002',
      accountType: 'savings' as const,
      openingBalance: '150000',
    },
    {
      accountHoldername: 'Elixir Books',
      bankName: 'SBI',
      branchName: 'T Nagar Chennai',
      accountNumber: `DEMO-${randomBytes(4).toString('hex').toUpperCase()}-03`,
      IFSCCode: 'SBIN0000003',
      accountType: 'current' as const,
      openingBalance: '250000',
    },
  ];
  type Bank = { id: string; name: string; balance: number };
  const banks: Bank[] = [];
  for (const b of bankSpecs) {
    const row = await prisma.bankDetail.create({
      data: {
        accountHoldername: b.accountHoldername,
        bankName: b.bankName,
        branchName: b.branchName,
        accountNumber: b.accountNumber,
        IFSCCode: b.IFSCCode,
        accountType: b.accountType,
        openingBalance: D(b.openingBalance),
        currentBalance: D(b.openingBalance),
        userId,
        status: true,
      },
    });
    banks.push({ id: row.id, name: b.bankName, balance: Number(b.openingBalance) });
  }
  record('bankDetails', banks.length);

  // -------------------------------------------------------------------------
  // Chart of Accounts + ledger init — apply the IN country pack so role
  // mappings exist and goLiveDate/functionalCurrency are set, then flip
  // ledgerInitialized=true so document postings below actually post.
  //
  // goLiveDate is daysAgo(400): far earlier than the earliest demo doc
  // (daysAgo(90)) so shouldPost() passes for every posting (date-floored, UTC).
  // wipe() already cleared accounts + ledgerAccountMapping + journalEntry and
  // reset ledgerInitialized=false, so applyPack's "already initialized" guard
  // passes on re-run.
  // -------------------------------------------------------------------------
  const goLiveDate = daysAgo(400);
  await applyPack(ledgerTx, { userId, countryCode: 'IN', goLiveDate });
  await prisma.companySettings.update({
    where: { userId },
    data: { ledgerInitialized: true },
  });
  const accountByCode: Record<string, string> = {};
  for (const a of await prisma.account.findMany({ where: { userId } })) {
    accountByCode[a.code] = a.id;
  }
  record('accounts', Object.keys(accountByCode).length);

  // -------------------------------------------------------------------------
  // Opening-balance JEs for each bank account — Dr BANK / Cr OPENING_BALANCE_EQUITY
  //
  // The GL only sees document-flow cash movements. Without these JEs the GL BANK
  // total is lower than Σ currentBalance by exactly Σ openingBalance, which
  // causes bankAggregate.glVsCurrentTied = false.
  //
  // Idempotent: post() deduplicates by (userId, sourceType, sourceId, event).
  // sourceId = `bank-opening-${bank.id}` is stable across re-runs because
  // bank.id is the Prisma-generated UUID (unchanged by wipe since banks were
  // just created above).
  // -------------------------------------------------------------------------
  for (const b of banks) {
    if (b.balance <= 0) continue; // nothing to post for zero-balance banks
    await post(ledgerTx as unknown as import('../lib/ledger/postingEngine').LedgerTx, {
      userId,
      sourceType: 'OpeningBalance',
      sourceId: `bank-opening-${b.id}`,
      event: 'opening',
      date: goLiveDate,
      currencyCode: 'BASE',
      isOpeningBalance: true,
      description: `Opening balance — ${b.name}`,
      instructions: [
        { roleKey: 'BANK', side: 'debit', amount: String(b.balance) },
        { roleKey: 'OPENING_BALANCE_EQUITY', side: 'credit', amount: String(b.balance) },
      ],
    });
  }
  record('openingBalanceJEs', banks.length);

  // -------------------------------------------------------------------------
  // ExpenseCategories (5) — prefix with "Demo " for idempotent wipe
  // -------------------------------------------------------------------------
  const expCatNames = ['Demo Office Rent', 'Demo Utilities', 'Demo Software & Subscriptions', 'Demo Travel', 'Demo Marketing'];
  const expCats: Record<string, string> = {};
  for (const name of expCatNames) {
    const row = await prisma.expenseCategory.create({
      data: { title: name, status: true },
    });
    expCats[name] = row.id;
  }
  record('expenseCategories', expCatNames.length);

  // -------------------------------------------------------------------------
  // Invoices (~18) — diverse mix
  // -------------------------------------------------------------------------
  // Build a small library of "applied taxes" sets so we can stamp them into items[]
  const TN_INTRA = [
    { taxRateId: taxRateByName['CGST 9%'].id, name: 'CGST 9%', kind: 'CGST', percent: 9 },
    { taxRateId: taxRateByName['SGST 9%'].id, name: 'SGST 9%', kind: 'SGST', percent: 9 },
  ];
  const INTER = [{ taxRateId: taxRateByName['IGST 18%'].id, name: 'IGST 18%', kind: 'IGST', percent: 18 }];

  type InvoiceItem = {
    productId: string;
    productName: string;
    description: string;
    qty: number;
    rate: number;
    discount: number;
    taxableAmount: number;
    taxes: Array<{ taxRateId: string; name: string; kind: string; percent: number; amount: number }>;
    totalTax: number;
    lineTotal: number;
  };

  function buildLine(
    productIdx: number,
    qty: number,
    appliedTaxes: typeof TN_INTRA | typeof INTER,
  ): InvoiceItem {
    const p = products[productIdx];
    const taxable = round2(qty * p.sell);
    const taxes = appliedTaxes.map((t) => ({
      ...t,
      amount: round2((taxable * t.percent) / 100),
    }));
    const totalTax = round2(taxes.reduce((s, t) => s + t.amount, 0));
    return {
      productId: p.id,
      productName: p.name,
      description: p.name,
      qty,
      rate: p.sell,
      discount: 0,
      taxableAmount: taxable,
      taxes,
      totalTax,
      lineTotal: round2(taxable + totalTax),
    };
  }

  type InvoiceSpec = {
    customerIdx: number;
    items: InvoiceItem[];
    status: 'PAID' | 'UNPAID' | 'OVERDUE' | 'PARTIALLY_PAID' | 'DRAFT' | 'SENT';
    daysAgo: number;
    dueDateOffset: number;
    invoiceType?: 'INVOICE' | 'PROFORMA';
  };

  const invoiceSpecs: InvoiceSpec[] = [
    // PAID (5) — mostly Tamil Nadu intra-state
    { customerIdx: 0, items: [buildLine(0, 2, TN_INTRA), buildLine(2, 1, TN_INTRA)], status: 'PAID', daysAgo: 70, dueDateOffset: -55 },
    { customerIdx: 3, items: [buildLine(10, 40, TN_INTRA)], status: 'PAID', daysAgo: 55, dueDateOffset: -40 },
    { customerIdx: 4, items: [buildLine(3, 1, TN_INTRA), buildLine(4, 1, TN_INTRA)], status: 'PAID', daysAgo: 45, dueDateOffset: -30 },
    { customerIdx: 6, items: [buildLine(9, 1, TN_INTRA)], status: 'PAID', daysAgo: 35, dueDateOffset: -20 },
    { customerIdx: 1, items: [buildLine(11, 20, INTER), buildLine(13, 1, INTER)], status: 'PAID', daysAgo: 30, dueDateOffset: -15 },

    // UNPAID (3)
    { customerIdx: 2, items: [buildLine(12, 1, INTER)], status: 'UNPAID', daysAgo: 15, dueDateOffset: 15 },
    { customerIdx: 7, items: [buildLine(0, 1, INTER), buildLine(3, 1, INTER)], status: 'UNPAID', daysAgo: 10, dueDateOffset: 20 },
    { customerIdx: 5, items: [buildLine(14, 1, INTER), buildLine(11, 8, INTER)], status: 'UNPAID', daysAgo: 5, dueDateOffset: 25 },

    // OVERDUE (2)
    { customerIdx: 8, items: [buildLine(5, 1, INTER), buildLine(6, 2, INTER)], status: 'OVERDUE', daysAgo: 75, dueDateOffset: -45 },
    { customerIdx: 9, items: [buildLine(8, 2, INTER)], status: 'OVERDUE', daysAgo: 80, dueDateOffset: -50 },

    // PARTIALLY_PAID (2)
    { customerIdx: 0, items: [buildLine(1, 1, TN_INTRA), buildLine(2, 1, TN_INTRA)], status: 'PARTIALLY_PAID', daysAgo: 25, dueDateOffset: -10 },
    { customerIdx: 3, items: [buildLine(13, 1, TN_INTRA)], status: 'PARTIALLY_PAID', daysAgo: 20, dueDateOffset: 5 },

    // PROFORMA (2) — invoiceType=PROFORMA, status=DRAFT/SENT
    { customerIdx: 1, items: [buildLine(0, 5, INTER), buildLine(2, 5, INTER)], status: 'SENT', daysAgo: 8, dueDateOffset: 22, invoiceType: 'PROFORMA' },
    { customerIdx: 2, items: [buildLine(14, 1, INTER)], status: 'DRAFT', daysAgo: 6, dueDateOffset: 24, invoiceType: 'PROFORMA' },
  ];

  let invoiceCount = 0;
  let invoicePaymentCount = 0;
  type CreatedInv = { id: string; invoiceNumber: string; customerId: string; contactId: string; total: number; date: Date; status: string };
  const createdInvoices: CreatedInv[] = [];
  // Recurring invoice payments have GL (via postInvoicePayment) but are NOT
  // created in createdInvoices[], so the bank-transaction loop below misses
  // them. Track them here so we can add bank txns in the bank-transactions
  // section and keep currentBalance in sync with GL.
  type RecurringInvPayment = { paymentId: string; amount: number; date: Date; invoiceNumber: string };
  const recurringInvPayments: RecurringInvPayment[] = [];

  let invSeq = 0;
  for (const spec of invoiceSpecs) {
    invSeq += 1;
    const totalTaxable = round2(spec.items.reduce((s, it) => s + it.taxableAmount, 0));
    const totalTax = round2(spec.items.reduce((s, it) => s + it.totalTax, 0));
    const totalAmount = round2(totalTaxable + totalTax);
    const invDate = daysAgo(spec.daysAgo);
    const dueDate = new Date(invDate.getTime() + spec.dueDateOffset * 24 * 60 * 60 * 1000);
    const customer = customers[spec.customerIdx];

    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: `DEMO-INV-${String(invSeq).padStart(5, '0')}`,
        customerId: customer.id,
        contactId: customerContactIds[spec.customerIdx],
        billToContactId: customerContactIds[spec.customerIdx],
        invoiceDate: invDate,
        dueDate,
        items: spec.items as unknown as Prisma.InputJsonValue,
        status: spec.status,
        taxableAmount: D(totalTaxable),
        TotalAmount: D(totalAmount),
        vat: D(totalTax),
        userId,
        billFrom: userId,
        billTo: customer.id,
        invoiceType: spec.invoiceType ?? 'INVOICE',
        bankId: banks[0].id,
        notes: 'Auto-generated by full demo seed.',
        termsAndCondition: 'Payment due within terms shown above.',
      },
    });
    createdInvoices.push({ id: inv.id, invoiceNumber: inv.invoiceNumber!, customerId: customer.id, contactId: customerContactIds[spec.customerIdx], total: totalAmount, date: invDate, status: spec.status });
    invoiceCount++;

    // GL: post invoice issuance for real INVOICE-type docs only (PROFORMA is
    // never posted by the real controller and is excluded from the AR
    // sub-ledger, so posting it would break the AR tie).
    if ((spec.invoiceType ?? 'INVOICE') === 'INVOICE') {
      await postInvoiceIssued(ledgerTx, {
        userId,
        invoiceId: inv.id,
        date: invDate,
        total: String(totalAmount),
        tax: String(totalTax),
      });
    }

    // Invoice payments for PAID and PARTIALLY_PAID — create the row AND post GL.
    if (spec.status === 'PAID') {
      const pay = await prisma.invoicePayment.create({
        data: {
          tenantId: userId,
          invoiceId: inv.id,
          amount: D(totalAmount),
          paymentModeId: pmBankId,
          bankId: banks[0].id,
          received_on: new Date(invDate.getTime() + 5 * 24 * 60 * 60 * 1000),
          notes: 'Full payment received via bank transfer.',
          received_by: userId,
        },
      });
      await postInvoicePayment(ledgerTx, {
        userId,
        invoiceId: inv.id,
        paymentId: pay.id,
        date: pay.received_on!,
        amount: String(totalAmount),
        paymentModeSlug: 'bank-transfer',
      });
      invoicePaymentCount++;
    } else if (spec.status === 'PARTIALLY_PAID') {
      const half = round2(totalAmount * 0.5);
      const pay = await prisma.invoicePayment.create({
        data: {
          tenantId: userId,
          invoiceId: inv.id,
          amount: D(half),
          paymentModeId: pmUpiId,
          bankId: banks[1].id,
          received_on: new Date(invDate.getTime() + 3 * 24 * 60 * 60 * 1000),
          notes: 'Partial payment (50%).',
          received_by: userId,
        },
      });
      await postInvoicePayment(ledgerTx, {
        userId,
        invoiceId: inv.id,
        paymentId: pay.id,
        date: pay.received_on!,
        amount: String(half),
        paymentModeSlug: 'upi',
      });
      invoicePaymentCount++;
    }
  }

  // Recurring parent + 2 children
  const recurringParentItems = [buildLine(12, 1, TN_INTRA)];
  const rpTaxable = round2(recurringParentItems.reduce((s, it) => s + it.taxableAmount, 0));
  const rpTax = round2(recurringParentItems.reduce((s, it) => s + it.totalTax, 0));
  const rpTotal = round2(rpTaxable + rpTax);
  const parentStartOn = daysAgo(90);
  invSeq += 1;
  const recurringParent = await prisma.invoice.create({
    data: {
      invoiceNumber: `DEMO-INV-${String(invSeq).padStart(5, '0')}`,
      customerId: customers[3].id,
      contactId: customerContactIds[3],
      billToContactId: customerContactIds[3],
      invoiceDate: parentStartOn,
      dueDate: new Date(parentStartOn.getTime() + 15 * 24 * 60 * 60 * 1000),
      items: recurringParentItems as unknown as Prisma.InputJsonValue,
      status: 'PAID',
      taxableAmount: D(rpTaxable),
      TotalAmount: D(rpTotal),
      vat: D(rpTax),
      userId,
      billFrom: userId,
      billTo: customers[3].id,
      bankId: banks[0].id,
      isRecurring: true,
      repeatEvery: 'month',
      startOn: parentStartOn,
      neverExpire: true,
      stopped: false,
      lastRecurringDate: daysAgo(30),
      nextRecurringDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      notes: 'Recurring monthly retainer (template).',
    },
  });
  invoiceCount++;
  // GL: post the recurring parent (PAID INVOICE) issuance + a full payment so
  // it nets to zero in AR (the original seed left it unpaid in AR; we add the
  // matching payment row + GL).
  await postInvoiceIssued(ledgerTx, {
    userId,
    invoiceId: recurringParent.id,
    date: parentStartOn,
    total: String(rpTotal),
    tax: String(rpTax),
  });
  {
    const rpPayDate = new Date(parentStartOn.getTime() + 5 * 24 * 60 * 60 * 1000);
    const rpPay = await prisma.invoicePayment.create({
      data: {
        tenantId: userId,
        invoiceId: recurringParent.id,
        amount: D(rpTotal),
        paymentModeId: pmBankId,
        bankId: banks[0].id,
        received_on: rpPayDate,
        notes: 'Recurring parent — full payment.',
        received_by: userId,
      },
    });
    await postInvoicePayment(ledgerTx, {
      userId,
      invoiceId: recurringParent.id,
      paymentId: rpPay.id,
      date: rpPayDate,
      amount: String(rpTotal),
      paymentModeSlug: 'bank-transfer',
    });
    invoicePaymentCount++;
    // Track for bank-transaction creation in the bank-transactions section below.
    recurringInvPayments.push({ paymentId: rpPay.id, amount: rpTotal, date: rpPayDate, invoiceNumber: recurringParent.invoiceNumber! });
  }

  for (let i = 0; i < 2; i++) {
    invSeq += 1;
    const childDate = daysAgo(60 - i * 30);
    const child = await prisma.invoice.create({
      data: {
        invoiceNumber: `DEMO-INV-${String(invSeq).padStart(5, '0')}`,
        customerId: customers[3].id,
        contactId: customerContactIds[3],
        billToContactId: customerContactIds[3],
        invoiceDate: childDate,
        dueDate: new Date(childDate.getTime() + 15 * 24 * 60 * 60 * 1000),
        items: recurringParentItems as unknown as Prisma.InputJsonValue,
        status: 'PAID',
        taxableAmount: D(rpTaxable),
        TotalAmount: D(rpTotal),
        vat: D(rpTax),
        userId,
        billFrom: userId,
        billTo: customers[3].id,
        bankId: banks[0].id,
        parentInvoice: recurringParent.id,
        notes: `Recurring child #${i + 1} of monthly retainer.`,
      },
    });
    await postInvoiceIssued(ledgerTx, {
      userId,
      invoiceId: child.id,
      date: childDate,
      total: String(rpTotal),
      tax: String(rpTax),
    });
    const childPayDate = new Date(childDate.getTime() + 5 * 24 * 60 * 60 * 1000);
    const childPay = await prisma.invoicePayment.create({
      data: {
        tenantId: userId,
        invoiceId: child.id,
        amount: D(rpTotal),
        paymentModeId: pmBankId,
        bankId: banks[0].id,
        received_on: childPayDate,
        notes: 'Recurring monthly payment.',
        received_by: userId,
      },
    });
    await postInvoicePayment(ledgerTx, {
      userId,
      invoiceId: child.id,
      paymentId: childPay.id,
      date: childPayDate,
      amount: String(rpTotal),
      paymentModeSlug: 'bank-transfer',
    });
    invoiceCount++;
    invoicePaymentCount++;
    // Track for bank-transaction creation in the bank-transactions section below.
    recurringInvPayments.push({ paymentId: childPay.id, amount: rpTotal, date: childPayDate, invoiceNumber: child.invoiceNumber! });
  }
  record('invoices', invoiceCount);
  record('invoicePayments', invoicePaymentCount);

  // -------------------------------------------------------------------------
  // Purchases (6)
  // -------------------------------------------------------------------------
  let purchaseCount = 0;
  type CreatedPur = { id: string; purchaseId: string; supplierName: string; supplierContactId: string; total: number; date: Date; status: string };
  const createdPurchases: CreatedPur[] = [];
  // Supplier payment bank transactions are deferred to the bank-transactions
  // section (below) where bankBalances is available for before/after tracking.
  type SupplierPaymentBankTxn = { bankId: string; amount: number; date: Date; referenceNo: string; remarks: string; relatedId: string };
  const supplierPaymentBankTxns: SupplierPaymentBankTxn[] = [];
  for (let i = 0; i < 6; i++) {
    const supplierIdx = i % suppliers.length;
    const supplier = suppliers[supplierIdx];
    const supplierContactId = supplierContactIds[supplierIdx];
    const pProduct = products[(i + 5) % products.length];
    const qty = 5 + i;
    const taxable = round2(qty * pProduct.buy);
    const tax = round2((taxable * 18) / 100);
    const total = round2(taxable + tax);
    const purDate = daysAgo(60 - i * 9);
    const dueDate = new Date(purDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const statuses = ['paid', 'paid', 'partially_paid', 'pending', 'pending', 'completed'] as const;

    const purchase = await prisma.purchase.create({
      data: {
        purchaseId: `DEMO-PUR-${String(i + 1).padStart(5, '0')}`,
        supplierId: supplier.id,
        contactId: supplierContactId,
        purchaseDate: purDate,
        dueDate,
        status: statuses[i],
        items: [
          {
            productId: pProduct.id,
            productName: pProduct.name,
            description: pProduct.name,
            qty,
            rate: pProduct.buy,
            discount: 0,
            taxableAmount: taxable,
            taxes: [
              { taxRateId: taxRateByName['IGST 18%'].id, name: 'IGST 18%', kind: 'IGST', percent: 18, amount: tax },
            ],
            totalTax: tax,
            lineTotal: total,
          },
        ] as unknown as Prisma.InputJsonValue,
        paymentModeId: pmBankId,
        taxableAmount: D(taxable),
        totalDiscount: D(0),
        totalTax: D(tax),
        totalAmount: D(total),
        paidAmount: statuses[i] === 'paid' || statuses[i] === 'completed' ? D(total) : statuses[i] === 'partially_paid' ? D(round2(total / 2)) : D(0),
        balanceAmount: statuses[i] === 'paid' || statuses[i] === 'completed' ? D(0) : statuses[i] === 'partially_paid' ? D(round2(total / 2)) : D(total),
        bankId: banks[i % banks.length].id,
        userId,
        billFrom: userId,
        billTo: userId,
        notes: `Demo purchase from ${supplier.name}.`,
      },
    });
    purchaseCount++;
    createdPurchases.push({
      id: purchase.id,
      purchaseId: purchase.purchaseId!,
      supplierName: supplier.name,
      supplierContactId,
      total,
      date: purDate,
      status: statuses[i],
    });
    // GL: post purchase received. inventoryNet=0 so net hits PURCHASES expense
    // (avoids inventory/COGS coupling); split must reconcile: 0+taxable+tax=total.
    await postPurchaseReceived(ledgerTx, {
      userId,
      purchaseId: purchase.id,
      date: purDate,
      total: String(total),
      tax: String(tax),
      inventoryNet: '0',
      expenseNet: String(taxable),
    });

    // Supplier payment for the paid ones — create the row AND post GL.
    if (statuses[i] === 'paid' || statuses[i] === 'completed' || statuses[i] === 'partially_paid') {
      const payAmount = statuses[i] === 'partially_paid' ? round2(total / 2) : total;
      const payDate = new Date(purDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const sp = await prisma.supplierPayment.create({
        data: {
          tenantId: userId,
          paymentId: `DEMO-PAY-${String(i + 1).padStart(5, '0')}`,
          purchaseId: purchase.id,
          supplierId: supplier.id,
          contactId: supplierContactId,
          paymentDate: payDate,
          paymentModeId: pmBankId,
          sourceType: 'BANK',
          bankId: banks[i % banks.length].id,
          amount: payAmount,
          paidAmount: payAmount,
          dueAmount: statuses[i] === 'partially_paid' ? round2(total / 2) : 0,
          notes: `Payment to ${supplier.name}.`,
          createdBy: userId,
        },
      });
      await postSupplierPayment(ledgerTx, {
        userId,
        purchaseId: purchase.id,
        paymentId: sp.id,
        date: payDate,
        amount: String(payAmount),
        sourceType: 'BANK',
        paymentModeSlug: 'bank-transfer',
      });
      // Record supplier payment details for bank transaction creation below
      // (bankBalances dict is not yet defined at this point in the seed).
      supplierPaymentBankTxns.push({
        bankId: banks[i % banks.length].id,
        amount: payAmount,
        date: payDate,
        referenceNo: `DEMO-PAY-${String(i + 1).padStart(5, '0')}`,
        remarks: `Supplier payment: ${supplier.name}`,
        relatedId: sp.id,
      });
    }
  }
  record('purchases', purchaseCount);

  // -------------------------------------------------------------------------
  // Expenses (12) — 2 recurring parents + 2 children + 8 one-off
  // -------------------------------------------------------------------------
  let expenseCount = 0;

  // Recurring parent: Office Rent (monthly)
  const rentParent = await prisma.expense.create({
    data: {
      expenseId: `DEMO-EXP-${String(1).padStart(5, '0')}`,
      amount: D(45000),
      expenseDate: daysAgo(90),
      paymentModeId: pmBankId,
      paymentStatus: 'PAID',
      description: 'Monthly office rent — Chennai HQ (recurring template).',
      expenseCategoryId: expCats['Demo Office Rent'],
      sourceType: 'BANK',
      bankId: banks[0].id,
      userId,
      isRecurring: true,
      repeatEvery: 'month',
      startOn: daysAgo(90),
      neverExpire: true,
      stopped: false,
      lastRecurringDate: daysAgo(30),
      nextRecurringDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    },
  });
  expenseCount++;
  await postExpense(ledgerTx, {
    userId,
    expenseId: rentParent.id,
    date: rentParent.expenseDate ?? daysAgo(90),
    total: String(45000),
    tax: '0',
    expenseAccountId: accountByCode['5002']!,
    sourceType: 'BANK',
    paymentModeSlug: 'bank-transfer',
  });

  // Recurring parent: Internet (monthly)
  const internetParent = await prisma.expense.create({
    data: {
      expenseId: `DEMO-EXP-${String(2).padStart(5, '0')}`,
      amount: D(3500),
      expenseDate: daysAgo(85),
      paymentModeId: pmUpiId,
      paymentStatus: 'PAID',
      description: 'Monthly internet — leased line (recurring template).',
      expenseCategoryId: expCats['Demo Utilities'],
      sourceType: 'BANK',
      bankId: banks[1].id,
      supplierId: suppliers[3].id,
      contactId: supplierContactIds[3],
      userId,
      isRecurring: true,
      repeatEvery: 'month',
      startOn: daysAgo(85),
      neverExpire: true,
      stopped: false,
      lastRecurringDate: daysAgo(25),
      nextRecurringDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    },
  });
  expenseCount++;
  await postExpense(ledgerTx, {
    userId,
    expenseId: internetParent.id,
    date: internetParent.expenseDate ?? daysAgo(85),
    total: String(3500),
    tax: '0',
    expenseAccountId: accountByCode['5002']!,
    sourceType: 'BANK',
    paymentModeSlug: 'upi',
  });

  // 2 children for rent (monthly)
  for (let i = 0; i < 2; i++) {
    const childDate = daysAgo(60 - i * 30);
    const rentChild = await prisma.expense.create({
      data: {
        expenseId: `DEMO-EXP-${String(3 + i).padStart(5, '0')}`,
        amount: D(45000),
        expenseDate: childDate,
        paymentModeId: pmBankId,
        paymentStatus: 'PAID',
        description: `Monthly office rent — month ${i + 1}.`,
        expenseCategoryId: expCats['Demo Office Rent'],
        sourceType: 'BANK',
        bankId: banks[0].id,
        userId,
        parentExpense: rentParent.id,
      },
    });
    await postExpense(ledgerTx, {
      userId,
      expenseId: rentChild.id,
      date: childDate,
      total: String(45000),
      tax: '0',
      expenseAccountId: accountByCode['5002']!,
      sourceType: 'BANK',
      paymentModeSlug: 'bank-transfer',
    });
    expenseCount++;
  }

  // 1 child for internet
  const internetChild = await prisma.expense.create({
    data: {
      expenseId: `DEMO-EXP-${String(5).padStart(5, '0')}`,
      amount: D(3500),
      expenseDate: daysAgo(55),
      paymentModeId: pmUpiId,
      paymentStatus: 'PAID',
      description: 'Monthly internet — last month.',
      expenseCategoryId: expCats['Demo Utilities'],
      sourceType: 'BANK',
      bankId: banks[1].id,
      supplierId: suppliers[3].id,
      contactId: supplierContactIds[3],
      userId,
      parentExpense: internetParent.id,
    },
  });
  await postExpense(ledgerTx, {
    userId,
    expenseId: internetChild.id,
    date: daysAgo(55),
    total: String(3500),
    tax: '0',
    expenseAccountId: accountByCode['5002']!,
    sourceType: 'BANK',
    paymentModeSlug: 'upi',
  });
  expenseCount++;

  // 7 one-off expenses (mixed)
  const oneOffSpecs = [
    { amt: 12500, cat: 'Demo Software & Subscriptions', desc: 'Adobe Creative Cloud annual subscription', supp: 3, status: 'PAID', pm: pmCardId, days: 50 },
    { amt: 8500, cat: 'Demo Travel', desc: 'Client visit Mumbai — flight + cab', supp: null, status: 'PAID', pm: pmCardId, days: 40 },
    { amt: 22000, cat: 'Demo Marketing', desc: 'Q1 digital marketing campaign', supp: null, status: 'PAID', pm: pmBankId, days: 38 },
    { amt: 1850, cat: 'Demo Utilities', desc: 'Electricity bill', supp: null, status: 'PAID', pm: pmUpiId, days: 22 },
    { amt: 5400, cat: 'Demo Software & Subscriptions', desc: 'GitHub Enterprise — 1 month', supp: null, status: 'PAID', pm: pmCardId, days: 18 },
    { amt: 6700, cat: 'Demo Travel', desc: 'Client visit Bangalore — train + hotel', supp: null, status: 'PENDING', pm: pmCardId, days: 8 },
    { amt: 15000, cat: 'Demo Marketing', desc: 'Social media boost (LinkedIn ads)', supp: null, status: 'PENDING', pm: pmCardId, days: 3 },
  ];
  for (let i = 0; i < oneOffSpecs.length; i++) {
    const o = oneOffSpecs[i];
    const oneOff = await prisma.expense.create({
      data: {
        expenseId: `DEMO-EXP-${String(6 + i).padStart(5, '0')}`,
        amount: D(o.amt),
        expenseDate: daysAgo(o.days),
        paymentModeId: o.pm,
        paymentStatus: o.status as 'PAID' | 'PENDING',
        description: o.desc,
        expenseCategoryId: expCats[o.cat],
        sourceType: 'BANK',
        bankId: banks[i % banks.length].id,
        supplierId: o.supp !== null ? suppliers[o.supp].id : null,
        contactId: o.supp !== null ? supplierContactIds[o.supp] : null,
        userId,
      },
    });
    // GL: only PAID expenses are a real cash outflow (PENDING ones are not paid,
    // so crediting BANK would overstate the outflow and break the bank tie).
    if (o.status === 'PAID') {
      await postExpense(ledgerTx, {
        userId,
        expenseId: oneOff.id,
        date: daysAgo(o.days),
        total: String(o.amt),
        tax: '0',
        expenseAccountId: accountByCode['5002']!,
        sourceType: 'BANK',
        paymentModeSlug: 'bank-transfer',
      });
    }
    expenseCount++;
  }
  record('expenses', expenseCount);

  // -------------------------------------------------------------------------
  // Quotations (5) — mix of statuses
  // -------------------------------------------------------------------------
  type QuotationSpec = {
    customerIdx: number;
    items: InvoiceItem[];
    status: 'draft' | 'sent' | 'accepted' | 'declined';
    daysAgo: number;
    expiryOffsetDays: number;
  };

  const quotationSpecs: QuotationSpec[] = [
    { customerIdx: 0, items: [buildLine(0, 3, TN_INTRA), buildLine(2, 2, TN_INTRA)], status: 'accepted', daysAgo: 60, expiryOffsetDays: 30 },
    { customerIdx: 1, items: [buildLine(11, 25, INTER), buildLine(13, 1, INTER)], status: 'sent', daysAgo: 28, expiryOffsetDays: 30 },
    { customerIdx: 2, items: [buildLine(12, 1, INTER), buildLine(14, 1, INTER)], status: 'sent', daysAgo: 14, expiryOffsetDays: 30 },
    { customerIdx: 5, items: [buildLine(3, 2, INTER), buildLine(4, 2, INTER)], status: 'declined', daysAgo: 50, expiryOffsetDays: 30 },
    { customerIdx: 7, items: [buildLine(7, 4, INTER)], status: 'draft', daysAgo: 4, expiryOffsetDays: 30 },
  ];

  let quotationCount = 0;
  for (let i = 0; i < quotationSpecs.length; i++) {
    const spec = quotationSpecs[i];
    const totalTaxable = round2(spec.items.reduce((s, it) => s + it.taxableAmount, 0));
    const totalTax = round2(spec.items.reduce((s, it) => s + it.totalTax, 0));
    const totalAmount = round2(totalTaxable + totalTax);
    const qDate = daysAgo(spec.daysAgo);
    const expiry = new Date(qDate.getTime() + spec.expiryOffsetDays * 24 * 60 * 60 * 1000);
    const customer = customers[spec.customerIdx];
    await prisma.quotation.create({
      data: {
        quotationId: `DEMO-QT-${String(i + 1).padStart(6, '0')}`,
        customerId: customer.id,
        contactId: customerContactIds[spec.customerIdx],
        billToContactId: customerContactIds[spec.customerIdx],
        quotationDate: qDate,
        expiryDate: expiry,
        items: spec.items as unknown as Prisma.InputJsonValue,
        status: spec.status,
        paymentTerms: 'Net 30',
        taxableAmount: D(totalTaxable),
        TotalAmount: D(totalAmount),
        vat: D(totalTax),
        userId,
        billFrom: userId,
        billTo: customer.id,
        bankId: banks[0].id,
        notes: 'Auto-generated by full demo seed.',
        termsAndCondition: 'Quote valid until expiry date.',
      },
    });
    quotationCount++;
  }
  record('quotations', quotationCount);

  // -------------------------------------------------------------------------
  // Credit Notes (3) — issued against PAID invoices
  // -------------------------------------------------------------------------
  let creditNoteCount = 0;
  const paidInvoicesForCN = createdInvoices.filter((i) => i.status === 'PAID').slice(0, 3);
  const cnStatuses: Array<'PENDING' | 'PAID' | 'CANCELLED'> = ['PENDING', 'PAID', 'CANCELLED'];
  const cnReasons: Array<'RETURN' | 'DAMAGED_GOODS' | 'OVERCHARGE'> = ['RETURN', 'DAMAGED_GOODS', 'OVERCHARGE'];
  for (let i = 0; i < paidInvoicesForCN.length; i++) {
    const inv = paidInvoicesForCN[i];
    // Partial credit (~20% of invoice)
    const taxable = round2(inv.total * 0.18);
    const tax = round2(taxable * 0.18);
    const total = round2(taxable + tax);
    const cnDate = new Date(inv.date.getTime() + 14 * 24 * 60 * 60 * 1000);
    const cn = await prisma.creditNote.create({
      data: {
        creditNoteNumber: `DEMO-CN-${String(i + 1).padStart(6, '0')}`,
        invoiceId: inv.id,
        customerId: inv.customerId,
        contactId: inv.contactId,
        billToContactId: inv.contactId,
        creditNoteDate: cnDate,
        referenceNo: inv.invoiceNumber,
        reason: cnReasons[i],
        description: `Credit note for ${inv.invoiceNumber}.`,
        items: [
          {
            productId: products[0].id,
            productName: products[0].name,
            description: 'Adjustment',
            qty: 1,
            rate: taxable,
            discount: 0,
            taxableAmount: taxable,
            taxes: [{ taxRateId: taxRateByName['IGST 18%'].id, name: 'IGST 18%', kind: 'IGST', percent: 18, amount: tax }],
            totalTax: tax,
            lineTotal: total,
          },
        ] as unknown as Prisma.InputJsonValue,
        status: cnStatuses[i],
        refund_method: i === 1 ? 'BANK_TRANSFER' : 'CREDIT_TO_ACCOUNT',
        taxableAmount: D(taxable),
        totalAmount: D(total),
        vat: D(tax),
        bankId: banks[0].id,
        notes: 'Auto-generated by full demo seed.',
        userId,
        billFrom: userId,
        billTo: inv.customerId,
        appliedToInvoice: inv.id,
        appliedDate: new Date(inv.date.getTime() + 15 * 24 * 60 * 60 * 1000),
      },
    });
    // GL: post credit note issuance for non-CANCELLED notes only.
    // CANCELLED credit notes are void and must not hit the GL.
    // Dr SALES_RETURNS (net) / Dr OUTPUT_TAX (tax) / Cr AR (total).
    if (cnStatuses[i] !== 'CANCELLED') {
      await postCreditNoteIssued(ledgerTx, {
        userId,
        creditNoteId: cn.id,
        date: cnDate,
        total: String(total),
        tax: String(tax),
      });
    }
    creditNoteCount++;
  }
  record('creditNotes', creditNoteCount);

  // -------------------------------------------------------------------------
  // Delivery Challans (4) — goods delivery notes against invoices
  // -------------------------------------------------------------------------
  let challanCount = 0;
  const invoicesForDC = createdInvoices.slice(0, 4);
  const dcStatuses: Array<'DRAFT' | 'PENDING' | 'DELIVERED' | 'CANCELLED'> = ['DELIVERED', 'DELIVERED', 'PENDING', 'DRAFT'];
  for (let i = 0; i < invoicesForDC.length; i++) {
    const inv = invoicesForDC[i];
    const taxable = round2(inv.total / 1.18);
    const tax = round2(inv.total - taxable);
    await prisma.deliveryChallan.create({
      data: {
        challanNumber: `DEMO-DC-${String(i + 1).padStart(6, '0')}`,
        invoiceId: inv.id,
        customerId: inv.customerId,
        contactId: inv.contactId,
        billToContactId: inv.contactId,
        challanDate: new Date(inv.date.getTime() + 1 * 24 * 60 * 60 * 1000),
        referenceNo: inv.invoiceNumber,
        items: [
          {
            productId: products[0].id,
            productName: products[0].name,
            description: 'Goods delivery',
            qty: 1,
            rate: taxable,
            discount: 0,
            taxableAmount: taxable,
            taxes: [{ taxRateId: taxRateByName['IGST 18%'].id, name: 'IGST 18%', kind: 'IGST', percent: 18, amount: tax }],
            totalTax: tax,
            lineTotal: inv.total,
          },
        ] as unknown as Prisma.InputJsonValue,
        status: dcStatuses[i],
        taxableAmount: D(taxable),
        totalAmount: D(inv.total),
        vat: D(tax),
        bankId: banks[0].id,
        notes: 'Auto-generated by full demo seed.',
        termsAndCondition: 'Please verify goods at delivery.',
        userId,
        billFrom: userId,
        billTo: inv.customerId,
        receivedBy: dcStatuses[i] === 'DELIVERED' ? 'Customer Representative' : '',
        receivedDate: dcStatuses[i] === 'DELIVERED' ? new Date(inv.date.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
      },
    });
    challanCount++;
  }
  record('deliveryChallans', challanCount);

  // -------------------------------------------------------------------------
  // Purchase Orders (5) — outgoing orders to suppliers
  // -------------------------------------------------------------------------
  let purchaseOrderCount = 0;
  const poStatuses: Array<'new' | 'pending' | 'completed' | 'cancelled'> = ['new', 'pending', 'pending', 'completed', 'completed'];
  for (let i = 0; i < 5; i++) {
    const poSupplierIdx = i % suppliers.length;
    const pProduct = products[(i + 2) % products.length];
    const qty = 8 + i * 2;
    const taxable = round2(qty * pProduct.buy);
    const tax = round2((taxable * 18) / 100);
    const total = round2(taxable + tax);
    const poDate = daysAgo(50 - i * 8);
    const dueDate = new Date(poDate.getTime() + 21 * 24 * 60 * 60 * 1000);
    await prisma.purchaseOrder.create({
      data: {
        purchaseOrderId: `DEMO-PO-${String(i + 1).padStart(6, '0')}`,
        supplierId: suppliers[poSupplierIdx].id,
        contactId: supplierContactIds[poSupplierIdx],
        purchaseOrderDate: poDate,
        dueDate,
        status: poStatuses[i],
        paymentMode: 'BANK_TRANSFER',
        items: [
          {
            productId: pProduct.id,
            productName: pProduct.name,
            description: pProduct.name,
            qty,
            rate: pProduct.buy,
            discount: 0,
            taxableAmount: taxable,
            taxes: [{ taxRateId: taxRateByName['IGST 18%'].id, name: 'IGST 18%', kind: 'IGST', percent: 18, amount: tax }],
            totalTax: tax,
            lineTotal: total,
          },
        ] as unknown as Prisma.InputJsonValue,
        taxableAmount: D(taxable),
        totalDiscount: D(0),
        vat: D(tax),
        TotalAmount: D(total),
        bankId: banks[i % banks.length].id,
        userId,
        billFrom: userId,
        billTo: userId,
        notes: `Demo PO for ${pProduct.name}.`,
        termsAndCondition: 'Delivery within 21 days.',
      },
    });
    purchaseOrderCount++;
  }
  record('purchaseOrders', purchaseOrderCount);

  // -------------------------------------------------------------------------
  // Debit Notes (3) — issued against existing Purchases
  // -------------------------------------------------------------------------
  let debitNoteCount = 0;
  const purchasesForDN = createdPurchases.slice(0, 3);
  const dnStatuses: Array<'new' | 'pending' | 'completed' | 'paid'> = ['new', 'pending', 'paid'];
  for (let i = 0; i < purchasesForDN.length; i++) {
    const pur = purchasesForDN[i];
    // Adjustment ~15% of purchase
    const taxable = round2(pur.total * 0.13);
    const tax = round2(taxable * 0.18);
    const total = round2(taxable + tax);
    await prisma.debitNote.create({
      data: {
        debitNoteId: `DEMO-DN-${String(i + 1).padStart(6, '0')}`,
        purchaseId: pur.id,
        contactId: pur.supplierContactId,
        billToContactId: pur.supplierContactId,
        debitNoteDate: new Date(pur.date.getTime() + 10 * 24 * 60 * 60 * 1000),
        dueDate: new Date(pur.date.getTime() + 40 * 24 * 60 * 60 * 1000),
        referenceNo: pur.purchaseId,
        items: [
          {
            productId: products[0].id,
            productName: products[0].name,
            description: 'Return / pricing adjustment',
            qty: 1,
            rate: taxable,
            discount: 0,
            taxableAmount: taxable,
            taxes: [{ taxRateId: taxRateByName['IGST 18%'].id, name: 'IGST 18%', kind: 'IGST', percent: 18, amount: tax }],
            totalTax: tax,
            lineTotal: total,
          },
        ] as unknown as Prisma.InputJsonValue,
        status: dnStatuses[i],
        paymentModeId: pmBankId,
        taxableAmount: D(taxable),
        totalDiscount: D(0),
        totalTax: D(tax),
        totalAmount: D(total),
        paidAmount: dnStatuses[i] === 'paid' ? D(total) : D(0),
        balanceAmount: dnStatuses[i] === 'paid' ? D(0) : D(total),
        bankId: banks[0].id,
        notes: `Debit note against ${pur.purchaseId}: ${pur.supplierName}.`,
        userId,
        createdBy: userId,
        billFrom: userId,
      },
    });
    debitNoteCount++;
  }
  record('debitNotes', debitNoteCount);

  // -------------------------------------------------------------------------
  // PettyCash (1 cashbook + 8 transactions) — mix of ADD (top-ups) & SPEND
  // -------------------------------------------------------------------------
  const pcOpening = 5000;
  const pcRow = await prisma.pettyCash.create({
    data: {
      openingBalance: D(pcOpening),
      currentBalance: D(pcOpening),
      asOnDate: daysAgo(60),
    },
  });

  const pcTxSpecs: Array<{
    type: 'ADD' | 'SPEND' | 'RETURN';
    amount: number;
    relatedType: 'PETTY_CASH' | 'SUPPLIER_PAYMENT' | 'EXPENSE' | 'BANK';
    relatedId: string;
    remarks: string;
    days: number;
  }> = [
    { type: 'ADD', amount: 10000, relatedType: 'BANK', relatedId: banks[0].id, remarks: 'DEMO-PC-TOPUP-001 Top-up from HDFC', days: 55 },
    { type: 'SPEND', amount: 450, relatedType: 'EXPENSE', relatedId: expCats['Demo Utilities'], remarks: 'DEMO-PC-001 Office tea/snacks', days: 50 },
    { type: 'SPEND', amount: 1200, relatedType: 'EXPENSE', relatedId: expCats['Demo Travel'], remarks: 'DEMO-PC-002 Local courier charges', days: 45 },
    { type: 'SPEND', amount: 800, relatedType: 'EXPENSE', relatedId: expCats['Demo Utilities'], remarks: 'DEMO-PC-003 Office cleaning supplies', days: 40 },
    { type: 'ADD', amount: 5000, relatedType: 'BANK', relatedId: banks[0].id, remarks: 'DEMO-PC-TOPUP-002 Top-up from HDFC', days: 32 },
    { type: 'SPEND', amount: 2200, relatedType: 'EXPENSE', relatedId: expCats['Demo Travel'], remarks: 'DEMO-PC-004 Auto rickshaw fares', days: 25 },
    { type: 'SPEND', amount: 350, relatedType: 'EXPENSE', relatedId: expCats['Demo Office Rent'], remarks: 'DEMO-PC-005 Photocopy/printing', days: 18 },
    { type: 'RETURN', amount: 500, relatedType: 'PETTY_CASH', relatedId: pcRow.id, remarks: 'DEMO-PC-RET-001 Unused advance returned', days: 10 },
  ];

  let pcBalance = pcOpening;
  let pettyCashTxCount = 0;
  for (const t of pcTxSpecs) {
    const before = pcBalance;
    const after = round2(t.type === 'SPEND' ? before - t.amount : before + t.amount);
    await prisma.pettyCashTransaction.create({
      data: {
        tenantId: userId,
        pettyCashId: pcRow.id,
        transactionDate: daysAgo(t.days),
        transactionType: t.type,
        amount: D(t.amount),
        balanceBefore: D(before),
        balanceAfter: D(after),
        remarks: t.remarks,
        relatedType: t.relatedType,
        relatedId: t.relatedId,
      },
    });
    pcBalance = after;
    pettyCashTxCount++;
  }
  // Update current balance on PettyCash row
  await prisma.pettyCash.update({
    where: { id: pcRow.id },
    data: { currentBalance: D(pcBalance), asOnDate: new Date() },
  });
  record('pettyCash', 1);
  record('pettyCashTransactions', pettyCashTxCount);

  // -------------------------------------------------------------------------
  // Journal Entries (3 balanced)
  // -------------------------------------------------------------------------
  await prisma.journalEntry.create({
    data: {
      userId,
      entryNumber: 'DEMO-JE-00001',
      entryDate: daysAgo(85),
      description: 'Owner contribution — initial capital',
      reference: 'OPEN-001',
      isPosted: true,
      lines: {
        create: [
          { tenantId: userId, accountId: accountByCode['1001']!, debit: D(100000), credit: D(0), description: 'Cash deposit' },
          { tenantId: userId, accountId: accountByCode['3050']!, debit: D(0), credit: D(100000), description: 'Owner equity' },
        ],
      },
    },
  });
  await prisma.journalEntry.create({
    data: {
      userId,
      entryNumber: 'DEMO-JE-00002',
      entryDate: daysAgo(60),
      description: 'Prepaid rent for Q2',
      reference: 'JE-RENT-Q2',
      isPosted: true,
      lines: {
        create: [
          { tenantId: userId, accountId: accountByCode['5002']!, debit: D(45000), credit: D(0), description: 'Rent expense' },
          { tenantId: userId, accountId: accountByCode['1001']!, debit: D(0), credit: D(45000), description: 'Paid from cash' },
        ],
      },
    },
  });
  await prisma.journalEntry.create({
    data: {
      userId,
      entryNumber: 'DEMO-JE-00003',
      entryDate: daysAgo(45),
      description: 'Cash deposit to bank',
      reference: 'JE-DEPOSIT-001',
      isPosted: true,
      lines: {
        create: [
          { tenantId: userId, accountId: accountByCode['1002']!, debit: D(250000), credit: D(0), description: 'Bank account' },
          { tenantId: userId, accountId: accountByCode['1001']!, debit: D(0), credit: D(250000), description: 'Cash on hand' },
        ],
      },
    },
  });
  record('journalEntries', 3);

  // -------------------------------------------------------------------------
  // BankTransactions (~30) — mix of deposits/withdrawals + reconciled state
  // -------------------------------------------------------------------------
  // Running balance per bank
  const bankBalances: Record<string, number> = {};
  for (const b of banks) bankBalances[b.id] = b.balance;

  let txCount = 0;

  // NOTE: DEMO-JE-00003 ("Cash deposit to bank") is a manually created
  // JournalEntry whose lines only have `debit`/`credit` fields set, NOT
  // `baseDebit`/`baseCredit`. The tally-check aggregates on baseDebit/baseCredit,
  // so JE-00003 contributes ZERO to GL BANK. We do NOT create a bank txn for it.

  // Deposits (correspond to invoice payments)
  let txIdx = 0;
  for (const inv of createdInvoices) {
    if (inv.status === 'PAID' || inv.status === 'PARTIALLY_PAID') {
      const bankId = banks[txIdx % banks.length].id;
      const amount = inv.status === 'PARTIALLY_PAID' ? round2(inv.total / 2) : inv.total;
      const before = bankBalances[bankId];
      const after = round2(before + amount);
      await prisma.bankTransaction.create({
        data: {
          tenantId: userId,
          bankAccountId: bankId,
          transactionDate: new Date(inv.date.getTime() + 5 * 24 * 60 * 60 * 1000),
          type: 'DEPOSIT',
          amount: D(amount),
          balanceBefore: D(before),
          balanceAfter: D(after),
          paymentModeId: pmBankId,
          referenceNo: inv.invoiceNumber,
          remarks: `Payment received for ${inv.invoiceNumber}`,
          relatedType: 'INVOICE_PAYMENT',
          relatedId: inv.id,
          explainStatus: 'EXPLAINED',
          isReconciled: txIdx % 3 !== 0,
          reconciledBy: txIdx % 3 !== 0 ? userId : null,
          reconciliationDate: txIdx % 3 !== 0 ? new Date(inv.date.getTime() + 6 * 24 * 60 * 60 * 1000) : null,
        },
      });
      bankBalances[bankId] = after;
      txCount++;
      txIdx++;
    }
  }

  // Recurring invoice payment deposits — the recurring parent + 2 child invoice
  // payments were created + GL-posted above but are NOT in createdInvoices[], so
  // the loop above missed them. Add their bank transactions here so currentBalance
  // reflects the inflows that are already in GL BANK.
  for (const rp of recurringInvPayments) {
    const bankId = banks[0].id; // all recurring invoices use banks[0] (HDFC)
    const before = bankBalances[bankId];
    const after = round2(before + rp.amount);
    await prisma.bankTransaction.create({
      data: {
        tenantId: userId,
        bankAccountId: bankId,
        transactionDate: rp.date,
        type: 'DEPOSIT',
        amount: D(rp.amount),
        balanceBefore: D(before),
        balanceAfter: D(after),
        paymentModeId: pmBankId,
        referenceNo: rp.invoiceNumber,
        remarks: `Payment received for ${rp.invoiceNumber}`,
        relatedType: 'INVOICE_PAYMENT',
        relatedId: rp.paymentId,
        explainStatus: 'EXPLAINED',
        isReconciled: true,
        reconciledBy: userId,
      },
    });
    bankBalances[bankId] = after;
    txCount++;
  }

  // Withdrawals (for paid expenses)
  const paidExpenses = await prisma.expense.findMany({
    where: { userId, paymentStatus: 'PAID' },
    take: 12,
  });
  for (let i = 0; i < paidExpenses.length; i++) {
    const e = paidExpenses[i];
    const bankId = e.bankId ?? banks[0].id;
    const amount = Number(e.amount);
    const before = bankBalances[bankId] ?? banks[0].balance;
    const after = round2(before - amount);
    await prisma.bankTransaction.create({
      data: {
        tenantId: userId,
        bankAccountId: bankId,
        transactionDate: e.expenseDate,
        type: 'WITHDRAWAL',
        amount: D(amount),
        balanceBefore: D(before),
        balanceAfter: D(after),
        paymentModeId: e.paymentModeId ?? pmBankId,
        referenceNo: e.expenseId,
        remarks: `Expense: ${e.description}`,
        relatedType: 'EXPENSE',
        relatedId: e.id,
        explainStatus: 'EXPLAINED',
        isReconciled: i % 2 === 0,
        reconciledBy: i % 2 === 0 ? userId : null,
      },
    });
    bankBalances[bankId] = after;
    txCount++;
  }

  // Supplier payment bank transactions — deferred from the purchases section
  // above so we can use bankBalances for before/after balance tracking.
  // These correspond to the postSupplierPayment GL postings (Cr BANK) above.
  // Without these txns, currentBalance doesn't reflect the cash outflow but
  // the GL does — causing bankAggregate.glVsCurrentTied = false.
  for (const sp of supplierPaymentBankTxns) {
    const before = bankBalances[sp.bankId] ?? banks[0].balance;
    const after = round2(before - sp.amount);
    await prisma.bankTransaction.create({
      data: {
        tenantId: userId,
        bankAccountId: sp.bankId,
        transactionDate: sp.date,
        type: 'WITHDRAWAL',
        amount: D(sp.amount),
        balanceBefore: D(before),
        balanceAfter: D(after),
        paymentModeId: pmBankId,
        referenceNo: sp.referenceNo,
        remarks: sp.remarks,
        relatedType: 'SUPPLIER_PAYMENT',
        relatedId: sp.relatedId,
        explainStatus: 'EXPLAINED',
        isReconciled: false,
      },
    });
    bankBalances[sp.bankId] = after;
    txCount++;
  }

  // A handful of manual transfers/cash deposits to bulk to 30+
  // GL: each manual bank txn posts a balanced entry (Dr/Cr BANK with offset to
  // OPENING_BALANCE_EQUITY) so GL bank matches currentBalance. These represent
  // cash movements with no specific P&L impact. Idempotent via sourceId.
  for (let i = 0; i < 12; i++) {
    const bankId = banks[i % banks.length].id;
    const isDeposit = i % 2 === 0;
    const amount = round2(2000 + i * 500);
    const before = bankBalances[bankId] ?? banks[0].balance;
    const after = isDeposit ? round2(before + amount) : round2(before - amount);
    const txnDate = daysAgo(80 - i * 5);
    await prisma.bankTransaction.create({
      data: {
        tenantId: userId,
        bankAccountId: bankId,
        transactionDate: txnDate,
        type: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
        amount: D(amount),
        balanceBefore: D(before),
        balanceAfter: D(after),
        paymentModeId: pmCashId,
        referenceNo: `DEMO-BT-MANUAL-${String(i + 1).padStart(3, '0')}`,
        remarks: isDeposit ? 'Cash deposit (manual)' : 'Cash withdrawal (manual)',
        relatedType: 'MANUAL',
        explainStatus: 'EXPLAINED',
        isReconciled: i < 4,
        reconciledBy: i < 4 ? userId : null,
      },
    });
    bankBalances[bankId] = after;
    txCount++;
    // GL: post matching balanced entry for the manual bank movement.
    // Deposit  → Dr BANK / Cr OPENING_BALANCE_EQUITY (cash injected into bank).
    // Withdrawal → Dr OPENING_BALANCE_EQUITY / Cr BANK (cash withdrawn from bank).
    await post(ledgerTx as unknown as import('../lib/ledger/postingEngine').LedgerTx, {
      userId,
      sourceType: 'BankTransaction',
      sourceId: `manual-${i}`,
      event: 'manual',
      date: txnDate,
      currencyCode: 'BASE',
      description: isDeposit ? 'Cash deposit (manual)' : 'Cash withdrawal (manual)',
      instructions: isDeposit
        ? [
            { roleKey: 'BANK', side: 'debit', amount: String(amount) },
            { roleKey: 'OPENING_BALANCE_EQUITY', side: 'credit', amount: String(amount) },
          ]
        : [
            { roleKey: 'OPENING_BALANCE_EQUITY', side: 'debit', amount: String(amount) },
            { roleKey: 'BANK', side: 'credit', amount: String(amount) },
          ],
    });
  }

  // Update bank current balances to reflect transactions
  for (const b of banks) {
    await prisma.bankDetail.update({
      where: { id: b.id },
      data: { currentBalance: D(bankBalances[b.id] ?? b.balance) },
    });
  }
  record('bankTransactions', txCount);

  // -------------------------------------------------------------------------
  // PaymentTransactions (3 OFFLINE + 1 RAZORPAY-style CREATED)
  // -------------------------------------------------------------------------
  let ptCount = 0;
  const paidInvoices = createdInvoices.filter((i) => i.status === 'PAID').slice(0, 3);
  for (let i = 0; i < paidInvoices.length; i++) {
    const inv = paidInvoices[i];
    await prisma.paymentTransaction.create({
      data: {
        userId,
        invoiceId: inv.id,
        kind: 'OFFLINE',
        status: 'CAPTURED',
        amount: D(inv.total),
        currency: 'INR',
        gatewayOrderId: `DEMO-ORD-${randomBytes(4).toString('hex').toUpperCase()}`,
        gatewayPaymentId: `DEMO-PAY-${randomBytes(4).toString('hex').toUpperCase()}`,
        metadata: { source: 'demo-seed', invoiceNumber: inv.invoiceNumber },
      },
    });
    ptCount++;
  }
  // 1 Razorpay CREATED (i.e. checkout started but not paid)
  const unpaidInvoice = createdInvoices.find((i) => i.status === 'UNPAID');
  if (unpaidInvoice) {
    await prisma.paymentTransaction.create({
      data: {
        userId,
        invoiceId: unpaidInvoice.id,
        kind: 'RAZORPAY',
        status: 'CREATED',
        amount: D(unpaidInvoice.total),
        currency: 'INR',
        gatewayOrderId: `order_DEMO${randomBytes(6).toString('hex').toUpperCase()}`,
        metadata: { source: 'demo-seed', invoiceNumber: unpaidInvoice.invoiceNumber, mock: true },
      },
    });
    ptCount++;
  }
  record('paymentTransactions', ptCount);

  // -------------------------------------------------------------------------
  // EInvoiceRecord (4) — via MockProvider-style payload
  // -------------------------------------------------------------------------
  let eInvCount = 0;
  const b2bPaid = createdInvoices.filter((i) => i.status === 'PAID').slice(0, 4);
  for (const inv of b2bPaid) {
    const irn = randomBytes(32).toString('hex');
    const ackNo = String(Math.floor(Math.random() * 1e15)).padStart(15, '0');
    await prisma.eInvoiceRecord.create({
      data: {
        userId,
        invoiceId: inv.id,
        irn,
        ackNo,
        ackDate: new Date(inv.date.getTime() + 1 * 24 * 60 * 60 * 1000),
        signedInvoice: `MOCK_SIGNED_INV_${inv.invoiceNumber}`,
        signedQRCode: `MOCK_QR_${irn.slice(0, 16)}`,
        status: 'GENERATED',
        provider: 'mock',
        metadata: { provider: 'mock', invoiceNumber: inv.invoiceNumber },
      },
    });
    eInvCount++;
  }
  record('eInvoices', eInvCount);

  // -------------------------------------------------------------------------
  // AccountingPeriods (2)
  // -------------------------------------------------------------------------
  const aprStart = new Date('2026-04-01T00:00:00.000Z');
  const aprEnd = new Date('2026-04-30T23:59:59.999Z');
  const marStart = new Date('2026-03-01T00:00:00.000Z');
  const marEnd = new Date('2026-03-31T23:59:59.999Z');
  await prisma.accountingPeriod.create({
    data: { userId, name: 'April 2026', startDate: aprStart, endDate: aprEnd, isLocked: false },
  });
  await prisma.accountingPeriod.create({
    data: { userId, name: 'March 2026', startDate: marStart, endDate: marEnd, isLocked: true, lockedAt: daysAgo(20), lockedBy: userId },
  });
  record('accountingPeriods', 2);

  // -------------------------------------------------------------------------
  // Budgets — so the Budget Variance report shows data (QA #49).
  // Tied to real GL accounts (resolved from accountByCode, populated at ledger
  // init) and the current April 2026 accounting period. A handful covering a
  // revenue account (Sales Revenue 4001) and expense accounts (Purchases 5002,
  // COGS 5001) so variance has both income- and expense-side rows.
  // -------------------------------------------------------------------------
  const budgetSpecs: Array<{ code: string; amount: number }> = [
    { code: '4001', amount: 1500000 }, // Sales Revenue
    { code: '5002', amount: 900000 },  // Purchases
    { code: '5001', amount: 350000 },  // Cost of Goods Sold
  ];
  let budgetCount = 0;
  for (const b of budgetSpecs) {
    const accountId = accountByCode[b.code];
    if (!accountId) continue; // skip codes the IN pack doesn't define
    await prisma.budget.create({
      data: {
        userId,
        accountId,
        periodStart: aprStart,
        periodEnd: aprEnd,
        amount: D(b.amount),
      },
    });
    budgetCount++;
  }
  record('budgets', budgetCount);

  // -------------------------------------------------------------------------
  // Approvals (QA #46) — enable approvals for the demo tenant and stamp the
  // first two seeded purchases as PENDING so the approvals queue shows items.
  // -------------------------------------------------------------------------
  await prisma.companySettings.update({
    where: { userId },
    data: { approvalsEnabled: true },
  });
  const pendingPurchases = createdPurchases.slice(0, 2);
  for (const pur of pendingPurchases) {
    await prisma.purchase.update({
      where: { id: pur.id },
      data: { approvalStatus: 'PENDING' },
    });
  }
  record('approvalsPending', pendingPurchases.length);

  // -------------------------------------------------------------------------
  // GatewayConfig (OFFLINE) + MessagingConfig
  // -------------------------------------------------------------------------
  await prisma.gatewayConfig.upsert({
    where: { userId_kind: { userId, kind: 'OFFLINE' } },
    update: { enabled: true, config: { instructions: 'Bank transfer to account number on invoice.' } },
    create: {
      userId,
      kind: 'OFFLINE',
      enabled: true,
      config: { instructions: 'Bank transfer to account number on invoice.' },
      livemode: false,
    },
  });
  record('gatewayConfigs', 1);

  await prisma.messagingConfig.upsert({
    where: { userId },
    update: {
      whatsappEnabled: false,
      defaultTemplate: 'Hi {{customer_name}}, your invoice {{invoice_number}} of {{amount}} is due on {{due_date}}.',
    },
    create: {
      userId,
      whatsappEnabled: false,
      defaultTemplate: 'Hi {{customer_name}}, your invoice {{invoice_number}} of {{amount}} is due on {{due_date}}.',
    },
  });
  record('messagingConfigs', 1);

  // -------------------------------------------------------------------------
  // AI features (cluster H, slice H.4)
  //   - AiConfig: MOCK provider, enabled (so the demo shows all AI UI)
  //   - AiUsageLog: spread over the last 14 days for a realistic usage chart
  //   - AiExtractionJob: one CONFIRMED (linked to a demo purchase), one
  //     EXTRACTED (awaiting confirm)
  //   - AiChatSession + AiChatMessage: two sample conversations
  // -------------------------------------------------------------------------
  await prisma.aiConfig.upsert({
    where: { userId },
    update: {
      provider: 'MOCK',
      enabled: true,
      extractionModel: 'mock-extract-v1',
      chatModel: 'mock-chat-v1',
      monthlyBudgetUsd: D(25),
    },
    create: {
      userId,
      provider: 'MOCK',
      enabled: true,
      extractionModel: 'mock-extract-v1',
      chatModel: 'mock-chat-v1',
      monthlyBudgetUsd: D(25),
    },
  });
  record('aiConfigs', 1);

  // AiUsageLog — 8 rows over the last 14 days (mix of extraction + chat).
  const usageSeed: Array<{ day: number; feature: 'extraction' | 'chat'; cost: number; inTok: number; outTok: number }> = [
    { day: 13, feature: 'chat', cost: 0.0049, inTok: 1200, outTok: 220 },
    { day: 12, feature: 'extraction', cost: 0.0031, inTok: 1800, outTok: 140 },
    { day: 10, feature: 'chat', cost: 0.0052, inTok: 1350, outTok: 250 },
    { day: 8, feature: 'extraction', cost: 0.0029, inTok: 1700, outTok: 130 },
    { day: 6, feature: 'chat', cost: 0.0061, inTok: 1500, outTok: 310 },
    { day: 4, feature: 'extraction', cost: 0.0033, inTok: 1900, outTok: 150 },
    { day: 2, feature: 'chat', cost: 0.0047, inTok: 1180, outTok: 210 },
    { day: 1, feature: 'chat', cost: 0.0055, inTok: 1420, outTok: 270 },
  ];
  let aiUsageCount = 0;
  for (const u of usageSeed) {
    await prisma.aiUsageLog.create({
      data: {
        userId,
        feature: u.feature,
        provider: 'MOCK',
        model: u.feature === 'extraction' ? 'mock-extract-v1' : 'mock-chat-v1',
        inputTokens: u.inTok,
        outputTokens: u.outTok,
        costUsd: D(u.cost),
        createdAt: daysAgo(u.day),
      },
    });
    aiUsageCount++;
  }
  record('aiUsageLogs', aiUsageCount);

  // AiExtractionJob — one CONFIRMED (linked to the first demo purchase) and
  // one EXTRACTED (awaiting confirmation). Mirrors the MockProvider's canned
  // Acme Office Supplies bill so the demo extraction history looks real.
  const acmeExtracted = {
    vendorName: 'Acme Office Supplies',
    vendorGstin: '33ABCDE1234F1Z5',
    invoiceNumber: 'ACME-2026-0419',
    invoiceDate: daysAgo(12).toISOString().slice(0, 10),
    dueDate: daysAgo(-18).toISOString().slice(0, 10),
    currency: 'INR',
    lineItems: [
      { description: 'Printer Paper A4 ream', quantity: 10, unitPrice: 400, amount: 4000 },
      { description: 'HP 805 Ink Cartridge', quantity: 4, unitPrice: 1500, amount: 6000 },
      { description: 'A4 File Folders', quantity: 20, unitPrice: 100, amount: 2000 },
    ],
    taxBreakdown: [
      { label: 'CGST', rate: 9, amount: 1080 },
      { label: 'SGST', rate: 9, amount: 1080 },
    ],
    subtotal: 12000,
    total: 14160,
    notes: 'Net 30 terms.',
    _confidence: 0.95,
  };

  const linkedPurchase = createdPurchases[0];
  let aiJobCount = 0;
  await prisma.aiExtractionJob.create({
    data: {
      userId,
      sourceFilePath: 'uploads/ai-jobs/demo-acme-bill.pdf',
      mimeType: 'application/pdf',
      status: 'CONFIRMED',
      extractedData: acmeExtracted as unknown as Prisma.InputJsonValue,
      rawResponse: JSON.stringify(acmeExtracted),
      confidence: D(0.95),
      costUsd: D(0.0031),
      resultingPurchaseId: linkedPurchase ? linkedPurchase.id : null,
      createdAt: daysAgo(12),
    },
  });
  aiJobCount++;

  const pendingExtracted = {
    vendorName: 'Stationery World Pvt Ltd',
    vendorGstin: '29XYZAB5678C1Z2',
    invoiceNumber: 'SW-INV-7741',
    invoiceDate: daysAgo(3).toISOString().slice(0, 10),
    dueDate: daysAgo(-27).toISOString().slice(0, 10),
    currency: 'INR',
    lineItems: [
      { description: 'Whiteboard Markers (box of 12)', quantity: 5, unitPrice: 600, amount: 3000 },
      { description: 'Sticky Notes (pack of 10)', quantity: 8, unitPrice: 250, amount: 2000 },
    ],
    taxBreakdown: [
      { label: 'CGST', rate: 9, amount: 450 },
      { label: 'SGST', rate: 9, amount: 450 },
    ],
    subtotal: 5000,
    total: 5900,
    notes: 'Awaiting confirmation.',
    _confidence: 0.88,
  };
  await prisma.aiExtractionJob.create({
    data: {
      userId,
      sourceFilePath: 'uploads/ai-jobs/demo-stationery-bill.jpg',
      mimeType: 'image/jpeg',
      status: 'EXTRACTED',
      extractedData: pendingExtracted as unknown as Prisma.InputJsonValue,
      rawResponse: JSON.stringify(pendingExtracted),
      confidence: D(0.88),
      costUsd: D(0.0029),
      createdAt: daysAgo(3),
    },
  });
  aiJobCount++;
  record('aiExtractionJobs', aiJobCount);

  // AiChatSession + AiChatMessage — two sample conversations.
  let aiSessionCount = 0;
  let aiMessageCount = 0;

  const session1 = await prisma.aiChatSession.create({
    data: {
      userId,
      title: 'How much GST do I owe this quarter?',
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
    },
  });
  aiSessionCount++;
  const s1Messages: Array<Prisma.AiChatMessageCreateManyInput> = [
    {
      tenantId: userId,
      sessionId: session1.id,
      role: 'USER',
      content: 'How much GST do I owe this quarter?',
      createdAt: daysAgo(6),
    },
    {
      tenantId: userId,
      sessionId: session1.id,
      role: 'ASSISTANT',
      content: '',
      toolName: 'get_gst_summary',
      toolInput: {} as Prisma.InputJsonValue,
      createdAt: new Date(daysAgo(6).getTime() + 1000),
    },
    {
      tenantId: userId,
      sessionId: session1.id,
      role: 'TOOL',
      content: '',
      toolName: 'get_gst_summary',
      toolResult: { outputTax: 84600, inputTaxCredit: 31200, netPayable: 53400 } as Prisma.InputJsonValue,
      createdAt: new Date(daysAgo(6).getTime() + 2000),
    },
    {
      tenantId: userId,
      sessionId: session1.id,
      role: 'ASSISTANT',
      content:
        'For the current quarter your output GST is ₹84,600 and your input tax credit is ₹31,200, leaving a net GST payable of ₹53,400.',
      costUsd: D(0.0061),
      createdAt: new Date(daysAgo(6).getTime() + 3000),
    },
  ];
  await prisma.aiChatMessage.createMany({ data: s1Messages });
  aiMessageCount += s1Messages.length;

  const session2 = await prisma.aiChatSession.create({
    data: {
      userId,
      title: 'Who are my top 5 debtors?',
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    },
  });
  aiSessionCount++;
  const s2Messages: Array<Prisma.AiChatMessageCreateManyInput> = [
    {
      tenantId: userId,
      sessionId: session2.id,
      role: 'USER',
      content: 'Who are my top 5 debtors?',
      createdAt: daysAgo(2),
    },
    {
      tenantId: userId,
      sessionId: session2.id,
      role: 'ASSISTANT',
      content: '',
      toolName: 'get_top_debtors',
      toolInput: { limit: 5 } as Prisma.InputJsonValue,
      createdAt: new Date(daysAgo(2).getTime() + 1000),
    },
    {
      tenantId: userId,
      sessionId: session2.id,
      role: 'TOOL',
      content: '',
      toolName: 'get_top_debtors',
      toolResult: {
        debtors: [
          { name: 'Acme Corp', outstanding: 85000 },
          { name: 'Globex Industries', outstanding: 62000 },
          { name: 'Initech Solutions', outstanding: 41000 },
          { name: 'Umbrella Retail', outstanding: 33500 },
          { name: 'Soylent Foods', outstanding: 23500 },
        ],
      } as Prisma.InputJsonValue,
      createdAt: new Date(daysAgo(2).getTime() + 2000),
    },
    {
      tenantId: userId,
      sessionId: session2.id,
      role: 'ASSISTANT',
      content:
        'Your top 5 debtors are: Acme Corp (₹85,000), Globex Industries (₹62,000), Initech Solutions (₹41,000), Umbrella Retail (₹33,500) and Soylent Foods (₹23,500).',
      costUsd: D(0.0047),
      createdAt: new Date(daysAgo(2).getTime() + 3000),
    },
  ];
  await prisma.aiChatMessage.createMany({ data: s2Messages });
  aiMessageCount += s2Messages.length;

  record('aiChatSessions', aiSessionCount);
  record('aiChatMessages', aiMessageCount);

  // -------------------------------------------------------------------------
  // Time Tracking (Phase 1) + Leaves/Holidays (Phase C)
  // -------------------------------------------------------------------------
  // Seeds employees (demo staff users), projects with billing rates, project
  // members, a recent week of timesheets/time-entries, company holidays, leave
  // types, allocations and leave requests so the Time-Tracking, Leaves and
  // Holidays modules + reports show populated data for QA/buyers.
  //
  // Fixed ids keep the section idempotent: the wipe() above removes everything
  // owned by the tenant (and the demo staff users), so this re-creates a clean,
  // deterministic dataset on every run.
  // -------------------------------------------------------------------------

  // --- Demo staff users (employees) ----------------------------------------
  // Tenant membership is resolved as `id == tenant OR ownerId == tenant` (see
  // projectMemberController.isTenantStaff), so each employee gets
  // `ownerId = userId` (the owner) and `user_type = 2` (staff).
  const staffPassword = await bcrypt.hash('Demo123$', 10);
  const employeeSpecs = [
    { id: 'demo-emp-1', firstName: 'Priya', lastName: 'Sharma', email: 'priya.sharma@demo.elixirbooks.local' },
    { id: 'demo-emp-2', firstName: 'Arjun', lastName: 'Patel', email: 'arjun.patel@demo.elixirbooks.local' },
    { id: 'demo-emp-3', firstName: 'Meera', lastName: 'Iyer', email: 'meera.iyer@demo.elixirbooks.local' },
  ];
  const employeeIds: string[] = [];
  for (const e of employeeSpecs) {
    const u = await prisma.user.create({
      data: {
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        password: staffPassword,
        user_type: 2,
        ownerId: userId,
        isDeleted: false,
      },
    });
    employeeIds.push(u.id);
  }
  record('employees', employeeIds.length);

  // --- Projects ------------------------------------------------------------
  // billingRate (tenant default), startDate/endDate, and a contactId linked to
  // a seeded demo client so the project carries a customer.
  const ttProjectSpecs = [
    {
      code: 'PRJ-001',
      name: 'Website Redesign',
      billingRate: 100,
      startDate: daysAgo(60),
      endDate: daysAgo(-30),
      contactId: customerContactIds[0] ?? null,
    },
    {
      code: 'PRJ-002',
      name: 'Mobile App Build',
      billingRate: 120,
      startDate: daysAgo(45),
      endDate: daysAgo(-60),
      contactId: customerContactIds[1] ?? customerContactIds[0] ?? null,
    },
  ];
  const ttProjects = [];
  for (const p of ttProjectSpecs) {
    const proj = await prisma.project.create({
      data: {
        userId,
        code: p.code,
        name: p.name,
        status: 'active',
        billingRate: D(p.billingRate),
        startDate: p.startDate,
        endDate: p.endDate,
        contactId: p.contactId,
      },
    });
    ttProjects.push(proj);
  }
  record('projects', ttProjects.length);

  // --- Project members -----------------------------------------------------
  // Priya manages both projects; Arjun + Meera are members. Per-member
  // billingRate overrides the project default where set.
  const memberRows: Prisma.ProjectMemberCreateManyInput[] = [
    // Website Redesign (PRJ-001)
    // The demo admin/owner is also a member+manager so their own My Timesheet
    // grid + Approvals are populated when logged in as admin@demo.
    { userId, projectId: ttProjects[0].id, employeeUserId: userId, role: 'MANAGER', billingRate: D(150) },
    { userId, projectId: ttProjects[0].id, employeeUserId: employeeIds[0], role: 'MANAGER', billingRate: D(140) },
    { userId, projectId: ttProjects[0].id, employeeUserId: employeeIds[1], role: 'MEMBER', billingRate: D(110) },
    { userId, projectId: ttProjects[0].id, employeeUserId: employeeIds[2], role: 'MEMBER', billingRate: D(95) },
    // Mobile App Build (PRJ-002)
    { userId, projectId: ttProjects[1].id, employeeUserId: employeeIds[0], role: 'MANAGER', billingRate: D(150) },
    { userId, projectId: ttProjects[1].id, employeeUserId: employeeIds[1], role: 'MEMBER', billingRate: D(120) },
  ];
  await prisma.projectMember.createMany({ data: memberRows });
  record('projectMembers', memberRows.length);

  // --- Timesheets + time entries -------------------------------------------
  // Use the most recent COMPLETED Monday (the start of last week) at UTC
  // midnight as the week start, so the week's weekdays are all in the past.
  const mondayUTC = ((): Date => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (dow + 6) % 7; // days since this week's Monday
    d.setUTCDate(d.getUTCDate() - diffToMonday - 7); // last week's Monday
    return d;
  })();
  /** Date at UTC midnight `offset` days after the week's Monday. */
  const weekDay = (offset: number): Date => {
    const d = new Date(mondayUTC);
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  };

  let timesheetCount = 0;
  let timeEntryCount = 0;

  // Timesheet 1 — Arjun, APPROVED (drives time report + reports). Mon–Fri,
  // mostly billable on both his projects.
  const ts1 = await prisma.timesheet.create({
    data: {
      userId,
      employeeUserId: employeeIds[1],
      weekStartDate: mondayUTC,
      status: 'APPROVED',
      submittedAt: weekDay(5),
      approvedById: userId,
      approvedAt: weekDay(5),
    },
  });
  timesheetCount += 1;
  const ts1Entries: Prisma.TimeEntryCreateManyInput[] = [
    { tenantId: userId, timesheetId: ts1.id, projectId: ttProjects[0].id, date: weekDay(0), hours: D(6), billable: true, note: 'Homepage layout' },
    { tenantId: userId, timesheetId: ts1.id, projectId: ttProjects[1].id, date: weekDay(0), hours: D(2), billable: true, note: 'API scoping' },
    { tenantId: userId, timesheetId: ts1.id, projectId: ttProjects[0].id, date: weekDay(1), hours: D(7.5), billable: true, note: 'Component build' },
    { tenantId: userId, timesheetId: ts1.id, projectId: ttProjects[0].id, date: weekDay(2), hours: D(8), billable: true, note: 'Responsive pass' },
    { tenantId: userId, timesheetId: ts1.id, projectId: ttProjects[1].id, date: weekDay(3), hours: D(6), billable: true, note: 'Auth flow' },
    { tenantId: userId, timesheetId: ts1.id, projectId: ttProjects[0].id, date: weekDay(3), hours: D(2), billable: false, note: 'Team sync' },
    { tenantId: userId, timesheetId: ts1.id, projectId: ttProjects[1].id, date: weekDay(4), hours: D(4), billable: true, note: 'Bug fixes' },
  ];
  await prisma.timeEntry.createMany({ data: ts1Entries });
  timeEntryCount += ts1Entries.length;

  // Timesheet 2 — Priya, SUBMITTED (pending approval, non-empty review queue).
  const ts2 = await prisma.timesheet.create({
    data: {
      userId,
      employeeUserId: employeeIds[0],
      weekStartDate: mondayUTC,
      status: 'SUBMITTED',
      submittedAt: weekDay(4),
    },
  });
  timesheetCount += 1;
  const ts2Entries: Prisma.TimeEntryCreateManyInput[] = [
    { tenantId: userId, timesheetId: ts2.id, projectId: ttProjects[0].id, date: weekDay(0), hours: D(4), billable: true, note: 'Design review' },
    { tenantId: userId, timesheetId: ts2.id, projectId: ttProjects[1].id, date: weekDay(1), hours: D(5), billable: true, note: 'Sprint planning' },
    { tenantId: userId, timesheetId: ts2.id, projectId: ttProjects[0].id, date: weekDay(2), hours: D(3), billable: false, note: 'Mentoring' },
    { tenantId: userId, timesheetId: ts2.id, projectId: ttProjects[1].id, date: weekDay(3), hours: D(5), billable: true, note: 'Client demo' },
  ];
  await prisma.timeEntry.createMany({ data: ts2Entries });
  timeEntryCount += ts2Entries.length;

  record('timesheets', timesheetCount);
  record('timeEntries', timeEntryCount);

  // --- Holidays (tenant-wide) ----------------------------------------------
  // Stored at UTC midnight (date-only). One recurring-yearly entry (New Year)
  // plus a few fixed-date holidays in the current year.
  const yr = new Date().getUTCFullYear();
  const utcDate = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));
  const holidayRows: Prisma.HolidayCreateManyInput[] = [
    { userId, name: "New Year's Day", date: utcDate(yr, 1, 1), recurringYearly: true },
    { userId, name: 'Republic Day', date: utcDate(yr, 1, 26), recurringYearly: false },
    { userId, name: 'Independence Day', date: utcDate(yr, 8, 15), recurringYearly: false },
    { userId, name: 'Diwali', date: utcDate(yr, 11, 9), recurringYearly: false },
  ];
  await prisma.holiday.createMany({ data: holidayRows });
  record('holidays', holidayRows.length);
  // `yyyy-MM-dd` holiday keys for buildLeaveDays (exclude holidays from leave).
  const holidayKeys = holidayRows.map((h) => (h.date as Date).toISOString().slice(0, 10));

  // --- Leave types ---------------------------------------------------------
  const annualLeave = await prisma.leaveType.create({
    data: { userId, name: 'Annual Leave', paid: true, defaultAllocationDays: D(20) },
  });
  const sickLeave = await prisma.leaveType.create({
    data: { userId, name: 'Sick Leave', paid: true, defaultAllocationDays: D(10) },
  });
  const unpaidLeave = await prisma.leaveType.create({
    data: { userId, name: 'Unpaid Leave', paid: false, defaultAllocationDays: null },
  });
  record('leaveTypes', 3);

  // --- Leave allocations (current year) ------------------------------------
  const allocRows: Prisma.LeaveAllocationCreateManyInput[] = [];
  for (const empId of [employeeIds[0], employeeIds[1], employeeIds[2]]) {
    allocRows.push(
      { userId, employeeUserId: empId, leaveTypeId: annualLeave.id, year: yr, allocatedDays: D(20), carriedOverDays: D(2) },
      { userId, employeeUserId: empId, leaveTypeId: sickLeave.id, year: yr, allocatedDays: D(10), carriedOverDays: D(0) },
    );
  }
  await prisma.leaveAllocation.createMany({ data: allocRows });
  record('leaveAllocations', allocRows.length);

  // --- Leave requests ------------------------------------------------------
  // Use buildLeaveDays (the shipped lib) to compute weekday-only LeaveRequestDay
  // rows + totalDays consistently (weekends + company holidays excluded).
  const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
  let leaveRequestCount = 0;
  let leaveRequestDayCount = 0;

  // Request 1 — Arjun, APPROVED Annual Leave (so balances show `used`).
  const lr1Start = weekDay(14); // a future-ish Monday relative to the seeded week
  const lr1End = weekDay(18); // that Friday
  const lr1 = buildLeaveDays(isoDate(lr1Start), isoDate(lr1End), { holidays: holidayKeys });
  const leaveReq1 = await prisma.leaveRequest.create({
    data: {
      userId,
      employeeUserId: employeeIds[1],
      leaveTypeId: annualLeave.id,
      startDate: lr1Start,
      endDate: lr1End,
      status: 'APPROVED',
      reason: 'Family vacation',
      totalDays: D(lr1.totalDays),
      approvedById: userId,
      approvedAt: weekDay(7),
      days: {
        create: lr1.days.map((d) => ({
          tenantId: userId,
          date: utcDate(
            Number(d.date.slice(0, 4)),
            Number(d.date.slice(5, 7)),
            Number(d.date.slice(8, 10)),
          ),
          portion: d.portion,
          portionDays: D(d.portionDays),
        })),
      },
    },
  });
  leaveRequestCount += 1;
  leaveRequestDayCount += lr1.days.length;
  void leaveReq1;

  // Request 2 — Meera, PENDING Sick Leave (keeps the approvals queue non-empty).
  const lr2Start = weekDay(21);
  const lr2End = weekDay(22);
  const lr2 = buildLeaveDays(isoDate(lr2Start), isoDate(lr2End), { holidays: holidayKeys });
  await prisma.leaveRequest.create({
    data: {
      userId,
      employeeUserId: employeeIds[2],
      leaveTypeId: sickLeave.id,
      startDate: lr2Start,
      endDate: lr2End,
      status: 'PENDING',
      reason: 'Medical appointment',
      totalDays: D(lr2.totalDays),
      days: {
        create: lr2.days.map((d) => ({
          tenantId: userId,
          date: utcDate(
            Number(d.date.slice(0, 4)),
            Number(d.date.slice(5, 7)),
            Number(d.date.slice(8, 10)),
          ),
          portion: d.portion,
          portionDays: D(d.portionDays),
        })),
      },
    },
  });
  leaveRequestCount += 1;
  leaveRequestDayCount += lr2.days.length;
  void unpaidLeave;

  record('leaveRequests', leaveRequestCount);
  record('leaveRequestDays', leaveRequestDayCount);

  // -------------------------------------------------------------------------
  // Transaction-category catalog — seed INLINE for the demo tenant so banking
  // explain/reconcile dropdowns are populated without relying on a reboot.
  // Runs AFTER applyPack (role mappings exist). Idempotent on (userId, code).
  // -------------------------------------------------------------------------
  const catResult = await seedTransactionCategoriesForUser(userId);
  record('transactionCategories', catResult.created + catResult.migrated);

  console.log('  ...seed complete');
}

// ===========================================================================
// Main
// ===========================================================================

async function main(): Promise<void> {
  const adminUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!adminUser) {
    throw new Error(
      `Demo admin user (${DEMO_EMAIL}) not found. Run \`npm run prisma:seed\` and \`npm run prisma:seed:demo\` first.`,
    );
  }

  const userId = adminUser.id;
  console.log(`Full demo seed for userId=${userId} (${DEMO_EMAIL})`);
  console.log('-'.repeat(60));

  await wipe(userId);
  await seedAll(userId);

  console.log('-'.repeat(60));
  console.log('Demo data summary:');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }
  console.log('-'.repeat(60));
  console.log(`Demo admin: ${DEMO_EMAIL} / Demo123$`);
  console.log('Login at:  http://localhost:8080/admin/login');
}

main()
  .catch((err) => {
    console.error('Full demo seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
