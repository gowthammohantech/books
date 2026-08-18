// lib/moneyFlow/explainPosting.spec.ts
// Integration test for the explain → post / unexplain service.
//
// Uses an in-memory fake Prisma (the ledger harness primitives for the
// journal/mapping/period/settings, plus simple stores for bankTransaction,
// transactionCategory, expense, bankDetail and paymentMode) so the real
// posting wrappers run end-to-end with no live DB.

import { describe, it, expect, vi } from 'vitest';
import { getPack } from '../ledger/packs/index';
import { USER_PAYMENT_REASONS } from './types';

// ---------------------------------------------------------------------------
// In-memory store + fake Prisma, shared with the module under test via vi.mock
// ---------------------------------------------------------------------------

interface StoredLine {
  accountId: string; debit: string; credit: string;
  baseDebit: string; baseCredit: string;
  currencyCode: string | null; exchangeRate: string;
  taxRoleKey: string | null; description: string | null;
}
interface StoredEntry {
  id: string; userId: string; entryDate: Date;
  sourceType: string | null; sourceId: string | null; event: string | null;
  isDeleted: boolean; reversedById: string | null; reversals: { id: string }[];
  lines: StoredLine[];
}

const USER = 'u-explain';
const pack = getPack('GB')!;

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v !== null && typeof v === 'object') continue; // ignore relational/operator filters
    if (row[k] !== v) return false;
  }
  return true;
}

function buildFakePrisma(opts?: { goLiveDate?: Date }) {
  const entries: StoredEntry[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  // role -> accountId (code) from the pack
  const roleToId: Record<string, string> = {};
  for (const [role, code] of Object.entries(pack.roleMap)) roleToId[role] = code;

  const accounts: Record<string, { id: string; userId: string; code: string; accountType: string; isDeleted?: boolean }> = {};
  const banks: Record<string, { id: string; userId: string; currencyCode: string | null; currentBalance: string; accountId?: string | null }> = {};
  const bankTxns: Record<string, Record<string, unknown>> = {};
  const categories: Record<string, Record<string, unknown>> = {};
  const taxRates: Record<string, { id: string; name: string; taxKind: string | null; rate: string }> = {};
  const expenses: Record<string, Record<string, unknown>> = {};
  const fixedAssets: Record<string, Record<string, unknown>> = {};
  const paymentModes: Record<string, { id: string; slug: string }> = {};
  const invoices: Record<string, Record<string, unknown>> = {};
  const invoicePayments: Record<string, Record<string, unknown>> = {};
  const purchases: Record<string, Record<string, unknown>> = {};
  const supplierPayments: Record<string, Record<string, unknown>> = {};
  const creditNotes: Record<string, Record<string, unknown>> = {};

  const journalEntry = {
    async findFirst(args: unknown): Promise<StoredEntry | null> {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      const inc = (args as { include?: { lines?: boolean; reversals?: boolean } }).include;
      const found = entries.find((e) => {
        if ('id' in w && e.id !== w['id']) return false;
        if ('userId' in w && e.userId !== w['userId']) return false;
        if ('sourceType' in w && e.sourceType !== w['sourceType']) return false;
        if ('sourceId' in w && e.sourceId !== w['sourceId']) return false;
        if ('event' in w && e.event !== w['event']) return false;
        if ('isDeleted' in w && e.isDeleted !== w['isDeleted']) return false;
        return true;
      }) ?? null;
      void inc;
      return found;
    },
    async create(args: { data: unknown }): Promise<{ id: string }> {
      const d = args.data as {
        userId: string; entryDate: Date;
        sourceType?: string | null; sourceId?: string | null; event?: string | null;
        reversedById?: string | null; lines?: { create: StoredLine[] };
      };
      // Enforce the real DB unique constraint @@unique([userId, sourceType,
      // sourceId, event]) — it does NOT include isDeleted, so a soft-deleted row
      // with the same triple still occupies the slot (throws P2002). This is what
      // makes the re-explain test a real guard against the no-op bug.
      const collision = entries.find(
        (e) => e.userId === d.userId && e.sourceType === (d.sourceType ?? null)
          && e.sourceId === (d.sourceId ?? null) && e.event === (d.event ?? null),
      );
      if (collision) {
        const err = new Error('Unique constraint failed') as Error & { code?: string };
        err.code = 'P2002';
        throw err;
      }
      const id = nextId('je');
      const entry: StoredEntry = {
        id, userId: d.userId, entryDate: d.entryDate,
        sourceType: d.sourceType ?? null, sourceId: d.sourceId ?? null, event: d.event ?? null,
        isDeleted: false, reversedById: d.reversedById ?? null, reversals: [],
        lines: d.lines?.create ?? [],
      };
      if (d.reversedById) {
        const original = entries.find((e) => e.id === d.reversedById);
        if (original) original.reversals.push({ id });
      }
      entries.push(entry);
      return { id };
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }> {
      const row = entries.find((e) => e.id === args.where.id);
      if (row) Object.assign(row, args.data);
      return { id: args.where.id };
    },
  };

  const ledgerAccountMapping = {
    async findMany(): Promise<{ roleKey: string; accountId: string }[]> {
      return Object.entries(roleToId).map(([roleKey, accountId]) => ({ roleKey, accountId }));
    },
    async findFirst(args: unknown): Promise<{ accountId: string } | null> {
      const w = (args as { where?: { roleKey?: string } }).where ?? {};
      const accountId = w.roleKey ? roleToId[w.roleKey] : undefined;
      return accountId ? { accountId } : null;
    },
  };

  const accountingPeriod = { async findFirst(): Promise<null> { return null; } };
  const companySettings = {
    async findFirst(): Promise<{ ledgerInitialized: boolean; goLiveDate: Date | null }> {
      return { ledgerInitialized: true, goLiveDate: opts?.goLiveDate ?? new Date('2000-01-01') };
    },
  };

  const bankDetail = {
    async findUnique(args: { where: { id: string } }) { return banks[args.where.id] ?? null; },
  };
  const bankTransaction = {
    async findUnique(args: { where: { id: string } }) { return bankTxns[args.where.id] ?? null; },
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(bankTxns).find((r) => matchWhere(r, w)) ?? null;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = bankTxns[args.where.id];
      Object.assign(row, args.data);
      return row;
    },
  };
  const transactionCategory = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(categories).find((r) => matchWhere(r, w)) ?? null;
    },
    async findUnique(args: { where: { id: string } }) { return categories[args.where.id] ?? null; },
  };
  const taxRate = {
    async findUnique(args: { where: { id: string } }) { return taxRates[args.where.id] ?? null; },
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(taxRates).find((r) => matchWhere(r as Record<string, unknown>, w)) ?? null;
    },
  };
  const expense = {
    async create(args: { data: Record<string, unknown> }) {
      const id = nextId('exp');
      const row = { id, isDeleted: false, ...args.data };
      expenses[id] = row;
      return row;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = expenses[args.where.id];
      Object.assign(row, args.data);
      return row;
    },
    async findUnique(args: { where: { id: string } }) { return expenses[args.where.id] ?? null; },
  };
  const account = {
    async findFirst(args: { where: { userId: string; code: string; isDeleted: boolean } }) {
      const { userId, code, isDeleted } = args.where;
      return Object.values(accounts).find(
        (a) => a.userId === userId && a.code === code && (a.isDeleted ?? false) === isDeleted,
      ) ?? null;
    },
  };
  const paymentMode = {
    async findUnique(args: { where: { id: string } }) { return paymentModes[args.where.id] ?? null; },
  };
  const invoice = {
    async findFirst(args: { where: Record<string, unknown> }) {
      const w = args.where;
      return Object.values(invoices).find((r) => {
        if (w['id'] !== undefined && r['id'] !== w['id']) return false;
        if (w['userId'] !== undefined && r['userId'] !== w['userId']) return false;
        if (w['isDeleted'] !== undefined && r['isDeleted'] !== w['isDeleted']) return false;
        return true;
      }) ?? null;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = invoices[args.where.id];
      if (row) Object.assign(row, args.data);
      return row ?? null;
    },
  };
  const invoicePayment = {
    async findUnique(args: { where: { id: string } }) { return invoicePayments[args.where.id] ?? null; },
    async aggregate(args: { where: { invoiceId: string; isVoided: boolean }; _sum: { amount: true } }) {
      const sum = Object.values(invoicePayments)
        .filter((r) => r['invoiceId'] === args.where.invoiceId && r['isVoided'] === args.where.isVoided)
        .reduce((acc, r) => acc + Number(r['amount']), 0);
      return { _sum: { amount: sum } };
    },
    async create(args: { data: Record<string, unknown> }) {
      const id = nextId('ip');
      const row = { id, isVoided: false, ...args.data };
      invoicePayments[id] = row;
      return { id };
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = invoicePayments[args.where.id];
      if (row) Object.assign(row, args.data);
      return row ?? null;
    },
  };
  const fixedAsset = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(fixedAssets).find((r) => matchWhere(r, w)) ?? null;
    },
    async findUnique(args: { where: { id: string } }) { return fixedAssets[args.where.id] ?? null; },
    async create(args: { data: Record<string, unknown> }) {
      const id = nextId('fa');
      const row = { id, ...args.data };
      fixedAssets[id] = row;
      return { id };
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = fixedAssets[args.where.id];
      if (row) Object.assign(row, args.data);
      return row;
    },
  };

  const purchase = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(purchases).find((r) => matchWhere(r, w)) ?? null;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = purchases[args.where.id];
      if (row) Object.assign(row, args.data);
      return row ?? null;
    },
  };
  const supplierPayment = {
    async findUnique(args: { where: { id: string } }) { return supplierPayments[args.where.id] ?? null; },
    async findFirst(args: { where: { paymentId: { not: null } }; orderBy: { createdAt: 'desc' }; select: { paymentId: true } }) {
      void args;
      // Return the most recently created SP that has a non-null paymentId.
      const withPaymentId = Object.values(supplierPayments)
        .filter((r) => r['paymentId'] != null)
        .sort((a, b) => String(b['createdAt'] ?? '').localeCompare(String(a['createdAt'] ?? '')));
      if (withPaymentId.length === 0) return null;
      return { paymentId: withPaymentId[0]['paymentId'] as string };
    },
    async aggregate(args: { where: { purchaseId: string; isVoided: boolean; isDeleted: boolean }; _sum: { amount: true } }) {
      const sum = Object.values(supplierPayments)
        .filter((r) => r['purchaseId'] === args.where.purchaseId && r['isVoided'] === args.where.isVoided && (r['isDeleted'] ?? false) === args.where.isDeleted)
        .reduce((acc, r) => acc + Number(r['amount']), 0);
      return { _sum: { amount: sum } };
    },
    async create(args: { data: Record<string, unknown> }) {
      const id = nextId('sp');
      const row = { id, isVoided: false, isDeleted: false, createdAt: new Date().toISOString(), ...args.data };
      supplierPayments[id] = row;
      return { id };
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = supplierPayments[args.where.id];
      if (row) Object.assign(row, args.data);
      return row ?? null;
    },
  };
  const creditNote = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(creditNotes).find((r) => matchWhere(r, w)) ?? null;
    },
    async findMany(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(creditNotes).filter((r) => matchWhere(r, w));
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = creditNotes[args.where.id];
      if (row) Object.assign(row, args.data);
      return row ?? null;
    },
  };

  const client: Record<string, unknown> = {
    journalEntry, ledgerAccountMapping, accountingPeriod, companySettings,
    bankDetail, bankTransaction, transactionCategory, taxRate, expense, paymentMode, fixedAsset,
    invoice, invoicePayment, account, purchase, supplierPayment, creditNote,
  };
  client.$transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client);

  return {
    prisma: client,
    state: { entries, banks, bankTxns, categories, taxRates, expenses, fixedAssets, paymentModes, invoices, invoicePayments, accounts, purchases, supplierPayments, creditNotes },
  };
}

// vi.mock factory cannot reference outer non-hoisted vars, so build inside hoisted block.
const { fake } = vi.hoisted(() => ({ fake: { current: null as ReturnType<typeof buildFakePrisma> | null } }));

vi.mock('../prisma', () => ({
  get prisma() { return fake.current!.prisma; },
}));

// Import AFTER the mock is registered.
import { explainAndPost, unexplain } from './explainPosting';

function seed(opts?: { goLiveDate?: Date }) {
  const built = buildFakePrisma(opts);
  fake.current = built;
  const { state } = built;

  state.banks['bank-1'] = { id: 'bank-1', userId: USER, currencyCode: 'GBP', currentBalance: '1000' };

  // A MONEY_OUT expense category mapped to a real expense account in the pack.
  const expenseAccountId = pack.roleMap.PURCHASES;
  state.categories['cat-pay'] = {
    id: 'cat-pay', userId: USER, code: 'OFFICE_COSTS', name: 'Office Costs',
    group: 'ADMIN_EXPENSES', appliesTo: 'MONEY_OUT', accountId: expenseAccountId,
    defaultTaxRateId: null, taxApplicable: true, isSystem: true, status: true, isDeleted: false,
  };

  // An owner-funds / equity category for an owner_funds round-trip (Dr Bank / Cr equity).
  state.categories['cat-equity'] = {
    id: 'cat-equity', userId: USER, code: 'OWNERS_EQUITY', name: "Owner's Equity",
    group: 'EQUITY', appliesTo: 'MONEY_IN', accountId: pack.roleMap.RETAINED_EARNINGS,
    defaultTaxRateId: null, taxApplicable: false, isSystem: true, status: true, isDeleted: false,
  };

  state.bankTxns['btx-1'] = {
    id: 'btx-1', bankAccountId: 'bank-1', type: 'WITHDRAWAL',
    amount: '120', transactionDate: new Date('2026-06-01'),
    explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
    isReconciled: false, postedSourceType: null, postedSourceId: null,
    categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
    // Simulate a row posted by the AUTO-POST tier so unexplain can clear the marker.
    autoPosted: true,
  };

  // A payment mode for the invoice_link tests.
  state.paymentModes['pm-bank'] = { id: 'pm-bank', slug: 'bank_transfer' };

  // A money-IN deposit for the owner_funds + invoice_link round-trips.
  state.bankTxns['btx-in'] = {
    id: 'btx-in', bankAccountId: 'bank-1', type: 'DEPOSIT',
    amount: '500', transactionDate: new Date('2026-06-02'),
    explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
    isReconciled: false, postedSourceType: null, postedSourceId: null,
    categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
    paymentModeId: 'pm-bank',
  };

  // An open invoice for the invoice_link tests.
  state.invoices['inv-1'] = {
    id: 'inv-1', userId: USER, TotalAmount: '500', status: 'UNPAID', isDeleted: false, exchangeRate: null,
  };

  state.fixedAssets['fa-1'] = {
    id: 'fa-1', userId: USER, name: 'Old server',
    cost: '1000', accumulatedDepreciation: '600', status: 'active', isDeleted: false,
  };

  // A capital-asset category (MONEY_OUT, mapped to a fixed-asset account in the pack).
  const fixedAssetAccountId = pack.roleMap.FIXED_ASSET ?? pack.roleMap.PURCHASES; // fallback to purchases if no FIXED_ASSET role
  state.categories['cat-asset'] = {
    id: 'cat-asset', userId: USER, code: 'FIXED_ASSETS', name: 'Fixed Assets',
    group: 'FIXED_ASSETS', appliesTo: 'MONEY_OUT', accountId: fixedAssetAccountId,
    defaultTaxRateId: null, taxApplicable: false, isSystem: true, status: true, isDeleted: false,
  };

  // A bank txn for capital asset purchase (MONEY_OUT, 1200 gross, no tax)
  state.bankTxns['btx-asset'] = {
    id: 'btx-asset', bankAccountId: 'bank-1', type: 'WITHDRAWAL',
    amount: '1200', transactionDate: new Date('2026-06-05'),
    explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
    isReconciled: false, postedSourceType: null, postedSourceId: null,
    categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
    createdAssetId: null,
    remarks: 'New server purchase',
  };

  // A purchase/bill for bill_link tests (GAP 3)
  state.purchases['bill-1'] = {
    id: 'bill-1', userId: USER, totalAmount: '500', paidAmount: '0', balanceAmount: '500',
    status: 'pending', supplierId: null, vendorId: null, billTo: null, isDeleted: false,
  };

  // A bank txn for bill payment (MONEY_OUT, 200 amount) — GAP 3
  state.bankTxns['btx-bill'] = {
    id: 'btx-bill', bankAccountId: 'bank-1', type: 'WITHDRAWAL',
    amount: '200', transactionDate: new Date('2026-06-10'),
    explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
    isReconciled: false, postedSourceType: null, postedSourceId: null,
    categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
    paymentModeId: 'pm-bank',
  };

  // A credit note for credit_note_link tests (GAP 3)
  state.creditNotes['cn-1'] = {
    id: 'cn-1', userId: USER, totalAmount: '150', status: 'PENDING', isDeleted: false,
  };

  // Seed the 4 EXTRA_ACCOUNTS for the test user (GAP 2)
  state.accounts['acct-9200'] = { id: 'acct-9200', userId: USER, code: '9200', accountType: 'LIABILITY' };
  state.accounts['acct-9210'] = { id: 'acct-9210', userId: USER, code: '9210', accountType: 'EQUITY' };
  state.accounts['acct-9220'] = { id: 'acct-9220', userId: USER, code: '9220', accountType: 'EQUITY' };
  state.accounts['acct-9230'] = { id: 'acct-9230', userId: USER, code: '9230', accountType: 'EXPENSE' };

  return built;
}

/**
 * Net (debits - credits) across all LIVE entries sharing a sourceType + sourceId.
 * Mirrors the real GL-balance queries, which aggregate journal lines filtered by
 * `journalEntry: { isDeleted: false }` — soft-deleted entries contribute zero.
 */
function netForSource(
  entries: { sourceType: string | null; sourceId: string | null; isDeleted?: boolean; lines: { debit: string; credit: string }[] }[],
  sourceType: string,
  sourceId: string,
): number {
  return entries
    .filter((e) => e.sourceType === sourceType && e.sourceId === sourceId && !e.isDeleted)
    .reduce((s, e) => {
      const d = e.lines.reduce((a, l) => a + Number(l.debit), 0);
      const c = e.lines.reduce((a, l) => a + Number(l.credit), 0);
      return s + (d - c);
    }, 0);
}

describe('explainAndPost — payment (generic_category)', () => {
  it('creates a balanced Expense posting and marks the bank txn EXPLAINED', async () => {
    const { state } = seed();

    const out = await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
      categoryId: 'cat-pay', explainedDescription: 'Stationery',
    });

    expect(out.bankTxnId).toBe('btx-1');
    expect(out.expenseId).toBeTruthy();

    // A journal entry for the created Expense exists and balances.
    const je = state.entries.find((e) => e.sourceType === 'Expense' && e.event === 'recorded');
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(120, 4);

    // Bank txn updated.
    const btx = state.bankTxns['btx-1'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.postedSourceType).toBe('Expense');
    expect(btx.postedSourceId).toBe(out.expenseId);
    expect(btx.isReconciled).toBe(true);
    expect(btx.categoryId).toBe('cat-pay');
  });

  it('A2: BANK leg posts to the bank sub-account when BankDetail.accountId is set', async () => {
    const { state } = seed();
    // Link the bank to its own GL sub-account (A1). The BANK credit leg must now
    // target this account id instead of the shared BANK role account.
    state.banks['bank-1'].accountId = 'bank-sub-acct';

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
      categoryId: 'cat-pay', explainedDescription: 'Stationery',
    });

    const je = state.entries.find((e) => e.sourceType === 'Expense' && e.event === 'recorded');
    expect(je).toBeTruthy();
    // Entry still balances (override changed only WHICH account names the bank leg).
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    // The credit leg (the bank leg) hits the sub-account, NOT the shared BANK role.
    const bankRoleId = pack.roleMap.BANK;
    const bankLeg = je!.lines.find((l) => Number(l.credit) > 0);
    expect(bankLeg!.accountId).toBe('bank-sub-acct');
    expect(bankLeg!.accountId).not.toBe(bankRoleId);
  });

  it('A2: null BankDetail.accountId falls back to the shared BANK role (no regression)', async () => {
    const { state } = seed();
    // accountId left unset (un-backfilled bank).
    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
      categoryId: 'cat-pay', explainedDescription: 'Stationery',
    });
    const je = state.entries.find((e) => e.sourceType === 'Expense' && e.event === 'recorded');
    const bankLeg = je!.lines.find((l) => Number(l.credit) > 0);
    expect(bankLeg!.accountId).toBe(pack.roleMap.BANK);
  });

  it('unexplain reverses the posting and resets status to UNEXPLAINED', async () => {
    const { state } = seed();

    const out = await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment', categoryId: 'cat-pay',
    });

    await unexplain({ bankTxnId: 'btx-1', userId: USER });

    // The forward Expense JE is soft-deleted (not reversed-and-left-live), so the
    // source contributes zero to balances and no lone reversal dangles.
    const fwd = state.entries.find(
      (e) => e.sourceType === 'Expense' && e.event!.startsWith('recorded') && e.reversedById === null,
    );
    expect(fwd).toBeTruthy();
    expect(fwd!.isDeleted).toBe(true);
    // No live Expense entry remains for this source.
    const liveExp = state.entries.filter((e) => e.sourceType === 'Expense' && !e.isDeleted);
    expect(liveExp.length).toBe(0);
    expect(netForSource(state.entries, 'Expense', out.expenseId!)).toBeCloseTo(0, 4);

    // The expense was soft-deleted.
    expect(state.expenses[out.expenseId!].isDeleted).toBe(true);

    const btx = state.bankTxns['btx-1'];
    expect(btx.explainStatus).toBe('UNEXPLAINED');
    expect(btx.postedSourceType).toBeNull();
    expect(btx.postedSourceId).toBeNull();
    expect(btx.isReconciled).toBe(false);
    // (e) AUTO-POST undo: the auto-posted marker is cleared back to false.
    expect(btx.autoPosted).toBe(false);

    // Linkage is CLEARED (stuck-green fix) — a stale pointer to the voided
    // artefact must not survive, and a non-MANUAL relatedType would otherwise
    // permanently lock the row read-only.
    const row = state.bankTxns['btx-1'];
    expect(row.relatedType).toBe('MANUAL');
    expect(row.relatedId).toBeNull();
    expect(row.isPaymentBorn).toBe(false);
    // selection fields still retained for prefill:
    expect(row.transactionTypeKey).toBe('payment');
    expect(row.categoryId).toBe('cat-pay');
  });
});

describe('explainAndPost — onPosted hook (approve path: atomic hint capture)', () => {
  it('runs onPosted inside the same transaction, after the EXPLAINED stamp', async () => {
    const { state } = seed();
    let sawStatus: unknown;
    let sawResult: { bankTxnId?: string; expenseId?: string } | undefined;

    const out = await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment', categoryId: 'cat-pay',
      onPosted: async (tx, result) => {
        // The hook sees the in-transaction state: the txn is already stamped
        // EXPLAINED and the result carries the freshly-created expense id.
        sawStatus = (state.bankTxns['btx-1'] as Record<string, unknown>).explainStatus;
        sawResult = result;
        // Mutate via the same tx client to prove it's the live transaction client.
        await (tx as unknown as { bankTransaction: { update: (a: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> } })
          .bankTransaction.update({ where: { id: 'btx-1' }, data: { reconciliationNote: 'hook-ran' } });
      },
    });

    expect(sawStatus).toBe('EXPLAINED');
    expect(sawResult?.bankTxnId).toBe('btx-1');
    expect(sawResult?.expenseId).toBe(out.expenseId);
    expect((state.bankTxns['btx-1'] as Record<string, unknown>).reconciliationNote).toBe('hook-ran');
  });

  it('propagates an onPosted throw so the real $transaction aborts (atomicity)', async () => {
    seed();

    // A throw from the hook must propagate out of explainAndPost so the enclosing
    // prisma.$transaction rolls back the posting + stamp. On a real DB this undoes
    // the JE and the EXPLAINED stamp; here we assert the rejection is not swallowed.
    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment', categoryId: 'cat-pay',
        onPosted: async () => {
          throw new Error('hint failed');
        },
      }),
    ).rejects.toThrow('hint failed');
  });
});

describe('explainAndPost — validation', () => {
  it('throws 400 for an unknown transaction type', async () => {
    seed();
    await expect(
      explainAndPost({ bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'nope' }),
    ).rejects.toThrow();
  });

  it('throws 404 for a bank txn not owned by the user', async () => {
    seed();
    await expect(
      explainAndPost({ bankTxnId: 'btx-1', userId: 'someone-else', transactionTypeKey: 'payment', categoryId: 'cat-pay' }),
    ).rejects.toThrow();
  });

  it('throws 400 when a required category is missing', async () => {
    seed();
    await expect(
      explainAndPost({ bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment' }),
    ).rejects.toThrow();
  });
});

describe('explainAndPost — double-post guard (A2)', () => {
  it('refuses to re-explain a payment-born txn (isPaymentBorn=true) and posts no second Expense/JE', async () => {
    const { state } = seed();
    // Make btx-1 payment-born: already linked to an InvoicePayment (as A3 would stamp).
    // Payment-born rows carry BOTH the isPaymentBorn flag and the legacy relatedType.
    state.bankTxns['btx-1'].isPaymentBorn = true;
    state.bankTxns['btx-1'].relatedType = 'INVOICE_PAYMENT';
    state.bankTxns['btx-1'].relatedId = 'ip-existing';
    state.bankTxns['btx-1'].explainStatus = 'EXPLAINED';
    const entriesBefore = state.entries.length;
    const expensesBefore = Object.keys(state.expenses).length;

    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment', categoryId: 'cat-pay',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('created by its source payment'),
    });

    // No second sub-doc / JE was created — the core double-post invariant.
    expect(state.entries.length).toBe(entriesBefore);
    expect(Object.keys(state.expenses).length).toBe(expensesBefore);
    // Stays linked to its origin.
    expect(state.bankTxns['btx-1'].relatedType).toBe('INVOICE_PAYMENT');
    expect(state.bankTxns['btx-1'].postedSourceType).toBeNull();
  });

  it('idempotently flips a legacy payment-born UNEXPLAINED txn to EXPLAINED before refusing', async () => {
    const { state } = seed();
    // Legacy row: linked but never stamped EXPLAINED (pre-backfill state).
    state.bankTxns['btx-1'].isPaymentBorn = true;
    state.bankTxns['btx-1'].relatedType = 'SUPPLIER_PAYMENT';
    state.bankTxns['btx-1'].relatedId = 'sp-existing';
    state.bankTxns['btx-1'].explainStatus = 'UNEXPLAINED';

    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment', categoryId: 'cat-pay',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('created by its source payment'),
    });

    // The idempotent guard marked it EXPLAINED even though it then refused.
    expect(state.bankTxns['btx-1'].explainStatus).toBe('EXPLAINED');
    // isReconciled untouched (no JE posted here).
    expect(state.bankTxns['btx-1'].isReconciled).toBe(false);
  });
});

describe('explainAndPost — re-explain (edit an EXPLAINED row)', () => {
  it('voids the old posting and posts fresh entries in one call (net GL = new only)', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
      categoryId: 'cat-pay', explainedDescription: 'first pass',
    });
    const firstExpenseId = state.bankTxns['btx-1'].postedSourceId as string;

    // Re-explain directly — NO unexplain call in between.
    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
      categoryId: 'cat-pay', explainedDescription: 'second pass',
    });

    const row = state.bankTxns['btx-1'];
    expect(row.explainStatus).toBe('EXPLAINED');
    expect(row.explainedDescription).toBe('second pass');
    // DISCRIMINATING: zero LIVE journal entries remain for the FIRST posting.
    // (A tautological `netForSource(...) === 0` check would pass even if the old
    // entry were never voided, since a balanced JE always nets to zero for its
    // own source — this asserts the entry itself is gone from the live set.)
    const liveForFirst = state.entries.filter(
      (e) => e.sourceType === 'Expense' && e.sourceId === firstExpenseId && !e.isDeleted,
    );
    expect(liveForFirst.length).toBe(0);
    // DISCRIMINATING: the first Expense row itself is soft-deleted by the void.
    expect((state.expenses[firstExpenseId] as Record<string, unknown>).isDeleted).toBe(true);
    // New posting is live and keyed to the NEW postedSourceId.
    const secondExpenseId = row.postedSourceId as string;
    expect(secondExpenseId).not.toBe(firstExpenseId);
    const liveForSecond = state.entries.filter(
      (e) => e.sourceType === 'Expense' && e.sourceId === secondExpenseId && !e.isDeleted,
    );
    expect(liveForSecond.length).toBe(1);
  });

  it('still 409s for a payment-born row (isPaymentBorn=true), even with relatedType MANUAL', async () => {
    const { state } = seed();
    // relatedType stays MANUAL — proves the guard now keys on isPaymentBorn alone,
    // not on the old relatedType != MANUAL check (which would have let this row
    // through and double-posted).
    state.bankTxns['btx-1'].isPaymentBorn = true;
    state.bankTxns['btx-1'].relatedType = 'MANUAL';
    state.bankTxns['btx-1'].explainStatus = 'EXPLAINED';

    await expect(explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment', categoryId: 'cat-pay',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('re-explains an invoice_link (invoice_receipt) row DIRECTLY — no intervening unexplain() — without INVOICE_ALREADY_PAID', async () => {
    // Direct proof for the invoice_link fall-through path: the stuck-green bug rows
    // were exactly manual invoice_link explains. The existing no-op guard test
    // (~spec:850) chains through unexplain() in ITS OWN $transaction; this test
    // drives explainAndPost -> explainAndPost with NO intervening unexplain(), so
    // unexplainCore runs inside explainAndPost's single transaction and
    // applyInvoiceReceipt's "already PAID" check (applyInvoiceReceipt.ts:82) must
    // see the FRESH (voided) invoice state, not a stale pre-void read.
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt', invoiceId: 'inv-1',
    });
    expect(state.invoices['inv-1'].status).toBe('PAID');
    const firstPaymentId = state.bankTxns['btx-in'].postedSourceId as string;
    expect(firstPaymentId).toBeTruthy();

    // Re-explain directly — NO unexplain() call in between. Must NOT throw
    // INVOICE_ALREADY_PAID (that would mean applyInvoiceReceipt read the invoice
    // BEFORE unexplainCore's void reverted it to UNPAID within the same transaction).
    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt', invoiceId: 'inv-1',
    });

    // First InvoicePayment is voided.
    expect(state.invoicePayments[firstPaymentId].isVoided).toBe(true);

    // Exactly one non-voided InvoicePayment remains for inv-1, and it is the NEW one.
    const nonVoided = Object.values(state.invoicePayments).filter(
      (p) => p['invoiceId'] === 'inv-1' && p['isVoided'] === false,
    );
    expect(nonVoided.length).toBe(1);
    const secondPaymentId = nonVoided[0].id as string;
    expect(secondPaymentId).not.toBe(firstPaymentId);
    expect(state.bankTxns['btx-in'].postedSourceId).toBe(secondPaymentId);

    // Invoice status is PAID again.
    expect(state.invoices['inv-1'].status).toBe('PAID');

    // Zero live JEs keyed to the FIRST InvoicePayment id.
    const liveForFirst = state.entries.filter(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === firstPaymentId && !e.isDeleted,
    );
    expect(liveForFirst.length).toBe(0);
    // Exactly one live JE keyed to the SECOND InvoicePayment id.
    const liveForSecond = state.entries.filter(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === secondPaymentId && !e.isDeleted,
    );
    expect(liveForSecond.length).toBe(1);
  });
});

describe('explainAndPost — BankTxnExplain round-trip (owner_funds)', () => {
  it('explains to a balanced JE (BankTxnExplain/explained) and unexplain reverses it to zero', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'owner_loan_in',
      categoryId: 'cat-equity',
    });

    // The forward posting is keyed (BankTxnExplain, btx-in, explained) and balances.
    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-in' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(500, 4);

    await unexplain({ bankTxnId: 'btx-in', userId: USER });

    // The forward JE is soft-deleted (its event mangled to free the unique slot)
    // so the BankTxnExplain source nets to zero with no live entry remaining.
    expect(je!.isDeleted).toBe(true);
    expect(je!.event).toContain('voided');
    const liveJe = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-in' && e.event === 'explained' && !e.isDeleted,
    );
    expect(liveJe).toBeFalsy();
    expect(netForSource(state.entries, 'BankTxnExplain', 'btx-in')).toBeCloseTo(0, 4);

    const btx = state.bankTxns['btx-in'];
    expect(btx.explainStatus).toBe('UNEXPLAINED');
    expect(btx.postedSourceType).toBeNull();
    expect(btx.postedSourceId).toBeNull();
  });

  it('re-explain after unexplain posts a FRESH live forward JE (no-op bug guard)', async () => {
    const { state } = seed();

    // 1) explain
    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'owner_loan_in',
      categoryId: 'cat-equity',
    });
    // 2) unexplain
    await unexplain({ bankTxnId: 'btx-in', userId: USER });
    // After unexplain the source contributes ZERO.
    expect(netForSource(state.entries, 'BankTxnExplain', 'btx-in')).toBeCloseTo(0, 4);

    // 3) re-explain — must create a NEW live forward posting, not no-op.
    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'owner_loan_in',
      categoryId: 'cat-equity',
    });

    const liveFwd = state.entries.filter(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-in' && e.event === 'explained' && !e.isDeleted,
    );
    // Exactly ONE fresh live forward JE — proves re-explain did not no-op on the
    // stale (now soft-deleted) original.
    expect(liveFwd.length).toBe(1);
    // It is a brand-new entry (different id from the voided original) carrying the
    // real amount again (Dr Bank 500 / Cr equity 500 — a balanced entry nets to 0).
    const debits = liveFwd[0].lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = liveFwd[0].lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(500, 4);
    expect(credits).toBeCloseTo(500, 4);
    // The voided original is still present but soft-deleted (audit trail preserved).
    const voided = state.entries.filter(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-in' && e.isDeleted,
    );
    expect(voided.length).toBe(1);
    expect(state.bankTxns['btx-in'].explainStatus).toBe('EXPLAINED');
  });
});

describe('explainAndPost — invoice_link round-trip (guards Critical 1)', () => {
  it('posts an InvoicePayment (event payment) and unexplain reverses the SAME event to zero', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt',
      invoiceId: 'inv-1',
    });

    // InvoicePayment row must have been created.
    const payments = Object.values(state.invoicePayments);
    expect(payments.length).toBe(1);
    const invoicePaymentId = payments[0].id as string;

    // Forward payment posting: (InvoicePayment, <invoicePaymentId>, payment).
    const je = state.entries.find(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === invoicePaymentId && e.event === 'payment',
    );
    expect(je).toBeTruthy();
    expect(state.bankTxns['btx-in'].postedSourceType).toBe('InvoicePayment');
    // postedSourceId must be the InvoicePayment id (not the bank txn id).
    expect(state.bankTxns['btx-in'].postedSourceId).toBe(invoicePaymentId);

    await unexplain({ bankTxnId: 'btx-in', userId: USER });

    // The void must target event 'payment' (NOT 'explained') or it orphans the
    // posting. The forward JE is soft-deleted; the source nets to zero by removal.
    expect(je!.isDeleted).toBe(true);
    const liveInv = state.entries.find(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === invoicePaymentId && e.event === 'payment' && !e.isDeleted,
    );
    expect(liveInv).toBeFalsy();
    expect(netForSource(state.entries, 'InvoicePayment', invoicePaymentId)).toBeCloseTo(0, 4);

    // InvoicePayment must be marked voided.
    expect(state.invoicePayments[invoicePaymentId].isVoided).toBe(true);

    // Invoice status must be reverted to UNPAID.
    expect(state.invoices['inv-1'].status).toBe('UNPAID');

    expect(state.bankTxns['btx-in'].explainStatus).toBe('UNEXPLAINED');
  });

  it('re-explain after unexplain posts a FRESH live InvoicePayment JE (no-op bug guard)', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt', invoiceId: 'inv-1',
    });
    const firstPayments = Object.values(state.invoicePayments);
    const firstPaymentId = firstPayments[0].id as string;

    await unexplain({ bankTxnId: 'btx-in', userId: USER });
    expect(netForSource(state.entries, 'InvoicePayment', firstPaymentId)).toBeCloseTo(0, 4);
    // Invoice back to UNPAID after unexplain.
    expect(state.invoices['inv-1'].status).toBe('UNPAID');

    // Re-explain — a NEW InvoicePayment row + live payment posting must exist.
    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt', invoiceId: 'inv-1',
    });

    // Two InvoicePayment rows: first voided, second live.
    const allPayments = Object.values(state.invoicePayments);
    expect(allPayments.length).toBe(2);
    const secondPayment = allPayments.find((p) => p.id !== firstPaymentId)!;
    const secondPaymentId = secondPayment.id as string;
    expect(secondPayment.isVoided).toBe(false);

    const liveFwd = state.entries.filter(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === secondPaymentId && e.event === 'payment' && !e.isDeleted,
    );
    expect(liveFwd.length).toBe(1);
    // Dr Bank 500 / Cr AR 500 → assert a fresh live JE exists with the full amount on it.
    const debits = liveFwd[0].lines.reduce((s, l) => s + Number(l.debit), 0);
    expect(debits).toBeCloseTo(500, 4);
    expect(state.bankTxns['btx-in'].explainStatus).toBe('EXPLAINED');
    // Invoice back to PAID after re-explain.
    expect(state.invoices['inv-1'].status).toBe('PAID');
  });
});

describe('explainAndPost — invoice_receipt AR sub-ledger tie (GAP 1 fix)', () => {
  it('creates an InvoicePayment row and marks invoice PAID on full-amount explain', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt',
      invoiceId: 'inv-1',
    });

    // InvoicePayment row must exist.
    const payments = Object.values(state.invoicePayments);
    expect(payments.length).toBe(1);
    expect(Number(payments[0].amount)).toBeCloseTo(500, 4);
    expect(payments[0].isVoided).toBe(false);

    // Invoice status → PAID (btx-in amount 500 === TotalAmount 500).
    expect(state.invoices['inv-1'].status).toBe('PAID');

    // GL: InvoicePayment JE (Dr BANK 500, Cr AR 500) — balanced.
    const invoicePaymentId = payments[0].id as string;
    const je = state.entries.find(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === invoicePaymentId && e.event === 'payment',
    );
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(500, 4);

    // GL AR reduction must equal the invoice remaining-balance reduction.
    // Before explain: invoice remaining = 500. After: 0. AR credited = 500.
    const arAccountId = pack.roleMap.AR;
    const arCredit = je!.lines.filter((l) => l.accountId === arAccountId).reduce((s, l) => s + Number(l.credit), 0);
    expect(arCredit).toBeCloseTo(500, 4); // AR sub-ledger tied.

    // postedSourceId = InvoicePayment id (not bank txn id).
    expect(state.bankTxns['btx-in'].postedSourceId).toBe(invoicePaymentId);
    expect(state.bankTxns['btx-in'].postedSourceType).toBe('InvoicePayment');
  });

  it('finding 1 refix: explain-flow receipt leaves movedBankBalance FALSE, relabels the imported line, and never moves currentBalance', async () => {
    const { state } = seed();
    const balBefore = state.banks['bank-1'].currentBalance; // '1000' — imported deposit already baked in

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt',
      invoiceId: 'inv-1',
    });

    const payment = Object.values(state.invoicePayments)[0];
    const paymentId = payment.id as string;

    // WRITE side: the explain create path must NOT set movedBankBalance.
    expect(payment.movedBankBalance ?? false).toBe(false);

    // The PRE-EXISTING imported line was RELABELED to this payment — this is the
    // exact collision (relatedType/relatedId/postedSourceType) that defeated the
    // first fix's "does a bank line keyed to this payment exist?" discriminator.
    expect(state.bankTxns['btx-in'].relatedType).toBe('INVOICE_PAYMENT');
    expect(state.bankTxns['btx-in'].relatedId).toBe(paymentId);
    expect(state.bankTxns['btx-in'].postedSourceType).toBe('InvoicePayment');

    // The register was never moved by the explain create (harness bankDetail has
    // no update() — a move would have thrown). currentBalance is untouched.
    expect(state.banks['bank-1'].currentBalance).toBe(balBefore);
  });

  it('marks invoice PARTIALLY_PAID when explain amount < total', async () => {
    const { state } = seed();
    // Seed a partial txn with amount 200 < invoice total 500.
    state.bankTxns['btx-partial'] = {
      id: 'btx-partial', bankAccountId: 'bank-1', type: 'DEPOSIT',
      amount: '200', transactionDate: new Date('2026-06-01'),
      explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
      isReconciled: false, postedSourceType: null, postedSourceId: null,
      categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
      paymentModeId: 'pm-bank',
    };

    await explainAndPost({
      bankTxnId: 'btx-partial', userId: USER, transactionTypeKey: 'invoice_receipt',
      invoiceId: 'inv-1',
    });

    expect(state.invoices['inv-1'].status).toBe('PARTIALLY_PAID');
    const payments = Object.values(state.invoicePayments);
    expect(payments.length).toBe(1);
    expect(Number(payments[0].amount)).toBeCloseTo(200, 4);
  });

  it('rejects overpayment with a clear error', async () => {
    const { state } = seed();
    // Seed a txn with amount > invoice total (500).
    state.bankTxns['btx-over'] = {
      id: 'btx-over', bankAccountId: 'bank-1', type: 'DEPOSIT',
      amount: '600', transactionDate: new Date('2026-06-01'),
      explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
      isReconciled: false, postedSourceType: null, postedSourceId: null,
      categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
      paymentModeId: 'pm-bank',
    };

    await expect(
      explainAndPost({
        bankTxnId: 'btx-over', userId: USER, transactionTypeKey: 'invoice_receipt',
        invoiceId: 'inv-1',
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('exceeds') });

    // No InvoicePayment must have been created.
    expect(Object.values(state.invoicePayments).length).toBe(0);
    // Invoice status unchanged.
    expect(state.invoices['inv-1'].status).toBe('UNPAID');
  });

  it('unexplain voids the InvoicePayment and resets invoice status to UNPAID', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt',
      invoiceId: 'inv-1',
    });

    const payments = Object.values(state.invoicePayments);
    expect(payments.length).toBe(1);
    const invoicePaymentId = payments[0].id as string;

    // Invoice is PAID before unexplain.
    expect(state.invoices['inv-1'].status).toBe('PAID');

    await unexplain({ bankTxnId: 'btx-in', userId: USER });

    // InvoicePayment must be voided.
    expect(state.invoicePayments[invoicePaymentId].isVoided).toBe(true);

    // Invoice status reverts to UNPAID (no non-voided payments remain).
    expect(state.invoices['inv-1'].status).toBe('UNPAID');

    // GL JE for InvoicePayment must be soft-deleted (nets to zero).
    expect(netForSource(state.entries, 'InvoicePayment', invoicePaymentId)).toBeCloseTo(0, 4);

    // Bank txn is reset.
    const btx = state.bankTxns['btx-in'];
    expect(btx.explainStatus).toBe('UNEXPLAINED');
    expect(btx.postedSourceType).toBeNull();
    expect(btx.postedSourceId).toBeNull();

    // Linkage is CLEARED (stuck-green fix): the INVOICE_PAYMENT pointer that
    // used to lock this row read-only is reset to a plain manual row.
    expect(state.bankTxns['btx-in'].relatedType).toBe('MANUAL');
    expect(state.bankTxns['btx-in'].relatedId).toBeNull();
    expect(state.bankTxns['btx-in'].isPaymentBorn).toBe(false);
  });
});

describe('explainAndPost — bill_link round-trip (guards Critical 1)', () => {
  it('posts a SupplierPayment (event payment) keyed to SP id, and unexplain reverses the SAME event to zero', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-bill', userId: USER, transactionTypeKey: 'bill_payment',
      billId: 'bill-1',
    });

    // A SupplierPayment row was created, keyed to the purchase (not bankTxn id).
    const sp = Object.values(state.supplierPayments).find((s) => s['purchaseId'] === 'bill-1');
    expect(sp).toBeTruthy();
    const supplierPaymentId = (sp as { id: string }).id;

    // GL is keyed to the SupplierPayment id (NOT the bank txn id).
    const je = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === supplierPaymentId && e.event === 'payment',
    );
    expect(je).toBeTruthy();
    expect(state.bankTxns['btx-bill'].postedSourceType).toBe('SupplierPayment');
    expect(state.bankTxns['btx-bill'].postedSourceId).toBe(supplierPaymentId);

    await unexplain({ bankTxnId: 'btx-bill', userId: USER });

    // GL voided, SupplierPayment voided, source nets to zero.
    expect(je!.isDeleted).toBe(true);
    const liveSup = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === supplierPaymentId && e.event === 'payment' && !e.isDeleted,
    );
    expect(liveSup).toBeFalsy();
    expect(netForSource(state.entries, 'SupplierPayment', supplierPaymentId)).toBeCloseTo(0, 4);
    expect(sp!['isVoided']).toBe(true);
    expect(state.bankTxns['btx-bill'].explainStatus).toBe('UNEXPLAINED');
  });

  it('finding 1 refix: explain-flow bill payment leaves movedBankBalance FALSE, relabels the imported line, and never moves currentBalance', async () => {
    const { state } = seed();
    const balBefore = state.banks['bank-1'].currentBalance; // '1000'

    await explainAndPost({
      bankTxnId: 'btx-bill', userId: USER, transactionTypeKey: 'bill_payment',
      billId: 'bill-1',
    });

    const sp = Object.values(state.supplierPayments).find((s) => s['purchaseId'] === 'bill-1')!;

    // WRITE side: applyBillPayment sets sourceType='BANK' but must NOT set the flag.
    expect(sp['sourceType']).toBe('BANK');
    expect(sp['movedBankBalance'] ?? false).toBe(false);

    // The imported line was RELABELED to this payment (the first-fix collision).
    expect(state.bankTxns['btx-bill'].relatedType).toBe('SUPPLIER_PAYMENT');
    expect(state.bankTxns['btx-bill'].relatedId).toBe(sp['id']);
    expect(state.bankTxns['btx-bill'].postedSourceType).toBe('SupplierPayment');

    // Register never moved by the explain create.
    expect(state.banks['bank-1'].currentBalance).toBe(balBefore);
  });
});

describe('resolveTax — explicit unknown taxRateId', () => {
  it('throws 400 instead of silently posting zero tax', async () => {
    seed();
    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
        categoryId: 'cat-pay', taxTreatment: 'no-such-rate',
      }),
    ).rejects.toThrow(/Tax rate not found/);
  });
});

// ---------------------------------------------------------------------------
// New types: hp_payment + capital_asset_disposal
// ---------------------------------------------------------------------------

describe('explainAndPost — hp_payment (generic_category, MONEY_OUT)', () => {
  it('creates a balanced Expense posting via generic_category and marks the bank txn EXPLAINED', async () => {
    const { state } = seed();

    const out = await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'hp_payment',
      categoryId: 'cat-pay', explainedDescription: 'HP agreement quarterly payment',
    });

    expect(out.bankTxnId).toBe('btx-1');
    expect(out.expenseId).toBeTruthy();

    // A journal entry for the created Expense exists and balances (Dr expense / Cr bank).
    const je = state.entries.find((e) => e.sourceType === 'Expense' && e.event === 'recorded');
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(120, 4);

    const btx = state.bankTxns['btx-1'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.transactionTypeKey).toBe('hp_payment');
    expect(btx.postedSourceType).toBe('Expense');
    expect(btx.isReconciled).toBe(true);
  });

  it('unexplain reverses the hp_payment posting to zero', async () => {
    const { state } = seed();
    const out = await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'hp_payment', categoryId: 'cat-pay',
    });
    await unexplain({ bankTxnId: 'btx-1', userId: USER });

    const fwd = state.entries.find((e) => e.sourceType === 'Expense' && e.reversedById === null);
    expect(fwd).toBeTruthy();
    expect(fwd!.isDeleted).toBe(true);
    expect(netForSource(state.entries, 'Expense', out.expenseId!)).toBeCloseTo(0, 4);
    expect(state.bankTxns['btx-1'].explainStatus).toBe('UNEXPLAINED');
  });
});

describe('explainAndPost — capital_asset_disposal (asset_disposal, MONEY_IN)', () => {
  // Asset: cost=1000, accumulatedDepreciation=600, status='active'
  // Gross proceeds: 500, tax: 0
  // netProceeds = 500 - 0 = 500
  // NBV = 1000 - 600 = 400
  // Gain = netProceeds(500) - NBV(400) = 100
  // Lines: Dr BANK 500, Dr ACCUMULATED_DEPRECIATION 600, Cr FIXED_ASSET 1000, Cr GAIN_ON_DISPOSAL 100
  // Total debits = 1100, Total credits = 1100

  it('posts a balanced disposal entry and marks the asset disposed', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'capital_asset_disposal',
      assetId: 'fa-1',
    });

    // A disposal JE keyed (FixedAssetDisposal, fa-1, disposal) must exist and balance.
    const je = state.entries.find(
      (e) => e.sourceType === 'FixedAssetDisposal' && e.sourceId === 'fa-1' && e.event === 'disposal',
    );
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    // Dr BANK 500 + Dr ACCUMULATED_DEPRECIATION 600 = 1100
    expect(debits).toBeCloseTo(1100, 4);
    // Cr FIXED_ASSET 1000 + Cr GAIN_ON_DISPOSAL 100 = 1100
    expect(credits).toBeCloseTo(1100, 4);

    // Asset must be marked disposed with correct proceeds.
    expect(state.fixedAssets['fa-1'].status).toBe('disposed');
    // netProceeds = gross 500 - tax 0 = 500
    expect(String(state.fixedAssets['fa-1'].disposalProceeds)).toBe('500');

    // Bank txn stamped correctly.
    const btx = state.bankTxns['btx-in'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.transactionTypeKey).toBe('capital_asset_disposal');
    expect(btx.postedSourceType).toBe('FixedAssetDisposal');
    expect(btx.postedSourceId).toBe('fa-1');
    expect(btx.isReconciled).toBe(true);
  });

  it('unexplain reverses the disposal to zero and reactivates the asset', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'capital_asset_disposal',
      assetId: 'fa-1',
    });

    const je = state.entries.find(
      (e) => e.sourceType === 'FixedAssetDisposal' && e.sourceId === 'fa-1' && e.event === 'disposal',
    );
    expect(je).toBeTruthy();

    await unexplain({ bankTxnId: 'btx-in', userId: USER });

    // Forward JE soft-deleted; source nets to zero.
    expect(je!.isDeleted).toBe(true);
    expect(netForSource(state.entries, 'FixedAssetDisposal', 'fa-1')).toBeCloseTo(0, 4);

    // Asset reactivated, disposal fields cleared.
    expect(state.fixedAssets['fa-1'].status).toBe('active');
    expect(state.fixedAssets['fa-1'].disposalDate == null).toBe(true);
    expect(state.fixedAssets['fa-1'].disposalProceeds == null).toBe(true);

    // Bank txn reset.
    const btx = state.bankTxns['btx-in'];
    expect(btx.explainStatus).toBe('UNEXPLAINED');
    expect(btx.postedSourceType).toBeNull();
    expect(btx.postedSourceId).toBeNull();
  });

  it('throws when assetId is missing (no silent income fallback)', async () => {
    seed();
    await expect(
      explainAndPost({ bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'capital_asset_disposal' }),
    ).rejects.toThrow();
  });

  it('rejects disposing an already-disposed asset', async () => {
    const { state } = seed();
    state.fixedAssets['fa-1'].status = 'disposed';
    await expect(
      explainAndPost({ bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'capital_asset_disposal', assetId: 'fa-1' }),
    ).rejects.toThrow();
  });

  it('unexplain restores fully_depreciated status for a written-down asset', async () => {
    const { state } = seed();

    // Seed a fully-depreciated asset (accumulatedDepreciation === cost, salvageValue 0).
    state.fixedAssets['fa-fd'] = {
      id: 'fa-fd', userId: USER, name: 'Written-down rig',
      cost: '1000', accumulatedDepreciation: '1000', salvageValue: '0',
      status: 'fully_depreciated', isDeleted: false,
    };

    // Explain: disposal of fully-depreciated asset must succeed (FIX 2).
    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'capital_asset_disposal',
      assetId: 'fa-fd',
    });

    // Asset must be marked disposed.
    expect(state.fixedAssets['fa-fd'].status).toBe('disposed');

    // Unexplain: status must be restored to fully_depreciated, NOT 'active' (FIX 3).
    await unexplain({ bankTxnId: 'btx-in', userId: USER });

    expect(state.fixedAssets['fa-fd'].status).toBe('fully_depreciated');
    expect(state.fixedAssets['fa-fd'].disposalDate == null).toBe(true);
    expect(state.fixedAssets['fa-fd'].disposalProceeds == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Post-gate date-floor regression tests (GL tie-out critical)
// ---------------------------------------------------------------------------

describe('explainAndPost — post-gate date-floor and reconciliation defence', () => {
  /**
   * Scenario: goLiveDate has a daytime time component (e.g. set at 09:59:48 UTC).
   * The bank transaction is stored at midnight (00:00:00 UTC) for the SAME calendar
   * day. Without date-floor the timestamp comparison would block posting even though
   * the txn is on the go-live day — silently breaking GL tie-out.
   *
   * After the fix shouldPost uses UTC date-floor, so midnight txn on go-live day
   * DOES post, and the bank txn is marked isReconciled=true with a GL entry.
   */
  it('posts a JE and sets isReconciled=true when txn is at midnight on the go-live day (daytime goLiveDate)', async () => {
    // goLiveDate at 09:59:48 UTC on 2026-06-23.
    const goLive = new Date('2026-06-23T09:59:48Z');
    const { state } = seed({ goLiveDate: goLive });

    // Bank txn dated midnight UTC on the same calendar day.
    state.bankTxns['btx-1'].transactionDate = new Date('2026-06-23T00:00:00Z');

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
      categoryId: 'cat-pay', explainedDescription: 'Same-day go-live txn',
    });

    // A GL journal entry must exist for the Expense (posting was NOT gated out).
    const je = state.entries.find((e) => e.sourceType === 'Expense' && e.event === 'recorded');
    expect(je).toBeTruthy();

    // Bank txn must be reconciled with a posted source (GL entry exists).
    const btx = state.bankTxns['btx-1'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.isReconciled).toBe(true);
    expect(btx.postedSourceType).toBe('Expense');
    expect(btx.postedSourceId).toBeTruthy();
  });

  /**
   * Scenario: bank txn dated the day BEFORE go-live. Posting must be gated out
   * (no JE created). The bank txn must be EXPLAINED but NOT reconciled and must
   * NOT claim a posted source — otherwise GL tie-out silently breaks.
   */
  it('does NOT post a JE and leaves isReconciled=false for a pre-go-live txn', async () => {
    // goLiveDate: 2026-06-23 (any time). Txn date: 2026-06-22 midnight.
    const goLive = new Date('2026-06-23T09:59:48Z');
    const { state } = seed({ goLiveDate: goLive });

    // Bank txn dated one day before go-live.
    state.bankTxns['btx-1'].transactionDate = new Date('2026-06-22T00:00:00Z');

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'payment',
      categoryId: 'cat-pay', explainedDescription: 'Pre-go-live txn',
    });

    // No GL entry must have been created (posting was gated out).
    const je = state.entries.find((e) => e.sourceType === 'Expense' && e.event === 'recorded');
    expect(je).toBeFalsy();

    // Bank txn is EXPLAINED but NOT reconciled — no journal entry backs it.
    const btx = state.bankTxns['btx-1'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.isReconciled).toBe(false);
    expect(btx.postedSourceType).toBeNull();
    expect(btx.postedSourceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pre-go-live invoice_receipt linkage retention (Finding 1 fix)
// ---------------------------------------------------------------------------

describe('explainAndPost — pre-go-live invoice_receipt linkage retention', () => {
  /**
   * Scenario: the bank transaction date is before go-live, so the GL post is gated
   * out. The InvoicePayment sub-ledger row and invoice status update MUST still happen
   * (they are real documents, not just GL artefacts). Crucially, the bank txn must
   * retain postedSourceType/postedSourceId so that unexplain can find and void the
   * InvoicePayment even though no JE was posted.
   */
  it('pre-go-live invoice_receipt: creates InvoicePayment + linkage with NO JE, and unexplain still reverses it', async () => {
    // goLiveDate AFTER the txn date → GL post is gated out, but the InvoicePayment
    // sub-ledger row must still be created AND linked so unexplain can reverse it.
    const { state } = seed({ goLiveDate: new Date('2026-07-01T00:00:00Z') });

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'invoice_receipt',
      invoiceId: 'inv-1',
    });

    // InvoicePayment row created; invoice marked PAID.
    const payments = Object.values(state.invoicePayments);
    expect(payments.length).toBe(1);
    const invoicePaymentId = payments[0].id as string;
    expect(state.invoices['inv-1'].status).toBe('PAID');

    // NO GL JE was posted (gated out).
    const je = state.entries.find(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === invoicePaymentId && e.event === 'payment',
    );
    expect(je).toBeFalsy();

    // Bank txn is EXPLAINED but NOT reconciled — yet linkage is RETAINED so unexplain works.
    const btx = state.bankTxns['btx-in'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.isReconciled).toBe(false);
    expect(btx.postedSourceType).toBe('InvoicePayment');
    expect(btx.postedSourceId).toBe(invoicePaymentId);

    // Unexplain must void the orphan-free InvoicePayment + revert invoice to UNPAID.
    await unexplain({ bankTxnId: 'btx-in', userId: USER });
    expect(state.invoicePayments[invoicePaymentId].isVoided).toBe(true);
    expect(state.invoices['inv-1'].status).toBe('UNPAID');
    expect(state.bankTxns['btx-in'].postedSourceType).toBeNull();
    expect(state.bankTxns['btx-in'].postedSourceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAP 2: user payment reason routing
// ---------------------------------------------------------------------------

describe('explainAndPost — user payment reason routing (GAP 2)', () => {
  it('money_paid_to_user: dividend routes to 9220 EQUITY (Dr 9220 / Cr BANK), balanced', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
      payToUserId: 'user-x', reason: 'dividend',
    });

    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-1' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(120, 4);

    // Debit side must be the dividend account (9220)
    const debitLine = je!.lines.find((l) => Number(l.debit) > 0);
    expect(debitLine?.accountId).toBe('acct-9220');

    // userPaymentReason stored on the bank txn
    expect(state.bankTxns['btx-1'].userPaymentReason).toBe('dividend');
    expect(state.bankTxns['btx-1'].explainStatus).toBe('EXPLAINED');
  });

  it('money_paid_to_user: net_salary routes to 9230 EXPENSE (Dr 9230 / Cr BANK)', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
      payToUserId: 'user-x', reason: 'net_salary',
    });

    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-1' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const debitLine = je!.lines.find((l) => Number(l.debit) > 0);
    expect(debitLine?.accountId).toBe('acct-9230');
    expect(state.bankTxns['btx-1'].userPaymentReason).toBe('net_salary');
  });

  it('money_paid_to_user: director_loan_repayment routes to 9200 LIABILITY', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
      payToUserId: 'user-x', reason: 'director_loan_repayment',
    });

    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-1' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const debitLine = je!.lines.find((l) => Number(l.debit) > 0);
    expect(debitLine?.accountId).toBe('acct-9200');
    expect(state.bankTxns['btx-1'].userPaymentReason).toBe('director_loan_repayment');
  });

  it('money_received_from_user: director_loan routes to 9200 LIABILITY (Dr BANK / Cr 9200)', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'money_received_from_user',
      payToUserId: 'user-x', reason: 'director_loan',
    });

    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-in' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(500, 4);

    // Credit side must be the director loan account (9200)
    const creditLine = je!.lines.find((l) => Number(l.credit) > 0);
    expect(creditLine?.accountId).toBe('acct-9200');
    expect(state.bankTxns['btx-in'].userPaymentReason).toBe('director_loan');
  });

  it('money_received_from_user: share_capital_introduced routes to 9210 EQUITY', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-in', userId: USER, transactionTypeKey: 'money_received_from_user',
      payToUserId: 'user-x', reason: 'share_capital_introduced',
    });

    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-in' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const creditLine = je!.lines.find((l) => Number(l.credit) > 0);
    expect(creditLine?.accountId).toBe('acct-9210');
    expect(state.bankTxns['btx-in'].userPaymentReason).toBe('share_capital_introduced');
  });

  it('money_paid_to_user: missing payToUserId throws 400', async () => {
    seed();
    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
        reason: 'dividend',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('money_paid_to_user: missing reason throws 400', async () => {
    seed();
    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
        payToUserId: 'user-x',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('money_paid_to_user: invalid reason throws 400', async () => {
    seed();
    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
        payToUserId: 'user-x', reason: 'not_a_valid_reason',
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Invalid reason') });
  });

  it('money_paid_to_user unexplain reverses dividend to zero and retains userPaymentReason for prefill', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
      payToUserId: 'user-x', reason: 'dividend',
    });

    expect(state.bankTxns['btx-1'].userPaymentReason).toBe('dividend');

    await unexplain({ bankTxnId: 'btx-1', userId: USER });

    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-1',
    );
    expect(je!.isDeleted).toBe(true);
    expect(netForSource(state.entries, 'BankTxnExplain', 'btx-1')).toBeCloseTo(0, 4);

    expect(state.bankTxns['btx-1'].explainStatus).toBe('UNEXPLAINED');
    // userPaymentReason is a prior-selection field — RETAINED for form prefill
    // (same as categoryId/transactionTypeKey), not cleared by unexplain.
    expect(state.bankTxns['btx-1'].userPaymentReason).toBe('dividend');

    // Linkage IS cleared though (the fields this task targets).
    expect(state.bankTxns['btx-1'].relatedType).toBe('MANUAL');
    expect(state.bankTxns['btx-1'].relatedId).toBeNull();
    expect(state.bankTxns['btx-1'].isPaymentBorn).toBe(false);
  });

  it('money_paid_to_user: a SOFT-DELETED target account is NOT resolved (throws 400)', async () => {
    const { state } = seed();
    // Soft-delete the dividend account (9220). The @@unique([userId, code]) row
    // survives a soft delete, so a naive findUnique would still post to it.
    state.accounts['acct-9220'].isDeleted = true;

    await expect(
      explainAndPost({
        bankTxnId: 'btx-1', userId: USER, transactionTypeKey: 'money_paid_to_user',
        payToUserId: 'user-x', reason: 'dividend',
      }),
    ).rejects.toMatchObject({ status: 400 });

    // No JE may have been posted to the soft-deleted account.
    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-1' && !e.isDeleted,
    );
    expect(je).toBeFalsy();
  });

  it('USER_PAYMENT_REASONS locks the full reason→accountCode mapping (snapshot)', () => {
    expect(USER_PAYMENT_REASONS.money_received_from_user).toHaveLength(3);
    expect(USER_PAYMENT_REASONS.money_paid_to_user).toHaveLength(6);

    const inMap = Object.fromEntries(
      USER_PAYMENT_REASONS.money_received_from_user.map((r) => [r.key, r.accountCode]),
    );
    expect(inMap).toEqual({
      director_loan: '9200',
      unpaid_shares: '9210',
      share_capital_introduced: '9210',
    });

    const outMap = Object.fromEntries(
      USER_PAYMENT_REASONS.money_paid_to_user.map((r) => [r.key, r.accountCode]),
    );
    expect(outMap).toEqual({
      director_loan_repayment: '9200',
      net_salary: '9230',
      dividend: '9220',
      benefit_in_kind: '9230',
      expense_payment: '9250',
      payroll_settlement: '9260',
    });
  });
});

// ---------------------------------------------------------------------------
// GAP 3: bill_payment ties to bill (SupplierPayment + AP sub-ledger tie)
// ---------------------------------------------------------------------------

describe('explainAndPost — bill_payment ties to bill (GAP 3)', () => {
  it('creates SupplierPayment, updates purchase paidAmount/status, posts balanced Dr AP / Cr Bank', async () => {
    const { state } = seed();

    const out = await explainAndPost({
      bankTxnId: 'btx-bill', userId: USER, transactionTypeKey: 'bill_payment',
      billId: 'bill-1',
    });

    expect(out.bankTxnId).toBe('btx-bill');

    // 1. A SupplierPayment row was created.
    const sp = Object.values(state.supplierPayments).find((s) => s['purchaseId'] === 'bill-1');
    expect(sp).toBeTruthy();
    expect(Number(sp!['amount'])).toBeCloseTo(200, 4);
    expect(sp!['isVoided']).toBe(false);

    // 2. GL entry is keyed to the SupplierPayment id, not the bank txn id.
    const supplierPaymentId = (sp as { id: string }).id;
    const je = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === supplierPaymentId && e.event === 'payment',
    );
    expect(je).toBeTruthy();

    // 3. GL entry is balanced.
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(200, 4);

    // 4. AP reduction == sub-ledger reduction (GL tie-out).
    // The AP account was debited by 200 — same as the SupplierPayment amount.
    const apRole = pack.roleMap.AP;
    const apLines = je!.lines.filter((l) => l.accountId === apRole);
    const apDebit = apLines.reduce((s, l) => s + Number(l.debit), 0);
    expect(apDebit).toBeCloseTo(200, 4); // AP debited = sub-ledger reduction

    // 5. Purchase status updated.
    const purchase = state.purchases['bill-1'];
    expect(Number(purchase['paidAmount'])).toBeCloseTo(200, 4);
    expect(Number(purchase['balanceAmount'])).toBeCloseTo(300, 4);
    expect(purchase['status']).toBe('partially_paid');

    // 6. Bank txn stamped correctly.
    const btx = state.bankTxns['btx-bill'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.postedSourceType).toBe('SupplierPayment');
    expect(btx.postedSourceId).toBe(supplierPaymentId);
    expect(btx.isReconciled).toBe(true);
  });

  it('rejects overpayment (amount > remaining balance)', async () => {
    const { state } = seed();
    // Simulate that 400 has already been paid via a SupplierPayment (leaving 100 balance).
    // applyBillPayment aggregates from supplierPayment records, so we must seed one.
    state.supplierPayments['sp-existing'] = {
      id: 'sp-existing', purchaseId: 'bill-1', amount: '400',
      isVoided: false, isDeleted: false,
    };
    // The purchase reflects that 400 is paid, 100 remaining.
    state.purchases['bill-1'].paidAmount = '400';
    state.purchases['bill-1'].balanceAmount = '100';

    // btx-bill amount is 200, remaining is 100 → should reject as overpayment.
    await expect(
      explainAndPost({
        bankTxnId: 'btx-bill', userId: USER, transactionTypeKey: 'bill_payment',
        billId: 'bill-1',
      }),
    ).rejects.toThrow(/exceeds.*balance/i);
  });

  it('unexplain voids SupplierPayment + GL + reverts purchase status', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-bill', userId: USER, transactionTypeKey: 'bill_payment',
      billId: 'bill-1',
    });

    const sp = Object.values(state.supplierPayments).find((s) => s['purchaseId'] === 'bill-1') as Record<string, unknown> & { id: string };
    expect(sp).toBeTruthy();
    const supplierPaymentId = sp.id;

    await unexplain({ bankTxnId: 'btx-bill', userId: USER });

    // GL entry is soft-deleted (voidDocument mangles the event to free the unique slot).
    const je = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === supplierPaymentId && e.isDeleted,
    );
    expect(je).toBeTruthy();
    expect(je!.isDeleted).toBe(true);
    expect(netForSource(state.entries, 'SupplierPayment', supplierPaymentId)).toBeCloseTo(0, 4);

    // SupplierPayment is voided.
    expect(sp['isVoided']).toBe(true);
    expect(sp['voidReason']).toBe('Unexplained from bank transaction');

    // Purchase reverted.
    const purchase = state.purchases['bill-1'];
    expect(Number(purchase['paidAmount'])).toBeCloseTo(0, 4);
    expect(purchase['status']).toBe('pending');

    // Bank txn reset.
    const btx = state.bankTxns['btx-bill'];
    expect(btx.explainStatus).toBe('UNEXPLAINED');
    expect(btx.postedSourceType).toBeNull();
    expect(btx.postedSourceId).toBeNull();
  });

  it('legacy purchase (supplierId=null, vendorId set): SupplierPayment.supplierId resolves to null — no FK violation', async () => {
    // Regression guard: before the fix, vendorId (a User FK) was used as the Supplier FK
    // fallback, causing a FK violation in production when supplierId was null.
    const { state } = seed();

    // Seed a legacy purchase that has vendorId set but supplierId null — pre-Supplier-migration shape.
    state.purchases['bill-legacy'] = {
      id: 'bill-legacy', userId: USER, totalAmount: '300', paidAmount: '0', balanceAmount: '300',
      status: 'pending',
      supplierId: null,       // ← no Supplier row
      vendorId: 'user-v1',   // ← a User FK (NOT a Supplier id)
      billTo: null,
      isDeleted: false,
    };

    // A bank txn for the legacy bill.
    state.bankTxns['btx-legacy'] = {
      id: 'btx-legacy', bankAccountId: 'bank-1', type: 'WITHDRAWAL',
      amount: '100', transactionDate: new Date('2026-06-12'),
      explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
      isReconciled: false, postedSourceType: null, postedSourceId: null,
      categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
      paymentModeId: 'pm-bank',
    };

    // This must NOT throw (before the fix it would on a real DB with FK enforcement).
    const out = await explainAndPost({
      bankTxnId: 'btx-legacy', userId: USER, transactionTypeKey: 'bill_payment',
      billId: 'bill-legacy',
    });

    expect(out.bankTxnId).toBe('btx-legacy');

    // The SupplierPayment was created with supplierId === null (NOT 'user-v1').
    const sp = Object.values(state.supplierPayments).find((s) => s['purchaseId'] === 'bill-legacy');
    expect(sp).toBeTruthy();
    expect(sp!['supplierId']).toBeNull();   // ← critical: must NOT be 'user-v1'

    // paymentId must be set (PAY-NNNNNN sequence).
    expect(typeof sp!['paymentId']).toBe('string');
    expect((sp!['paymentId'] as string).startsWith('PAY-')).toBe(true);

    // GL still posted and purchase status updated correctly.
    expect(Number(state.purchases['bill-legacy']['paidAmount'])).toBeCloseTo(100, 4);
    expect(state.purchases['bill-legacy']['status']).toBe('partially_paid');
    expect(state.bankTxns['btx-legacy'].explainStatus).toBe('EXPLAINED');
  });

  it('pre-go-live: creates SupplierPayment + retains linkage but posts NO JE; unexplain still voids SP + recomputes', async () => {
    // goLiveDate in the future → ledger gate OFF → no JE posted.
    const { state } = seed({ goLiveDate: new Date('2099-01-01') });

    await explainAndPost({
      bankTxnId: 'btx-bill', userId: USER, transactionTypeKey: 'bill_payment',
      billId: 'bill-1',
    });

    // SupplierPayment row exists despite the gate being off.
    const sp = Object.values(state.supplierPayments).find((s) => s['purchaseId'] === 'bill-1') as Record<string, unknown> & { id: string };
    expect(sp).toBeTruthy();
    expect(Number(sp['amount'])).toBeCloseTo(200, 4);
    const spId = sp.id;

    // NO journal entry was posted (gate off).
    const je = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === spId && e.event === 'payment',
    );
    expect(je).toBeFalsy();

    // Linkage retained so unexplain can void the SP, and NOT reconciled (no GL).
    const btx = state.bankTxns['btx-bill'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.postedSourceType).toBe('SupplierPayment');
    expect(btx.postedSourceId).toBe(spId);
    expect(btx.isReconciled).toBe(false);

    // Purchase still updated (sub-ledger reflects the payment even pre-go-live).
    expect(Number(state.purchases['bill-1']['paidAmount'])).toBeCloseTo(200, 4);
    expect(state.purchases['bill-1']['status']).toBe('partially_paid');

    // Unexplain still voids the SP + recomputes purchase, even with no JE.
    await unexplain({ bankTxnId: 'btx-bill', userId: USER });

    expect(sp['isVoided']).toBe(true);
    expect(Number(state.purchases['bill-1']['paidAmount'])).toBeCloseTo(0, 4);
    expect(state.purchases['bill-1']['status']).toBe('pending');
    const btx2 = state.bankTxns['btx-bill'];
    expect(btx2.explainStatus).toBe('UNEXPLAINED');
    expect(btx2.postedSourceType).toBeNull();
    expect(btx2.postedSourceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAP 3: credit_note_refund routes to AR not expense
// ---------------------------------------------------------------------------

describe('explainAndPost — credit_note_refund routes to AR not expense (GAP 3)', () => {
  it('posts Dr AR / Cr Bank (NOT an expense account), balanced', async () => {
    const { state } = seed();

    // Use a money-out bank txn of 150 to refund the credit note
    state.bankTxns['btx-cnr'] = {
      id: 'btx-cnr', bankAccountId: 'bank-1', type: 'WITHDRAWAL',
      amount: '150', transactionDate: new Date('2026-06-15'),
      explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
      isReconciled: false, postedSourceType: null, postedSourceId: null,
      categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
    };

    await explainAndPost({
      bankTxnId: 'btx-cnr', userId: USER, transactionTypeKey: 'credit_note_refund',
      creditNoteId: 'cn-1',
    });

    // GL entry exists.
    const je = state.entries.find(
      (e) => e.sourceType === 'CreditNote' && e.sourceId === 'cn-1' && e.event === 'refund',
    );
    expect(je).toBeTruthy();

    // Balanced.
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(150, 4);

    // AR was debited (not an expense account).
    const arAccountId = pack.roleMap.AR;
    const arLines = je!.lines.filter((l) => l.accountId === arAccountId);
    expect(arLines.length).toBeGreaterThan(0);
    const arDebit = arLines.reduce((s, l) => s + Number(l.debit), 0);
    expect(arDebit).toBeCloseTo(150, 4);

    // No Expense record created (NOT generic_category path).
    expect(Object.keys(state.expenses).length).toBe(0);

    // Bank txn stamped.
    const btx = state.bankTxns['btx-cnr'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.postedSourceType).toBe('CreditNote');
    expect(btx.postedSourceId).toBe('cn-1');
  });

  it('unexplain reverses the credit_note_refund posting', async () => {
    const { state } = seed();

    state.bankTxns['btx-cnr'] = {
      id: 'btx-cnr', bankAccountId: 'bank-1', type: 'WITHDRAWAL',
      amount: '150', transactionDate: new Date('2026-06-15'),
      explainStatus: 'UNEXPLAINED', relatedType: 'MANUAL', relatedId: null,
      isReconciled: false, postedSourceType: null, postedSourceId: null,
      categoryId: null, transactionTypeKey: null, taxTreatment: null, taxAmount: null,
    };

    await explainAndPost({
      bankTxnId: 'btx-cnr', userId: USER, transactionTypeKey: 'credit_note_refund',
      creditNoteId: 'cn-1',
    });

    await unexplain({ bankTxnId: 'btx-cnr', userId: USER });

    // GL reversed.
    expect(netForSource(state.entries, 'CreditNote', 'cn-1')).toBeCloseTo(0, 4);
    const btx = state.bankTxns['btx-cnr'];
    expect(btx.explainStatus).toBe('UNEXPLAINED');
    expect(btx.postedSourceType).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAP 4: capital_asset explain creates FixedAsset register row
// ---------------------------------------------------------------------------

describe('explainAndPost — capital_asset creates FixedAsset register row (GAP 4)', () => {
  it('posts balanced GL (Dr asset-account / Cr Bank) AND creates FixedAsset with correct cost/life/method', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-asset', userId: USER, transactionTypeKey: 'capital_asset',
      categoryId: 'cat-asset',
      depreciationMethod: 'STRAIGHT_LINE',
      assetLifeMonths: 60,
      explainedDescription: 'New server',
    });

    // 1. GL balanced (Dr asset-account / Cr Bank), total = 1200, no tax.
    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-asset' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(1200, 4);

    // 2. A FixedAsset register row was created.
    const allAssets = Object.values(state.fixedAssets).filter((a) => a['userId'] === USER && a['status'] === 'active' && !a['isDeleted']);
    // Filter out the pre-seeded 'fa-1' (Old server) which has different cost.
    const newAssets = allAssets.filter((a) => Number(a['cost']) === 1200);
    expect(newAssets.length).toBe(1);
    const fa = newAssets[0];

    // 3. cost = net (ex-tax). No tax here, so cost === 1200.
    expect(Number(fa['cost'])).toBeCloseTo(1200, 4);
    // 4. usefulLifeMonths and method match input.
    expect(fa['usefulLifeMonths']).toBe(60);
    expect(fa['method']).toBe('STRAIGHT_LINE');
    // 5. acquisitionDate = txn date.
    expect(fa['acquisitionDate']).toEqual(new Date('2026-06-05'));
    // 6. status = active.
    expect(fa['status']).toBe('active');
    // 7. name from description.
    expect(fa['name']).toBe('New server');

    // 8. Bank txn stamped correctly.
    const btx = state.bankTxns['btx-asset'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.transactionTypeKey).toBe('capital_asset');
    expect(btx.isReconciled).toBe(true);
    // createdAssetId stored on the bank txn for unexplain.
    expect(btx.createdAssetId).toBe(fa['id']);
  });

  it('with VAT: cost = net (ex-VAT), not gross', async () => {
    const { state } = seed();

    // Seed a 20% tax rate.
    state.taxRates['tr-vat'] = { id: 'tr-vat', name: 'VAT 20%', taxKind: 'INCLUSIVE', rate: '20' };
    // Make the category tax-applicable with this rate.
    state.categories['cat-asset'].taxApplicable = true;
    state.categories['cat-asset'].defaultTaxRateId = 'tr-vat';

    await explainAndPost({
      bankTxnId: 'btx-asset', userId: USER, transactionTypeKey: 'capital_asset',
      categoryId: 'cat-asset',
      depreciationMethod: 'REDUCING_BALANCE',
      assetLifeMonths: 36,
      explainedDescription: 'Taxed server',
    });

    // btx amount = 1200 gross (tax-inclusive at 20%).
    // net = 1200 / 1.2 = 1000. tax = 200.
    const btx = state.bankTxns['btx-asset'];
    expect(Number(btx.taxAmount)).toBeCloseTo(200, 2);

    // GL balanced (Dr asset 1000 + Dr INPUT_TAX 200 / Cr Bank 1200).
    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-asset' && e.event === 'explained',
    );
    expect(je).toBeTruthy();
    const debits = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeCloseTo(1200, 2);

    // FixedAsset cost = net (ex-VAT) ≈ 1000.
    // The createdAssetId is stored on the bank txn — use it to find the exact asset.
    const btx2 = state.bankTxns['btx-asset'];
    const createdId = btx2.createdAssetId as string;
    expect(createdId).toBeTruthy();
    const fa = state.fixedAssets[createdId];
    expect(fa).toBeTruthy();
    expect(Number(fa!['cost'])).toBeCloseTo(1000, 2);
    expect(fa!['method']).toBe('REDUCING_BALANCE');
    expect(fa!['usefulLifeMonths']).toBe(36);
  });

  it('missing assetLifeMonths defaults to 60 (5 years)', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-asset', userId: USER, transactionTypeKey: 'capital_asset',
      categoryId: 'cat-asset',
      // No assetLifeMonths supplied.
    });

    const fa = Object.values(state.fixedAssets).find((a) => a['userId'] === USER && Number(a['cost']) === 1200);
    expect(fa).toBeTruthy();
    expect(fa!['usefulLifeMonths']).toBe(60);
    expect(fa!['method']).toBe('STRAIGHT_LINE'); // default
  });

  it('NONE depreciation method: creates asset with method NONE (will not depreciate)', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-asset', userId: USER, transactionTypeKey: 'capital_asset',
      categoryId: 'cat-asset',
      depreciationMethod: 'NONE',
      assetLifeMonths: 120,
    });

    const fa = Object.values(state.fixedAssets).find((a) => a['userId'] === USER && Number(a['cost']) === 1200);
    expect(fa).toBeTruthy();
    expect(fa!['method']).toBe('NONE');
  });

  it('unexplain (no depreciation): voids JE AND soft-deletes the FixedAsset', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-asset', userId: USER, transactionTypeKey: 'capital_asset',
      categoryId: 'cat-asset',
      depreciationMethod: 'STRAIGHT_LINE',
      assetLifeMonths: 60,
      explainedDescription: 'New server',
    });

    const btx = state.bankTxns['btx-asset'];
    const assetId = btx.createdAssetId as string;
    expect(assetId).toBeTruthy();

    await unexplain({ bankTxnId: 'btx-asset', userId: USER });

    // GL JE is soft-deleted.
    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-asset',
    );
    expect(je).toBeTruthy();
    expect(je!.isDeleted).toBe(true);
    expect(netForSource(state.entries, 'BankTxnExplain', 'btx-asset')).toBeCloseTo(0, 4);

    // FixedAsset soft-deleted.
    const fa = state.fixedAssets[assetId];
    expect(fa).toBeTruthy();
    expect(fa['isDeleted']).toBe(true);

    // Bank txn reset.
    expect(btx.explainStatus).toBe('UNEXPLAINED');
    expect(btx.createdAssetId).toBeNull();
    expect(btx.postedSourceType).toBeNull();
    expect(btx.isReconciled).toBe(false);
  });

  it('unexplain after depreciation: throws 409 and leaves asset intact', async () => {
    const { state } = seed();

    await explainAndPost({
      bankTxnId: 'btx-asset', userId: USER, transactionTypeKey: 'capital_asset',
      categoryId: 'cat-asset',
      depreciationMethod: 'STRAIGHT_LINE',
      assetLifeMonths: 60,
    });

    const btx = state.bankTxns['btx-asset'];
    const assetId = btx.createdAssetId as string;
    expect(assetId).toBeTruthy();

    // Simulate depreciation having been posted: set accumulatedDepreciation > 0.
    state.fixedAssets[assetId].accumulatedDepreciation = '20';

    await expect(
      unexplain({ bankTxnId: 'btx-asset', userId: USER }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('depreciation') });

    // Asset remains intact (not deleted).
    expect(state.fixedAssets[assetId].isDeleted).toBeFalsy();
    // Bank txn still EXPLAINED.
    expect(btx.explainStatus).toBe('EXPLAINED');
  });

  it('pre-go-live: creates FixedAsset register row but no GL JE; unexplain still soft-deletes asset', async () => {
    // goLiveDate in the future — GL gate OFF.
    const { state } = seed({ goLiveDate: new Date('2099-01-01') });

    await explainAndPost({
      bankTxnId: 'btx-asset', userId: USER, transactionTypeKey: 'capital_asset',
      categoryId: 'cat-asset',
      depreciationMethod: 'STRAIGHT_LINE',
      assetLifeMonths: 60,
    });

    // No GL JE posted (gated out).
    const je = state.entries.find(
      (e) => e.sourceType === 'BankTxnExplain' && e.sourceId === 'btx-asset',
    );
    expect(je).toBeFalsy();

    // FixedAsset still created (register is master data, independent of GL gate).
    const fa = Object.values(state.fixedAssets).find((a) => a['userId'] === USER && Number(a['cost']) === 1200);
    expect(fa).toBeTruthy();
    const assetId = fa!['id'] as string;

    // Bank txn is EXPLAINED, NOT reconciled.
    const btx = state.bankTxns['btx-asset'];
    expect(btx.explainStatus).toBe('EXPLAINED');
    expect(btx.isReconciled).toBe(false);
    expect(btx.createdAssetId).toBe(assetId);

    // Unexplain still soft-deletes the asset (even with no JE).
    await unexplain({ bankTxnId: 'btx-asset', userId: USER });
    expect(state.fixedAssets[assetId]['isDeleted']).toBe(true);
    expect(btx.createdAssetId).toBeNull();
    expect(btx.explainStatus).toBe('UNEXPLAINED');
  });
});
