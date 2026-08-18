/**
 * Per-company Money In / Money Out category catalog seed + legacy migration.
 *
 * For each company owner whose ledger is initialized (i.e. has
 * `LedgerAccountMapping` rows), this upserts the section-9 catalog of
 * `TransactionCategory` rows from the Money In/Out explain-layer design,
 * mapping each friendly category to a real ledger `Account` resolved from the
 * owner's role mappings (PURCHASES, COGS, SALES_REVENUE, FIXED_ASSET, …) plus
 * a handful of extra accounts (Owner Loan, Share Capital, Dividends, Net
 * Salary & Payroll, Taxes) created on codes in the 9200+ range, deliberately
 * above every canonical country-pack code (which top out at 7000).
 *
 * It then migrates the legacy global `ExpenseCategory` table: for each
 * non-deleted category not already represented, a non-system
 * `TransactionCategory` is created (group ADMIN_EXPENSES → PURCHASES account).
 * `ExpenseCategory` is left untouched (read-only legacy table).
 *
 * Idempotent on `(userId, code)` for both system and legacy categories, so it
 * is safe to run on every container boot. Owners without a ledger mapping are
 * skipped (categories cannot be mapped to accounts that do not exist yet).
 *
 * `defaultTaxRateId` is left NULL — the explain form resolves AUTO via the tax
 * engine at explain time; we deliberately do not guess a rate here.
 *
 * Run standalone:  npx ts-node prisma/seedTransactionCategories.ts
 * Called from:     prisma/seed.ts main()
 */

import { PrismaClient, type CategoryGroup, type CategoryAppliesTo, type AccountType } from '@prisma/client';

// Self-contained client so the seeder doesn't depend on the hot-reload-cached
// shared client from lib/prisma (matches the other prisma/seed*.ts modules).
const prisma = new PrismaClient();

export interface SeedTransactionCategoriesResult {
  /** System catalog categories created across all owners in this run */
  created: number;
  /** Legacy ExpenseCategory rows migrated into TransactionCategory in this run */
  migrated: number;
}

/** Roles resolved from the owner's LedgerAccountMapping. */
type RoleKey = 'PURCHASES' | 'COGS' | 'SALES_REVENUE' | 'FIXED_ASSET' | 'OUTPUT_TAX';

/**
 * Extra accounts the catalog needs that are NOT part of the canonical country
 * pack role set. Codes are in the 9200+ range — deliberately above the
 * canonical pack ceiling of 7000 — to guarantee zero overlap with any
 * country-pack account (e.g. 3000 is the canonical Equity group header).
 */
const EXTRA_ACCOUNTS: { code: string; name: string; accountType: AccountType }[] = [
  { code: '9200', name: 'Owner Loan Account', accountType: 'LIABILITY' },
  { code: '9210', name: 'Share Capital', accountType: 'EQUITY' },
  { code: '9220', name: 'Dividends', accountType: 'EQUITY' },
  { code: '9230', name: 'Net Salary & Payroll', accountType: 'EXPENSE' },
  { code: '9240', name: 'Taxes', accountType: 'EXPENSE' },
  { code: '9250', name: 'Amounts Owed to Employees', accountType: 'LIABILITY' },
  { code: '9260', name: 'Net Wages Payable', accountType: 'LIABILITY' },
  { code: '9270', name: 'Payroll Deductions Payable', accountType: 'LIABILITY' },
];

/**
 * The section-9 catalog. `account` names a role (resolved from mappings) or one
 * of the EXTRA_ACCOUNTS codes (prefixed `code:`).
 */
interface CatalogEntry {
  code: string;
  name: string;
  group: CategoryGroup;
  appliesTo: CategoryAppliesTo;
  account: RoleKey | `code:${string}`;
  taxApplicable: boolean;
}

const CATALOG: CatalogEntry[] = [
  // --- ADMIN_EXPENSES → PURCHASES, MONEY_OUT, tax applicable ---
  ...adminExpenses([
    ['accommodation-meals', 'Accommodation & Meals'],
    ['accountancy-fees', 'Accountancy Fees'],
    ['advertising-promotion', 'Advertising and Promotion'],
    ['business-entertaining', 'Business Entertaining'],
    ['childcare-vouchers', 'Childcare Vouchers'],
    ['computer-hardware', 'Computer Hardware'],
    ['computer-software', 'Computer Software'],
    ['consultancy-fees', 'Consultancy Fees'],
    ['internet-telephone', 'Internet & Telephone'],
    ['leasing-payments', 'Leasing Payments'],
    ['legal-professional-fees', 'Legal and Professional Fees'],
    ['mobile-phone', 'Mobile Phone'],
    ['motor-expenses', 'Motor Expenses'],
    ['office-costs', 'Office Costs'],
    ['office-equipment', 'Office Equipment'],
    ['other-computer-costs', 'Other Computer Costs'],
    ['printing', 'Printing'],
    ['rent', 'Rent'],
    ['staff-entertaining', 'Staff Entertaining'],
    ['staff-training', 'Staff Training'],
    ['stationery', 'Stationery'],
    ['sundries', 'Sundries'],
    ['web-hosting', 'Web Hosting'],
  ]),
  // --- GENERAL_OVERHEADS → PURCHASES, MONEY_OUT, tax applicable ---
  ...generalOverheads([
    ['bank-finance-charges', 'Bank/Finance Charges'],
    ['books-journals', 'Books & Journals'],
    ['charitable-donations', 'Charitable Donations'],
    ['corporation-tax-penalty', 'Corporation Tax Penalty'],
    ['formation-costs', 'Formation Costs'],
    ['insurance', 'Insurance'],
    ['interest-payable', 'Interest Payable'],
    ['paye-ni-penalty', 'PAYE/NI Penalty'],
    ['pension-annuity', 'Pension (Annuity)'],
    ['pension-personal-stakeholder', 'Pension (Personal/Stakeholder)'],
    ['postage', 'Postage'],
    ['subscriptions', 'Subscriptions'],
    ['travel-overhead', 'Travel'], // kept as travel-overhead (not travel) because legacy code 'travel' is retired/soft-deleted; re-coding would need a data migration
    ['use-of-home', 'Use of Home'],
    ['vat-penalty', 'VAT Penalty'],
  ]),
  // --- COST_OF_SALES → COGS, MONEY_OUT, tax applicable ---
  ...costOfSales([
    ['commission-paid', 'Commission Paid'],
    ['cost-of-sales', 'Cost of Sales'],
    ['equipment-hire', 'Equipment Hire'],
    ['materials', 'Materials'],
    ['subcontractor-costs', 'Subcontractor Costs'],
  ]),
  // --- INCOME → SALES_REVENUE, MONEY_IN ---
  ...income([
    ['sales', 'Sales'],
    ['other-income', 'Other Income'],
    ['refunds-received', 'Refunds Received'],
    ['grant-income', 'Grant Income'],
  ]),
  // --- INCOME → SALES_REVENUE, MONEY_IN, tax NOT applicable ---
  ...incomeNoTax([
    ['receipt-initial-debtor', 'Receipt from Initial Debtor'],
    ['receipt-other-debtor', 'Receipt from Other Debtor'],
    ['receipt-contra-account', 'Receipt into Contra Account'],
    ['share-premium', 'Share Premium'],
    ['interest-received', 'Interest Received'],
    ['paye-ni-online-filing-incentive', 'PAYE/NI Online Filing Incentive Claimed'],
    ['realized-currency-exchange-gain', 'Realized Currency Exchange Gain'],
    ['refund-other-tax-received', 'Refund of Other Tax Received'],
  ]),
  // --- CAPITAL → FIXED_ASSET, MONEY_OUT, tax applicable ---
  {
    code: 'capital-asset-purchase',
    name: 'Capital Asset Purchase',
    group: 'CAPITAL',
    appliesTo: 'MONEY_OUT',
    account: 'FIXED_ASSET',
    taxApplicable: true,
  },
  // --- PAYROLL → Net Salary & Payroll (9230), MONEY_OUT, no tax ---
  ...payroll([
    ['net-salary-expense', 'Net Salary Expense'],
    ['paye-ni-expense', 'PAYE/NI Expense'],
  ]),
  // --- TAXES → Taxes (9240), MONEY_OUT, no tax ---
  ...taxes([
    ['corporation-tax', 'Corporation Tax'],
    ['paye-ni-tax', 'PAYE/NI'],
    ['vat', 'VAT'],
    ['vat-mini-one-stop-shop', 'VAT Mini One Stop Shop'],
  ]),
  // --- OWNER_FUNDS → loan/equity, MONEY_IN_USER, no tax ---
  {
    code: 'owner-loan-account',
    name: 'Owner Loan Account',
    group: 'OWNER_FUNDS',
    appliesTo: 'MONEY_IN_USER',
    account: 'code:9200',
    taxApplicable: false,
  },
  {
    code: 'unpaid-shares',
    name: 'Unpaid Shares',
    group: 'OWNER_FUNDS',
    appliesTo: 'MONEY_IN_USER',
    account: 'code:9210',
    taxApplicable: false,
  },
  {
    code: 'share-capital-introduced',
    name: 'Share Capital Introduced',
    group: 'OWNER_FUNDS',
    appliesTo: 'MONEY_IN_USER',
    account: 'code:9210',
    taxApplicable: false,
  },
  // --- USER_PAYMENTS → payroll/dividend/loan, MONEY_OUT_USER, no tax ---
  {
    code: 'net-salary-bonuses',
    name: 'Net Salary & Bonuses',
    group: 'USER_PAYMENTS',
    appliesTo: 'MONEY_OUT_USER',
    account: 'code:9230',
    taxApplicable: false,
  },
  {
    code: 'benefit-in-kind',
    name: 'Benefit in Kind',
    group: 'USER_PAYMENTS',
    appliesTo: 'MONEY_OUT_USER',
    account: 'code:9230',
    taxApplicable: false,
  },
  {
    code: 'expense-payment',
    name: 'Expense Payment',
    group: 'USER_PAYMENTS',
    appliesTo: 'MONEY_OUT_USER',
    account: 'code:9230',
    taxApplicable: false,
  },
  {
    code: 'dividend',
    name: 'Dividend',
    group: 'USER_PAYMENTS',
    appliesTo: 'MONEY_OUT_USER',
    account: 'code:9220',
    taxApplicable: false,
  },
  {
    code: 'owner-loan-repayment',
    name: 'Owner Loan Repayment',
    group: 'USER_PAYMENTS',
    appliesTo: 'MONEY_OUT_USER',
    account: 'code:9200',
    taxApplicable: false,
  },
];

function adminExpenses(rows: [string, string][]): CatalogEntry[] {
  return rows.map(([code, name]) => ({
    code, name, group: 'ADMIN_EXPENSES', appliesTo: 'MONEY_OUT', account: 'PURCHASES', taxApplicable: true,
  }));
}
function generalOverheads(rows: [string, string][]): CatalogEntry[] {
  return rows.map(([code, name]) => ({
    code, name, group: 'GENERAL_OVERHEADS', appliesTo: 'MONEY_OUT', account: 'PURCHASES', taxApplicable: true,
  }));
}
function costOfSales(rows: [string, string][]): CatalogEntry[] {
  return rows.map(([code, name]) => ({
    code, name, group: 'COST_OF_SALES', appliesTo: 'MONEY_OUT', account: 'COGS', taxApplicable: true,
  }));
}
function income(rows: [string, string][]): CatalogEntry[] {
  return rows.map(([code, name]) => ({
    code, name, group: 'INCOME', appliesTo: 'MONEY_IN', account: 'SALES_REVENUE', taxApplicable: true,
  }));
}
function payroll(rows: [string, string][]): CatalogEntry[] {
  return rows.map(([code, name]) => ({
    code, name, group: 'PAYROLL', appliesTo: 'MONEY_OUT', account: 'code:9230', taxApplicable: false,
  }));
}
function taxes(rows: [string, string][]): CatalogEntry[] {
  return rows.map(([code, name]) => ({
    code, name, group: 'TAXES', appliesTo: 'MONEY_OUT', account: 'code:9240', taxApplicable: false,
  }));
}
function incomeNoTax(rows: [string, string][]): CatalogEntry[] {
  return rows.map(([code, name]) => ({
    code, name, group: 'INCOME', appliesTo: 'MONEY_IN', account: 'SALES_REVENUE', taxApplicable: false,
  }));
}

/** Slugify a legacy ExpenseCategory title for a stable, idempotent category code. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

/**
 * Find an Account by (userId, code), else create it. Returns the account id.
 *
 * Throws if an existing account's `accountType` does not match the expected
 * type — prevents silent mis-mapping where a canonical pack account at the
 * same code is silently returned instead of the intended extra account.
 */
async function ensureAccount(
  userId: string,
  code: string,
  name: string,
  accountType: AccountType,
  db: Pick<PrismaClient, 'account'> = prisma,
): Promise<string> {
  const existing = await db.account.findUnique({ where: { userId_code: { userId, code } } });
  if (existing) {
    if (existing.accountType !== accountType) {
      throw new Error(
        `ensureAccount conflict: account code ${code} for user ${userId} already exists ` +
        `with accountType ${existing.accountType} but expected ${accountType}. ` +
        `This indicates a code collision with a canonical pack account — use a different code.`,
      );
    }
    return existing.id;
  }
  const created = await db.account.create({
    data: { userId, code, name, accountType },
  });
  return created.id;
}

/**
 * Seed the Money In/Out category catalog (+ legacy migration) for a SINGLE
 * owner whose ledger is initialized. Idempotent on `(userId, code)` — safe to
 * call inline right after ledger init / applyPack succeeds, and safe to re-run.
 *
 * Returns counts for this owner. If the owner's ledger is not fully
 * initialized (a core role mapping is missing) it is a no-op (returns zeros).
 *
 * Accepts an optional Prisma-like client so it can run inside a caller's
 * transaction; defaults to this module's own client.
 */
export async function seedTransactionCategoriesForUser(
  userId: string,
  db: Pick<PrismaClient, 'ledgerAccountMapping' | 'account' | 'transactionCategory' | 'expenseCategory'> = prisma,
): Promise<SeedTransactionCategoriesResult> {
  let created = 0;
  let migrated = 0;

  // 1. Resolve role → accountId from this owner's mappings.
  const mappings = await db.ledgerAccountMapping.findMany({
    where: { userId, roleKey: { in: ['PURCHASES', 'COGS', 'SALES_REVENUE', 'FIXED_ASSET', 'OUTPUT_TAX'] } },
    select: { roleKey: true, accountId: true },
  });
  const roleToAccount = new Map<string, string>(mappings.map((m) => [m.roleKey, m.accountId]));

  // Required roles for the catalog. If a core role is missing the ledger is
  // not fully initialized for this owner — skip it (data-setup concern).
  const required: RoleKey[] = ['PURCHASES', 'COGS', 'SALES_REVENUE', 'FIXED_ASSET'];
  if (required.some((r) => !roleToAccount.has(r))) return { created: 0, migrated: 0 };

  // 2. Ensure the extra (non-pack) accounts exist; build a code → id map.
  const codeToAccount = new Map<string, string>();
  for (const a of EXTRA_ACCOUNTS) {
    codeToAccount.set(a.code, await ensureAccount(userId, a.code, a.name, a.accountType, db));
  }

  const resolve = (account: CatalogEntry['account']): string | undefined => {
    if (account.startsWith('code:')) return codeToAccount.get(account.slice('code:'.length));
    return roleToAccount.get(account);
  };

  // 3. Upsert the system catalog (idempotent on (userId, code)).
  for (const entry of CATALOG) {
    const accountId = resolve(entry.account);
    if (!accountId) continue; // should not happen for required roles
    const existing = await db.transactionCategory.findUnique({
      where: { userId_code: { userId, code: entry.code } },
    });
    if (existing) continue;
    await db.transactionCategory.create({
      data: {
        userId,
        code: entry.code,
        name: entry.name,
        group: entry.group,
        appliesTo: entry.appliesTo,
        accountId,
        defaultTaxRateId: null,
        taxApplicable: entry.taxApplicable,
        isSystem: true,
      },
    });
    created += 1;
  }

  // 4. Migrate legacy ExpenseCategory rows (global, non-deleted) for this
  //    owner. Each becomes a non-system ADMIN_EXPENSES → PURCHASES category.
  const purchasesAccountId = roleToAccount.get('PURCHASES')!;
  const legacy = await db.expenseCategory.findMany({
    where: { isDeleted: false },
    select: { title: true },
  });
  for (const cat of legacy) {
    const code = `legacy-${slug(cat.title)}`;
    const existing = await db.transactionCategory.findUnique({
      where: { userId_code: { userId, code } },
    });
    if (existing) continue;
    await db.transactionCategory.create({
      data: {
        userId,
        code,
        name: cat.title,
        group: 'ADMIN_EXPENSES',
        appliesTo: 'MONEY_OUT',
        accountId: purchasesAccountId,
        defaultTaxRateId: null,
        taxApplicable: true,
        isSystem: false,
      },
    });
    migrated += 1;
  }

  return { created, migrated };
}

export async function seedTransactionCategories(): Promise<SeedTransactionCategoriesResult> {
  let created = 0;
  let migrated = 0;

  // Distinct owners that have a ledger initialized (≥1 role mapping).
  const ownerRows = await prisma.ledgerAccountMapping.findMany({
    distinct: ['userId'],
    select: { userId: true },
  });

  for (const { userId } of ownerRows) {
    const r = await seedTransactionCategoriesForUser(userId);
    created += r.created;
    migrated += r.migrated;
  }

  // Soft-delete superseded legacy duplicate categories that were present before
  // the full catalog was introduced. These are safe to retire because zero
  // BankTransaction rows reference any TransactionCategory (verified). The
  // newer breakdown entries (e.g. "Net Salary Expense") supersede these.
  // updateMany is naturally idempotent — re-runs are safe.
  const SUPERSEDED_LEGACY_CODES = [
    'net-salary',           // superseded by net-salary-expense
    'payroll-tax',          // superseded by payroll-tax-expense
    'corporation-income-tax', // superseded by corporation-tax
    'vat-gst-control',      // superseded by vat
    'travel',               // straggler duplicate; Travel lives under GENERAL_OVERHEADS as travel-overhead
    'payroll-tax-expense',  // straggler; PAYROLL spec is net-salary-expense + paye-ni-expense only
  ];
  await prisma.transactionCategory.updateMany({
    where: { code: { in: SUPERSEDED_LEGACY_CODES }, isDeleted: false },
    data: { isDeleted: true },
  });

  return { created, migrated };
}

if (require.main === module) {
  seedTransactionCategories()
    .then((r) => {
      console.log(`Transaction categories seeded (created ${r.created}, migrated ${r.migrated}).`);
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error('seedTransactionCategories error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
