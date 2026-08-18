// controllers/Admin/Invoice/voidInvoicePayment.spec.ts
// Unit test for the soft-VOID payment endpoint (Task 3, partial-payments).
//
// Uses an in-memory fake Prisma (the ledger harness primitives for the
// journal/mapping/period/settings, plus simple stores for invoice,
// invoicePayment, bankDetail, bankTransaction and paymentMode) so the real
// reverseDocument/reverse posting wrappers run end-to-end with no live DB.
//
// The harness deliberately seeds a LIVE forward (InvoicePayment, <paymentId>,
// 'payment') JournalEntry for each payment so the test FAILS if voidInvoicePayment
// reverses the wrong (sourceType, sourceId, event) triple — reversing a different
// triple leaves the forward entry live and nets the source != 0.

import { describe, it, expect, vi } from 'vitest';
import { getPack } from '../../../lib/ledger/packs/index';

const USER = 'u-void';
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
  const invoices: Record<string, Record<string, unknown>> = {};
  const payments: Record<string, Record<string, unknown>> = {};
  const paymentModes: Record<string, { id: string; slug: string; name: string }> = {};
  const creditNotes: Record<string, Record<string, unknown>> = {};

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
  const invoice = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(invoices).find((r) => matchWhere(r, w)) ?? null;
    },
    async findUnique(args: { where: { id: string } }) { return invoices[args.where.id] ?? null; },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = invoices[args.where.id];
      Object.assign(row, args.data);
      return row;
    },
  };
  const invoicePayment = {
    async findFirst(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      const inc = (args as { include?: Record<string, unknown> }).include;
      const row = Object.values(payments).find((r) => {
        // flat scalar matching
        if (!matchWhere(r, w)) return false;
        // nested invoice scope: { invoice: { userId, isDeleted } }
        const invW = (w as { invoice?: Record<string, unknown> }).invoice;
        if (invW) {
          const inv = invoices[r.invoiceId as string];
          if (!inv || !matchWhere(inv, invW)) return false;
        }
        return true;
      });
      if (!row) return null;
      // hydrate includes
      const out: Record<string, unknown> = { ...row };
      if (inc?.invoice) out.invoice = invoices[row.invoiceId as string] ?? null;
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
        .reduce((s, r) => s + Number(r.amount), 0);
      return { _sum: { amount: sum } };
    },
  };
  const paymentMode = {
    async findUnique(args: { where: { id: string } }) { return paymentModes[args.where.id] ?? null; },
  };

  // creditNote surface — recomputeInvoiceStatus / getInvoiceSettlement net
  // non-deleted CNs into the invoice's outstanding + status (finding 2).
  const creditNote = {
    async findMany(args: unknown) {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return Object.values(creditNotes)
        .filter((r) => matchWhere(r, w))
        .map((r) => ({ invoiceId: r.invoiceId, totalAmount: r.totalAmount }));
    },
  };

  // Account-credit redemption tracking (separate parallel-task model). No test
  // in this file seeds a redemption, so updateMany is a harmless no-op — but it
  // must exist since voidInvoicePayment unconditionally calls it to restore any
  // credit balance a voided payment had redeemed.
  const accountCreditEntry = {
    async updateMany(): Promise<{ count: number }> { return { count: 0 }; },
  };

  const client: Record<string, unknown> = {
    journalEntry, ledgerAccountMapping, accountingPeriod, companySettings,
    bankDetail, bankTransaction, invoice, invoicePayment, paymentMode, creditNote,
    accountCreditEntry,
  };
  client.$transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client);

  return {
    prisma: client,
    state: { entries, banks, bankTxns, invoices, payments, paymentModes, creditNotes },
    nextId,
  };
}

const { fake } = vi.hoisted(() => ({ fake: { current: null as ReturnType<typeof buildFakePrisma> | null } }));

vi.mock('../../../lib/prisma', () => ({
  get prisma() { return fake.current!.prisma; },
}));

// Import AFTER the mock is registered.
import { voidInvoicePayment } from './invoicePaymentController';
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
 * triple. A balanced forward entry alone already nets to 0 in aggregate, so we
 * key by accountId: after a correct reversal EVERY account nets to 0 (forward +
 * mirrored reversal cancel); a missing/mis-targeted reversal leaves a non-zero
 * account balance behind.
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
 * Seed an invoice with TotalAmount and N payments, each carrying a LIVE forward
 * (InvoicePayment, paymentId, 'payment') JournalEntry posted via the real engine
 * (Dr BANK / Cr AR for the payment amount).
 */
async function seed(opts: { total: number; payments: number[] }) {
  const built = buildFakePrisma();
  fake.current = built;
  const { state } = built;

  state.paymentModes['pm-bank'] = { id: 'pm-bank', slug: 'bank-transfer', name: 'Bank Transfer' };

  state.banks['bank-1'] = { id: 'bank-1', userId: USER, currencyCode: 'GBP', currentBalance: '1000' };

  state.invoices['inv-1'] = {
    id: 'inv-1', userId: USER, isDeleted: false,
    TotalAmount: String(opts.total), status: 'UNPAID', invoiceNumber: 'INV-001',
  };

  const tx = built.prisma as never;
  const ids: string[] = [];
  for (let i = 0; i < opts.payments.length; i++) {
    const amount = opts.payments[i];
    const pid = `pay-${i + 1}`;
    ids.push(pid);
    state.payments[pid] = {
      id: pid, invoiceId: 'inv-1', amount: String(amount),
      paymentModeId: 'pm-bank', bankId: 'bank-1',
      // record path moved the bank register at create → reversal must undo it
      movedBankBalance: true,
      received_on: new Date('2026-06-01'), notes: '', received_by: USER,
      isVoided: false, voidedById: null, voidedAt: null, voidReason: null,
    };
    // post the forward payment GL: Dr BANK / Cr AR
    await post(tx, {
      userId: USER, sourceType: 'InvoicePayment', sourceId: pid, event: 'payment',
      date: new Date('2026-06-01'), currencyCode: 'BASE',
      instructions: [
        { roleKey: 'BANK', side: 'debit', amount: String(amount) },
        { roleKey: 'AR', side: 'credit', amount: String(amount) },
      ],
    });
    // bump bank balance to reflect the receipt
    const bal = Number(state.banks['bank-1'].currentBalance);
    state.banks['bank-1'].currentBalance = String(bal + amount);
    // self-authored bank line keyed to this payment (recordInvoicePayment writes
    // this) — the finding-1 discriminator marking this a record-path receipt
    // whose register move must be reversed on void.
    const btxId = `btx-seed-${i + 1}`;
    state.bankTxns[btxId] = {
      id: btxId, bankAccountId: 'bank-1', type: 'TRANSFER_IN',
      amount: String(amount), relatedType: 'INVOICE_PAYMENT', relatedId: pid,
      isDeleted: false,
    };
    // mark invoice paid status
    const paid = Object.values(state.payments)
      .filter((p) => !p.isVoided)
      .reduce((s, p) => s + Number(p.amount), 0);
    state.invoices['inv-1'].status = paid >= opts.total ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  }

  return { built, ids };
}

describe('voidInvoicePayment', () => {
  it('reverses the GL for the EXACT (InvoicePayment, paymentId, payment) triple, nets to 0', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;

    // The forward payment (Dr BANK 100 / Cr AR 100) — before void, BANK & AR each
    // carry a non-zero per-account balance for this source.
    expect(maxAbs(perAccountNet(state.entries, 'InvoicePayment', ids[0]))).toBeGreaterThan(50);

    const res = fakeRes();
    await voidInvoicePayment(fakeReq(ids[0], USER, 'mistake'), res as never);
    expect(res.statusCode).toBe(200);

    // A reversal JE for the EXACT (InvoicePayment, paymentId, payment) triple exists,
    // keyed payment.reversal and linking back to the forward entry.
    const forward = state.entries.find(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === ids[0] && e.event === 'payment',
    );
    expect(forward).toBeTruthy();
    const reversal = state.entries.find(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === ids[0]
        && e.event === 'payment.reversal' && e.reversedById === forward!.id,
    );
    expect(reversal).toBeTruthy();
    // Forward + reversal cancel: EVERY account for this source now nets to ZERO.
    // If the void reversed the wrong triple, no reversal lands here and this fails.
    expect(maxAbs(perAccountNet(state.entries, 'InvoicePayment', ids[0]))).toBeCloseTo(0, 4);
    // The OTHER payment is untouched — no reversal, account balances still non-zero.
    const otherReversal = state.entries.find(
      (e) => e.sourceType === 'InvoicePayment' && e.sourceId === ids[1] && e.event === 'payment.reversal',
    );
    expect(otherReversal).toBeFalsy();
    expect(maxAbs(perAccountNet(state.entries, 'InvoicePayment', ids[1]))).toBeGreaterThan(50);
  });

  it('marks the payment isVoided + voidReason and stamps voidedById/voidedAt', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;

    const res = fakeRes();
    await voidInvoicePayment(fakeReq(ids[0], USER, 'duplicate entry'), res as never);

    const p = state.payments[ids[0]];
    expect(p.isVoided).toBe(true);
    expect(p.voidReason).toBe('duplicate entry');
    expect(p.voidedById).toBe(USER);
    expect(p.voidedAt).toBeInstanceOf(Date);
  });

  it('recomputes invoice status: two payments = total → PAID; void one → PARTIALLY_PAID, remaining > 0', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;
    expect(state.invoices['inv-1'].status).toBe('PAID');

    const res = fakeRes();
    await voidInvoicePayment(fakeReq(ids[0], USER, 'test void'), res as never);

    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; data: { total: number; paid: number; remaining: number; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('PARTIALLY_PAID');
    expect(body.data.paid).toBeCloseTo(100, 4);
    expect(body.data.remaining).toBeCloseTo(100, 4);
    expect(state.invoices['inv-1'].status).toBe('PARTIALLY_PAID');
  });

  it('decrements bank currentBalance by the payment amount and creates a reversing BankTransaction', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    const { state } = built;
    const balBefore = Number(state.banks['bank-1'].currentBalance); // 1000 + 100 + 100 = 1200

    const res = fakeRes();
    await voidInvoicePayment(fakeReq(ids[0], USER, 'test void'), res as never);

    expect(Number(state.banks['bank-1'].currentBalance)).toBeCloseTo(balBefore - 100, 4);

    // Post-void the store holds BOTH the seeded original (TRANSFER_IN) and the
    // reversal — disambiguate to the reversing TRANSFER_OUT row.
    const revTxn = Object.values(state.bankTxns).find(
      (t) => t.relatedType === 'INVOICE_PAYMENT' && t.relatedId === ids[0] && t.type === 'TRANSFER_OUT',
    );
    expect(revTxn).toBeTruthy();
    expect(Number(revTxn!.amount)).toBeCloseTo(100, 4);
    // bank-transfer mode → original was TRANSFER_IN, reversal is TRANSFER_OUT
    expect(revTxn!.type).toBe('TRANSFER_OUT');
    expect(Number(revTxn!.balanceBefore)).toBeCloseTo(balBefore, 4);
    expect(Number(revTxn!.balanceAfter)).toBeCloseTo(balBefore - 100, 4);
  });

  it('finding 2: void a payment on a CREDIT-NOTED invoice nets the CN into status/remaining (not UNPAID/full)', async () => {
    // Invoice 200, one payment 100, plus a 100 credit note → outstanding 0 → PAID.
    const { built, ids } = await seed({ total: 200, payments: [100] });
    const { state } = built;
    state.creditNotes['cn-1'] = {
      id: 'cn-1', userId: USER, isDeleted: false, invoiceId: 'inv-1',
      totalAmount: '100', status: 'ISSUED',
    };

    const res = fakeRes();
    // Void the 100 cash payment. Payment sum alone → 0 paid → the OLD code would
    // report UNPAID / remaining 200. CN-aware: 200 − 0 − 100(CN) = 100 remaining,
    // and 100 has been settled (by the CN) → PARTIALLY_PAID.
    await voidInvoicePayment(fakeReq(ids[0], USER, 'test void'), res as never);
    expect(res.statusCode).toBe(200);

    const body = res.body as { data: { total: number; paid: number; remaining: number; status: string } };
    expect(body.data.status).toBe('PARTIALLY_PAID');
    expect(body.data.remaining).toBeCloseTo(100, 4); // CN-netted, NOT 200
    expect(body.data.paid).toBeCloseTo(0, 4);
    expect(state.invoices['inv-1'].status).toBe('PARTIALLY_PAID');
  });

  it('404s when the payment is not owned by the user', async () => {
    const { ids } = await seed({ total: 200, payments: [100, 100] });
    const res = fakeRes();
    await voidInvoicePayment(fakeReq(ids[0], 'someone-else', 'x'), res as never);
    expect(res.statusCode).toBe(404);
  });

  it('400s when the payment is already voided', async () => {
    const { built, ids } = await seed({ total: 200, payments: [100, 100] });
    built.state.payments[ids[0]].isVoided = true;
    const res = fakeRes();
    await voidInvoicePayment(fakeReq(ids[0], USER, 'x'), res as never);
    expect(res.statusCode).toBe(400);
  });

  it('uses WITHDRAWAL for a cash-mode payment reversal', async () => {
    const built = buildFakePrisma();
    fake.current = built;
    const { state } = built;
    state.paymentModes['pm-cash'] = { id: 'pm-cash', slug: 'cash', name: 'Cash' };
    state.banks['bank-1'] = { id: 'bank-1', userId: USER, currencyCode: 'GBP', currentBalance: '500' };
    state.invoices['inv-1'] = {
      id: 'inv-1', userId: USER, isDeleted: false,
      TotalAmount: '100', status: 'PAID', invoiceNumber: 'INV-002',
    };
    state.payments['pay-c'] = {
      id: 'pay-c', invoiceId: 'inv-1', amount: '100',
      paymentModeId: 'pm-cash', bankId: 'bank-1',
      // record path moved the bank register at create → reversal must undo it
      movedBankBalance: true,
      received_on: new Date('2026-06-01'), notes: '', received_by: USER,
      isVoided: false, voidedById: null, voidedAt: null, voidReason: null,
    };
    // self-authored bank line (record-path discriminator, finding 1)
    state.bankTxns['btx-cash'] = {
      id: 'btx-cash', bankAccountId: 'bank-1', type: 'DEPOSIT',
      amount: '100', relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-c',
      isDeleted: false,
    };
    await post(built.prisma as never, {
      userId: USER, sourceType: 'InvoicePayment', sourceId: 'pay-c', event: 'payment',
      date: new Date('2026-06-01'), currencyCode: 'BASE',
      instructions: [
        { roleKey: 'CASH', side: 'debit', amount: '100' },
        { roleKey: 'AR', side: 'credit', amount: '100' },
      ],
    });

    const res = fakeRes();
    await voidInvoicePayment(fakeReq('pay-c', USER, 'cash void'), res as never);
    expect(res.statusCode).toBe(200);
    const revTxn = Object.values(state.bankTxns).find(
      (t) => t.relatedId === 'pay-c' && t.type === 'WITHDRAWAL',
    );
    expect(revTxn!.type).toBe('WITHDRAWAL');
  });

  // ---------------------------------------------------------------------------
  // Finding 1 REFIX — the false-green killer.
  //
  // Reproduces the bank-reconciliation EXPLAIN flow with REAL data: a
  // PRE-EXISTING imported statement line (the money already sits in
  // currentBalance) that has been RELABELED with relatedType=INVOICE_PAYMENT +
  // relatedId=<paymentId> + postedSourceType='InvoicePayment' — exactly what
  // explainPosting.ts (~L775) stamps onto it. The InvoicePayment carries
  // movedBankBalance=false because applyInvoiceReceipt never moved the register.
  //
  // The FIRST fix gated on "a bank line keyed to this payment exists" — which
  // this relabeled line SATISFIES — so it double-adjusted the register. The flag
  // gate must NOT touch currentBalance here, while STILL reversing the GL.
  // ---------------------------------------------------------------------------
  it('finding 1 refix: void of an EXPLAIN-flow receipt does NOT move the register (relabeled imported line present)', async () => {
    const built = buildFakePrisma();
    fake.current = built;
    const { state } = built;
    state.paymentModes['pm-bank'] = { id: 'pm-bank', slug: 'bank-transfer', name: 'Bank Transfer' };
    // currentBalance ALREADY includes the imported deposit — the money is here.
    state.banks['bank-1'] = { id: 'bank-1', userId: USER, currencyCode: 'GBP', currentBalance: '1000' };
    state.invoices['inv-1'] = {
      id: 'inv-1', userId: USER, isDeleted: false,
      TotalAmount: '100', status: 'PAID', invoiceNumber: 'INV-EXPLAIN',
    };
    // Explain-flow payment: bank + bankId set, but movedBankBalance FALSE.
    state.payments['pay-x'] = {
      id: 'pay-x', invoiceId: 'inv-1', amount: '100',
      paymentModeId: 'pm-bank', bankId: 'bank-1',
      movedBankBalance: false, // applyInvoiceReceipt left it false
      received_on: new Date('2026-06-01'), notes: '', received_by: USER,
      isVoided: false, voidedById: null, voidedAt: null, voidReason: null,
    };
    // The PRE-EXISTING imported statement line, RELABELED by the explain flow to
    // point at this payment (relatedType/relatedId/postedSourceType) — created
    // in an EARLIER import, so its money is already baked into currentBalance.
    state.bankTxns['btx-imported'] = {
      id: 'btx-imported', bankAccountId: 'bank-1', type: 'DEPOSIT',
      amount: '100', relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-x',
      postedSourceType: 'InvoicePayment', postedSourceId: 'pay-x',
      explainStatus: 'EXPLAINED', isReconciled: true, isDeleted: false,
    };
    // Forward payment GL exists (Dr BANK / Cr AR) so we can prove the GL reverses.
    await post(built.prisma as never, {
      userId: USER, sourceType: 'InvoicePayment', sourceId: 'pay-x', event: 'payment',
      date: new Date('2026-06-01'), currencyCode: 'BASE',
      instructions: [
        { roleKey: 'BANK', side: 'debit', amount: '100' },
        { roleKey: 'AR', side: 'credit', amount: '100' },
      ],
    });

    const res = fakeRes();
    await voidInvoicePayment(fakeReq('pay-x', USER, 'explain void'), res as never);
    expect(res.statusCode).toBe(200);

    // Register UNCHANGED — the imported line still owns the money.
    expect(Number(state.banks['bank-1'].currentBalance)).toBeCloseTo(1000, 4);
    // No reversing (TRANSFER_OUT / WITHDRAWAL) bank line was written.
    const reversing = Object.values(state.bankTxns).find(
      (t) => t.relatedId === 'pay-x' && (t.type === 'TRANSFER_OUT' || t.type === 'WITHDRAWAL'),
    );
    expect(reversing).toBeUndefined();
    // But the GL WAS reversed — the source nets to zero.
    expect(maxAbs(perAccountNet(state.entries, 'InvoicePayment', 'pay-x'))).toBeCloseTo(0, 4);
    // Payment marked voided.
    expect(state.payments['pay-x'].isVoided).toBe(true);
  });
});
