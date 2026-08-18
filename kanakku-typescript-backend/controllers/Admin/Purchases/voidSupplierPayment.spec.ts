// controllers/Admin/Purchases/voidSupplierPayment.spec.ts
// Unit test for the soft-VOID supplier-payment endpoint (Task 2, purchase-parity).
//
// Mirrors voidInvoicePayment.spec.ts exactly — uses the same in-memory fake Prisma
// harness (journal/mapping/period/settings + stores for purchase, supplierPayment,
// bankDetail, bankTransaction, paymentMode) so the real reverseDocument/reverse
// posting wrappers run end-to-end with no live DB.
//
// The harness seeds a LIVE forward (SupplierPayment, <paymentId>, 'payment')
// JournalEntry for each payment so the test FAILS if voidSupplierPayment reverses
// the wrong (sourceType, sourceId, event) triple.

import { describe, it, expect, vi } from 'vitest';
import { getPack } from '../../../lib/ledger/packs/index';

const USER = 'u-void-sp';
const pack = getPack('GB')!;

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

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v !== null && typeof v === 'object') continue; // ignore relational/operator filters
    if (row[k] !== v) return false;
  }
  return true;
}

function buildFakePrisma() {
  const entries: StoredEntry[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  const roleToId: Record<string, string> = {};
  for (const [role, code] of Object.entries(pack.roleMap)) roleToId[role] = code;

  const banks: Record<string, Record<string, unknown>> = {};
  const bankTxns: Record<string, Record<string, unknown>> = {};
  const pettyCashes: Record<string, Record<string, unknown>> = {};
  const pettyCashTxns: Record<string, Record<string, unknown>> = {};
  const purchases: Record<string, Record<string, unknown>> = {};
  const payments: Record<string, Record<string, unknown>> = {};
  const paymentModes: Record<string, { id: string; slug: string; name: string }> = {};

  const journalEntry = {
    async findFirst(args: unknown): Promise<StoredEntry | null> {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return entries.find((e) => {
        if ('id' in w && e.id !== w['id']) return false;
        if ('userId' in w && e.userId !== w['userId']) return false;
        if ('sourceType' in w && e.sourceType !== w['sourceType']) return false;
        if ('sourceId' in w && e.sourceId !== w['sourceId']) return false;
        if ('event' in w && e.event !== w['event']) return false;
        if ('isDeleted' in w && e.isDeleted !== w['isDeleted']) return false;
        return true;
      }) ?? null;
    },
    async create(args: { data: unknown }): Promise<{ id: string }> {
      const d = args.data as {
        userId: string; entryDate: Date;
        sourceType?: string | null; sourceId?: string | null; event?: string | null;
        reversedById?: string | null; lines?: { create: StoredLine[] };
      };
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
      return { ledgerInitialized: true, goLiveDate: new Date('2000-01-01') };
    },
  };

  const bankDetail = {
    async findUnique(args: { where: { id: string } }) { return banks[args.where.id] ?? null; },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = banks[args.where.id];
      Object.assign(row, args.data);
      return row;
    },
  };
  const bankTransaction = {
    async create(args: { data: Record<string, unknown> }) {
      const id = nextId('btx');
      const row = { id, ...args.data };
      bankTxns[id] = row;
      return row;
    },
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(bankTxns).find((r) => matchWhere(r, w)) ?? null;
    },
  };
  const purchase = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(purchases).find((r) => matchWhere(r, w)) ?? null;
    },
    async findUnique(args: { where: { id: string } }) { return purchases[args.where.id] ?? null; },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = purchases[args.where.id];
      Object.assign(row, args.data);
      return row;
    },
  };
  const supplierPayment = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      const inc = (args as { include?: Record<string, unknown> }).include;
      const row = Object.values(payments).find((r) => {
        // flat scalar matching
        if (!matchWhere(r, w)) return false;
        // nested purchase scope: { purchase: { userId, isDeleted } }
        const purW = (w as { purchase?: Record<string, unknown> }).purchase;
        if (purW) {
          const pur = purchases[r.purchaseId as string];
          if (!pur || !matchWhere(pur, purW)) return false;
        }
        return true;
      });
      if (!row) return null;
      // hydrate includes
      const out: Record<string, unknown> = { ...row };
      if (inc?.purchase) out.purchase = purchases[row.purchaseId as string] ?? null;
      if (inc?.bank) out.bank = banks[row.bankId as string] ?? null;
      if (inc?.paymentMode) out.paymentMode = paymentModes[row.paymentModeId as string] ?? null;
      return out;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = payments[args.where.id];
      Object.assign(row, args.data);
      return row;
    },
    async aggregate(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      const sum = Object.values(payments)
        .filter((r) => matchWhere(r, w))
        .reduce((s, r) => s + Number(r.paidAmount), 0);
      return { _sum: { paidAmount: sum } };
    },
  };
  const paymentMode = {
    async findUnique(args: { where: { id: string } }) { return paymentModes[args.where.id] ?? null; },
  };

  const pettyCash = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(pettyCashes).find((r) => matchWhere(r, w)) ?? null;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = pettyCashes[args.where.id];
      Object.assign(row, args.data);
      return row;
    },
  };
  const pettyCashTransaction = {
    async create(args: { data: Record<string, unknown> }) {
      const id = nextId('pctx');
      const row = { id, ...args.data };
      pettyCashTxns[id] = row;
      return row;
    },
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(pettyCashTxns).find((r) => matchWhere(r, w)) ?? null;
    },
  };

  const client: Record<string, unknown> = {
    journalEntry, ledgerAccountMapping, accountingPeriod, companySettings,
    bankDetail, bankTransaction, pettyCash, pettyCashTransaction,
    purchase, supplierPayment, paymentMode,
  };
  client.$transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client);

  return {
    prisma: client,
    state: { entries, banks, bankTxns, pettyCashes, pettyCashTxns, purchases, payments, paymentModes },
    nextId,
  };
}

const { fake } = vi.hoisted(() => ({ fake: { current: null as ReturnType<typeof buildFakePrisma> | null } }));

vi.mock('../../../lib/prisma', () => ({
  get prisma() { return fake.current!.prisma; },
}));

// Import AFTER the mock is registered.
import { voidSupplierPayment } from './supplierPaymentReadController';
import { post } from '../../../lib/ledger/postingEngine';

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function fakeReq(paymentId: string, userId: string | null, reason?: string) {
  return {
    params: { paymentId },
    body: reason != null ? { reason } : {},
    user: userId ?? undefined,
  } as never;
}

/**
 * Per-account net (debits - credits) across all LIVE entries sharing a source
 * triple. A balanced forward entry alone nets to 0 in aggregate, so after a
 * correct reversal EVERY account for this source nets to 0.
 */
function perAccountNet(entries: StoredEntry[], sourceType: string, sourceId: string): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const e of entries) {
    if (e.sourceType !== sourceType || e.sourceId !== sourceId || e.isDeleted) continue;
    for (const l of e.lines) {
      acc[l.accountId] = (acc[l.accountId] ?? 0) + (Number(l.debit) - Number(l.credit));
    }
  }
  return acc;
}

function maxAbs(net: Record<string, number>): number {
  return Object.values(net).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

/**
 * Seed a purchase with totalAmount and N supplier payments, each carrying a LIVE
 * forward (SupplierPayment, paymentId, 'payment') JournalEntry posted via the real
 * engine (Dr AP / Cr BANK for the paidAmount).
 */
async function seed(opts: { total: number; payments: number[]; sourceType?: 'BANK' | 'PETTY_CASH' }) {
  const built = buildFakePrisma();
  fake.current = built;
  const { state } = built;

  const sourceType = opts.sourceType ?? 'BANK';

  state.paymentModes['pm-bank'] = { id: 'pm-bank', slug: 'bank-transfer', name: 'Bank Transfer' };
  state.banks['bank-1'] = { id: 'bank-1', userId: USER, currencyCode: 'GBP', currentBalance: '2000' };
  // Seed a petty cash fund (always present — only used when sourceType=PETTY_CASH)
  state.pettyCashes['pc-1'] = { id: 'pc-1', userId: USER, isDeleted: false, currentBalance: '1000' };

  state.purchases['pur-1'] = {
    id: 'pur-1', userId: USER, isDeleted: false,
    totalAmount: String(opts.total), status: 'pending', purchaseId: 'PUR-000001',
  };

  const tx = built.prisma as never;
  const ids: string[] = [];
  for (let i = 0; i < opts.payments.length; i++) {
    const amount = opts.payments[i];
    const pid = `spay-${i + 1}`;
    ids.push(pid);
    if (sourceType === 'PETTY_CASH') {
      state.payments[pid] = {
        id: pid, purchaseId: 'pur-1', paidAmount: String(amount),
        paymentModeId: null, bankId: null,
        sourceType: 'PETTY_CASH',
        // record path moved the petty register at create → reversal must undo it
        movedBankBalance: true,
        paymentDate: new Date('2026-06-01'), notes: '', createdBy: USER,
        isVoided: false, voidedById: null, voidedAt: null, voidReason: null,
      };
      // decrement petty cash balance (as createSupplierPayment does)
      const pcBal = Number(state.pettyCashes['pc-1'].currentBalance);
      state.pettyCashes['pc-1'].currentBalance = String(pcBal - amount);
      // self-authored petty line keyed to this payment (createSupplierPayment
      // writes this) — the finding-1 discriminator that this is a record-path
      // payment whose register move must be reversed.
      const pctxId = `pctx-seed-${i + 1}`;
      state.pettyCashTxns[pctxId] = {
        id: pctxId, pettyCashId: 'pc-1', transactionType: 'EXPENSE',
        amount: String(amount), relatedType: 'SUPPLIER_PAYMENT', relatedId: pid,
        isDeleted: false,
      };
    } else {
      state.payments[pid] = {
        id: pid, purchaseId: 'pur-1', paidAmount: String(amount),
        paymentModeId: 'pm-bank', bankId: 'bank-1',
        sourceType: 'BANK',
        // record path moved the bank register at create → reversal must undo it
        movedBankBalance: true,
        paymentDate: new Date('2026-06-01'), notes: '', createdBy: USER,
        isVoided: false, voidedById: null, voidedAt: null, voidReason: null,
      };
      // decrement bank balance to reflect the outflow (as createSupplierPayment does)
      const bal = Number(state.banks['bank-1'].currentBalance);
      state.banks['bank-1'].currentBalance = String(bal - amount);
      // self-authored bank line keyed to this payment (createSupplierPayment
      // writes this) — the finding-1 discriminator that this is a record-path
      // payment whose register move must be reversed.
      const btxId = `btx-seed-${i + 1}`;
      state.bankTxns[btxId] = {
        id: btxId, bankAccountId: 'bank-1', type: 'TRANSFER_OUT',
        amount: String(amount), relatedType: 'SUPPLIER_PAYMENT', relatedId: pid,
        isDeleted: false,
      };
    }
    // post the forward payment GL: Dr AP / Cr BANK (same for both source types)
    await post(tx, {
      userId: USER, sourceType: 'SupplierPayment', sourceId: pid, event: 'payment',
      date: new Date('2026-06-01'), currencyCode: 'BASE',
      instructions: [
        { roleKey: 'AP', side: 'debit', amount: String(amount) },
        { roleKey: 'BANK', side: 'credit', amount: String(amount) },
      ],
    });
    // update purchase status
    const paid = Object.values(state.payments)
      .filter((p) => !p.isVoided)
      .reduce((s, p) => s + Number(p.paidAmount), 0);
    state.purchases['pur-1'].status = paid >= opts.total ? 'paid' : paid > 0 ? 'partially_paid' : 'pending';
  }

  return { built, ids };
}

describe('voidSupplierPayment', () => {
  it('reverses the GL for the EXACT (SupplierPayment, paymentId, payment) triple, nets to 0', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;

    // The forward payment (Dr AP 100 / Cr BANK 100) — before void, both accounts
    // carry a non-zero per-account balance for this source.
    expect(maxAbs(perAccountNet(state.entries, 'SupplierPayment', ids[0]))).toBeGreaterThan(50);

    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'mistake'), res as never);
    expect(res.statusCode).toBe(200);

    // A reversal JE for the EXACT (SupplierPayment, paymentId, payment) triple exists,
    // keyed payment.reversal and linking back to the forward entry.
    const forward = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === ids[0] && e.event === 'payment',
    );
    expect(forward).toBeTruthy();
    const reversal = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === ids[0]
        && e.event === 'payment.reversal' && e.reversedById === forward!.id,
    );
    expect(reversal).toBeTruthy();
    // Forward + reversal cancel: EVERY account for this source now nets to ZERO.
    expect(maxAbs(perAccountNet(state.entries, 'SupplierPayment', ids[0]))).toBeCloseTo(0, 4);
    // The OTHER payment is untouched — no reversal, account balances still non-zero.
    const otherReversal = state.entries.find(
      (e) => e.sourceType === 'SupplierPayment' && e.sourceId === ids[1] && e.event === 'payment.reversal',
    );
    expect(otherReversal).toBeFalsy();
    expect(maxAbs(perAccountNet(state.entries, 'SupplierPayment', ids[1]))).toBeGreaterThan(50);
  });

  it('marks the payment isVoided + voidReason and stamps voidedById/voidedAt', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;

    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'duplicate entry'), res as never);

    const p = state.payments[ids[0]];
    expect(p.isVoided).toBe(true);
    expect(p.voidReason).toBe('duplicate entry');
    expect(p.voidedById).toBe(USER);
    expect(p.voidedAt).toBeInstanceOf(Date);
  });

  it('recomputes purchase status: two payments = total → paid; void one → partially_paid, remaining > 0', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;
    expect(state.purchases['pur-1'].status).toBe('paid');

    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'test void'), res as never);

    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; data: { total: number; paid: number; remaining: number; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('partially_paid');
    expect(body.data.paid).toBeCloseTo(100, 4);
    expect(body.data.remaining).toBeCloseTo(100, 4);
    expect(state.purchases['pur-1'].status).toBe('partially_paid');
  });

  it('increments bank currentBalance by the payment amount and creates a reversing BankTransaction', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;
    // After seeding: bank started at 2000, decremented by 100 twice → 1800
    const balBefore = Number(state.banks['bank-1'].currentBalance); // 1800

    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'test void'), res as never);

    // Void INCREMENTS balance (reverses the outflow)
    expect(Number(state.banks['bank-1'].currentBalance)).toBeCloseTo(balBefore + 100, 4);

    // Post-void the store holds BOTH the seeded original (TRANSFER_OUT) and the
    // reversal — disambiguate to the reversing TRANSFER_IN row.
    const revTxn = Object.values(state.bankTxns).find(
      (t) => t.relatedType === 'SUPPLIER_PAYMENT' && t.relatedId === ids[0] && t.type === 'TRANSFER_IN',
    );
    expect(revTxn).toBeTruthy();
    expect(Number(revTxn!.amount)).toBeCloseTo(100, 4);
    // bank-transfer mode → original was TRANSFER_OUT, reversal is TRANSFER_IN
    expect(revTxn!.type).toBe('TRANSFER_IN');
    expect(Number(revTxn!.balanceBefore)).toBeCloseTo(balBefore, 4);
    expect(Number(revTxn!.balanceAfter)).toBeCloseTo(balBefore + 100, 4);
  });

  it('404s when the payment is not owned by the user', async () => {
    const { ids } = await seed({ total: 200, payments: [100, 100] });
    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], 'someone-else', 'x'), res as never);
    expect(res.statusCode).toBe(404);
  });

  it('400s when the payment is already voided', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    built.state.payments[ids[0]].isVoided = true;
    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'x'), res as never);
    expect(res.statusCode).toBe(400);
  });

  it('uses TRANSFER_IN for a bank-transfer mode payment reversal (opposite of TRANSFER_OUT)', async () => {
    const { built, ids } = await seed({ total: 100, payments: [100] });
    const { state } = built;

    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'bank void'), res as never);
    expect(res.statusCode).toBe(200);
    const revTxn = Object.values(state.bankTxns).find(
      (t) => t.relatedId === ids[0] && t.type === 'TRANSFER_IN',
    );
    expect(revTxn!.type).toBe('TRANSFER_IN');
  });

  it('PETTY_CASH void: restores petty cash currentBalance and writes a reversing RETURN pettyCashTransaction', async () => {
    // Seed a single PETTY_CASH-funded payment of 150 against a 150 purchase.
    // Petty cash starts at 1000, decremented to 850 by seeding.
    const { built, ids } = await seed({ total: 150, payments: [150], sourceType: 'PETTY_CASH' });
    const { state } = built;

    const balBefore = Number(state.pettyCashes['pc-1'].currentBalance); // 850
    expect(balBefore).toBeCloseTo(850, 4);

    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'petty cash void'), res as never);
    expect(res.statusCode).toBe(200);

    // Balance must be restored: 850 + 150 = 1000
    expect(Number(state.pettyCashes['pc-1'].currentBalance)).toBeCloseTo(1000, 4);

    // A RETURN pettyCashTransaction referencing this payment must exist (the
    // store also holds the seeded original EXPENSE line — target RETURN).
    const revTxn = Object.values(state.pettyCashTxns).find(
      (t) => t.relatedType === 'SUPPLIER_PAYMENT' && t.relatedId === ids[0] && t.transactionType === 'RETURN',
    );
    expect(revTxn).toBeTruthy();
    expect(revTxn!.transactionType).toBe('RETURN');
    expect(Number(revTxn!.amount)).toBeCloseTo(150, 4);
    expect(Number(revTxn!.balanceBefore)).toBeCloseTo(850, 4);
    expect(Number(revTxn!.balanceAfter)).toBeCloseTo(1000, 4);
    expect(revTxn!.pettyCashId).toBe('pc-1');

    // GL is also reversed (nets to 0).
    expect(maxAbs(perAccountNet(state.entries, 'SupplierPayment', ids[0]))).toBeCloseTo(0, 4);

    // No bank balance or bankTransaction was touched.
    expect(Object.keys(state.bankTxns).length).toBe(0);
    expect(Number(state.banks['bank-1'].currentBalance)).toBeCloseTo(2000, 4);
  });

  it('pending recompute: voiding the sole payment of a fully-paid purchase reverts status to pending', async () => {
    // Single payment of 200 against a 200 purchase → status is 'paid' after seeding.
    const { built, ids } = await seed({ total: 200, payments: [200] });
    const { state } = built;
    expect(state.purchases['pur-1'].status).toBe('paid');

    const res = fakeRes();
    await voidSupplierPayment(fakeReq(ids[0], USER, 'sole payment void'), res as never);
    expect(res.statusCode).toBe(200);

    // After voiding the only payment, paid sum = 0 → status must revert to 'pending'.
    expect(state.purchases['pur-1'].status).toBe('pending');
    const body = res.body as { success: boolean; data: { total: number; paid: number; remaining: number; status: string } };
    expect(body.data.status).toBe('pending');
    expect(body.data.paid).toBeCloseTo(0, 4);
    expect(body.data.remaining).toBeCloseTo(200, 4);
  });

  // ---------------------------------------------------------------------------
  // Finding 1 REFIX — the false-green killer (supplier / bill_payment side).
  //
  // Reproduces the EXPLAIN flow (applyBillPayment) with REAL data: a PRE-EXISTING
  // imported WITHDRAWAL statement line whose outflow is ALREADY baked into
  // currentBalance, RELABELED with relatedType=SUPPLIER_PAYMENT + relatedId +
  // postedSourceType='SupplierPayment' (explainPosting.ts ~L775). The
  // SupplierPayment has sourceType='BANK' + bankId but movedBankBalance=false.
  //
  // The relabeled line SATISFIES the first fix's "bank line exists" gate, so that
  // gate would have re-incremented currentBalance. The flag gate must NOT touch
  // the register here, while STILL reversing the GL.
  // ---------------------------------------------------------------------------
  it('finding 1 refix: void of an EXPLAIN-flow bill payment does NOT move the register (relabeled imported line present)', async () => {
    const built = buildFakePrisma();
    fake.current = built;
    const { state } = built;
    state.paymentModes['pm-bank'] = { id: 'pm-bank', slug: 'bank-transfer', name: 'Bank Transfer' };
    // currentBalance ALREADY reflects the imported outflow — money already left.
    state.banks['bank-1'] = { id: 'bank-1', userId: USER, currencyCode: 'GBP', currentBalance: '2000' };
    state.purchases['pur-1'] = {
      id: 'pur-1', userId: USER, isDeleted: false,
      totalAmount: '100', status: 'paid', purchaseId: 'PUR-EXPLAIN',
    };
    state.payments['spay-x'] = {
      id: 'spay-x', purchaseId: 'pur-1', paidAmount: '100',
      paymentModeId: 'pm-bank', bankId: 'bank-1', sourceType: 'BANK',
      movedBankBalance: false, // applyBillPayment left it false
      paymentDate: new Date('2026-06-01'), notes: '', createdBy: USER,
      isVoided: false, isDeleted: false, voidedById: null, voidedAt: null, voidReason: null,
    };
    // PRE-EXISTING imported WITHDRAWAL line, RELABELED to this payment.
    state.bankTxns['btx-imported'] = {
      id: 'btx-imported', bankAccountId: 'bank-1', type: 'WITHDRAWAL',
      amount: '100', relatedType: 'SUPPLIER_PAYMENT', relatedId: 'spay-x',
      postedSourceType: 'SupplierPayment', postedSourceId: 'spay-x',
      explainStatus: 'EXPLAINED', isReconciled: true, isDeleted: false,
    };
    // Forward payment GL (Dr AP / Cr BANK) so we can prove the GL reverses.
    await post(built.prisma as never, {
      userId: USER, sourceType: 'SupplierPayment', sourceId: 'spay-x', event: 'payment',
      date: new Date('2026-06-01'), currencyCode: 'BASE',
      instructions: [
        { roleKey: 'AP', side: 'debit', amount: '100' },
        { roleKey: 'BANK', side: 'credit', amount: '100' },
      ],
    });

    const res = fakeRes();
    await voidSupplierPayment(fakeReq('spay-x', USER, 'explain void'), res as never);
    expect(res.statusCode).toBe(200);

    // Register UNCHANGED — not re-incremented by the void.
    expect(Number(state.banks['bank-1'].currentBalance)).toBeCloseTo(2000, 4);
    // No reversing (TRANSFER_IN) bank line was written.
    const reversing = Object.values(state.bankTxns).find(
      (t) => t.relatedId === 'spay-x' && t.type === 'TRANSFER_IN',
    );
    expect(reversing).toBeUndefined();
    // But the GL WAS reversed — the source nets to zero.
    expect(maxAbs(perAccountNet(state.entries, 'SupplierPayment', 'spay-x'))).toBeCloseTo(0, 4);
    expect(state.payments['spay-x'].isVoided).toBe(true);
  });
});
