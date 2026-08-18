// lib/ledger/cutover.ts
import { toDecimal, ZERO } from './money';
import { post } from './postingEngine';
import { LedgerError } from './buildLines';
import type { LineInstruction } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpeningSummary {
  bank: string;
  cash: string;
  ar: string;
  inventory: string;
  ap: string;
}

export interface CutoverTx {
  companySettings: {
    findFirst: (args: unknown) => Promise<{ id: string; ledgerInitialized: boolean; functionalCurrency: string | null; goLiveDate: Date | null } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  bankDetail: { findMany: (args: unknown) => Promise<{ id: string; openingBalance: unknown; currentBalance: unknown; accountType?: string | null }[]> };
  /** Latest running balance (balanceAfter) at/before asOf, per bank account. */
  bankTransaction: { findFirst: (args: unknown) => Promise<{ balanceAfter: unknown } | null> };
  /** PettyCash is tenant-scoped by userId (added in Task 2). */
  pettyCash: { findFirst: (args: unknown) => Promise<{ id: string; openingBalance: unknown; currentBalance: unknown } | null> };
  pettyCashTransaction: { findFirst: (args: unknown) => Promise<{ balanceAfter: unknown } | null> };
  invoice: { findMany: (args: unknown) => Promise<{ TotalAmount: unknown; payments: { amount: unknown }[] }[]> };
  purchase: { findMany: (args: unknown) => Promise<{ totalAmount: unknown; supplierPayments: { amount: unknown }[] }[]> };
  creditNote: { findMany: (args: unknown) => Promise<{ totalAmount: unknown }[]> };
  inventory: { findMany: (args: unknown) => Promise<{ quantityOnHand: unknown; avgCost: unknown }[]> };
  ledgerAccountMapping: { findMany: (args: unknown) => Promise<{ roleKey: string; accountId: string }[]> };
  accountingPeriod: { findFirst: (args: unknown) => Promise<unknown> };
  journalEntry: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string }>;
  };
}

export interface CutoverPreview {
  summary: OpeningSummary;
  lines: LineInstruction[];
  balanced: boolean;
  asOf: string;
}

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

const isPos = (v: string): boolean => toDecimal(v).greaterThan(0);

/** Build a balanced opening journal: assets debit, liabilities credit,
 *  residual equity to OPENING_BALANCE_EQUITY. Zero lines omitted. */
export function buildOpeningInstructions(s: OpeningSummary): LineInstruction[] {
  const lines: LineInstruction[] = [];
  if (isPos(s.bank)) lines.push({ roleKey: 'BANK', side: 'debit', amount: s.bank });
  if (isPos(s.cash)) lines.push({ roleKey: 'CASH', side: 'debit', amount: s.cash });
  if (isPos(s.ar)) lines.push({ roleKey: 'AR', side: 'debit', amount: s.ar });
  if (isPos(s.inventory)) lines.push({ roleKey: 'INVENTORY', side: 'debit', amount: s.inventory });
  if (isPos(s.ap)) lines.push({ roleKey: 'AP', side: 'credit', amount: s.ap });

  const assets = toDecimal(s.bank).plus(s.cash).plus(s.ar).plus(s.inventory);
  const equity = assets.minus(toDecimal(s.ap)); // net worth brought forward
  if (equity.greaterThan(0)) {
    lines.push({ roleKey: 'OPENING_BALANCE_EQUITY', side: 'credit', amount: equity.toString() });
  } else if (equity.lessThan(0)) {
    lines.push({ roleKey: 'OPENING_BALANCE_EQUITY', side: 'debit', amount: equity.abs().toString() });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dec = (v: unknown): import('@prisma/client').Prisma.Decimal => toDecimal((v ?? 0) as never);

function priorDay(d: Date): Date { return new Date(d.getTime() - 24 * 60 * 60 * 1000); }

async function loadSettings(tx: CutoverTx, userId: string) {
  const s = await tx.companySettings.findFirst({ where: { userId } });
  if (!s || !s.goLiveDate) throw new LedgerError('ledger not configured (run country setup first)');
  return s;
}

// ---------------------------------------------------------------------------
// computeOpeningSummary
// ---------------------------------------------------------------------------

/**
 * Build a point-in-time opening snapshot AS OF `asOf` (the day before go-live).
 *
 * Every figure must reflect the world at end-of-`asOf`, not at commit time —
 * cutover is often committed days after go-live, and any document dated between
 * `asOf` and commit is already captured by the live ledger. Counting it again in
 * the opening entry would double-count. Concretely:
 *   - bank/petty: latest stored running balance (`balanceAfter`) at/before asOf,
 *     falling back to the account's openingBalance when no txn precedes asOf.
 *   - AR: open invoice balances at asOf, using ONLY payments received ≤ asOf,
 *     net of open (PENDING) credit notes dated ≤ asOf and customer overpayments.
 *   - AP: open purchase balances using ONLY supplier payments made ≤ asOf.
 *
 * INVENTORY LIMITATION: there is no dated stock-movement ledger — `Inventory`
 * stores only a current WAC balance and `InventoryCostLayer.qtyRemaining` is
 * mutated as layers are consumed, so historical qty/value at a past date cannot
 * be reconstructed. Opening inventory therefore uses the CURRENT WAC value; it is
 * accurate only when cutover is committed on/near go-live. Documented as-of gap.
 */
export async function computeOpeningSummary(tx: CutoverTx, userId: string, asOf: Date): Promise<OpeningSummary> {
  // --- Bank: as-of running balance per account -----------------------------
  const banks = await tx.bankDetail.findMany({
    where: { userId, isDeleted: false },
    select: { id: true, openingBalance: true, currentBalance: true },
  });
  let bank = ZERO;
  for (const b of banks) {
    const last = await tx.bankTransaction.findFirst({
      where: { bankAccountId: b.id, isDeleted: false, transactionDate: { lte: asOf } },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      select: { balanceAfter: true },
    });
    bank = bank.plus(last ? dec(last.balanceAfter) : dec(b.openingBalance));
  }

  // --- Petty cash: as-of running balance (tenant-scoped by userId) ----------
  const petty = await tx.pettyCash.findFirst({
    where: { userId },
    select: { id: true, openingBalance: true, currentBalance: true },
  });
  let cash = ZERO;
  if (petty) {
    const last = await tx.pettyCashTransaction.findFirst({
      where: { pettyCashId: petty.id, isDeleted: false, transactionDate: { lte: asOf } },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      select: { balanceAfter: true },
    });
    cash = last ? dec(last.balanceAfter) : dec(petty.openingBalance);
  }

  // --- AR: open invoices at asOf, payments date-filtered to ≤ asOf ----------
  const invoices = await tx.invoice.findMany({
    where: { userId, isDeleted: false, invoiceType: 'INVOICE', invoiceDate: { lte: asOf } },
    select: { TotalAmount: true, payments: { where: { isVoided: false, received_on: { lte: asOf } }, select: { amount: true } } },
  });
  let grossAr = ZERO;
  let overpayCredits = ZERO; // customer advances from invoices paid > total as of asOf
  for (const i of invoices) {
    const paid = i.payments.reduce((p, x) => p.plus(dec(x.amount)), ZERO);
    const bal = dec(i.TotalAmount).minus(paid);
    if (bal.greaterThan(0)) grossAr = grossAr.plus(bal);
    else if (bal.lessThan(0)) overpayCredits = overpayCredits.plus(bal.abs());
  }

  // Open credit notes (PENDING = credit still sitting against the customer),
  // dated ≤ asOf, reduce net AR. Refunded/cancelled CNs are excluded.
  const creditNotes = await tx.creditNote.findMany({
    where: { userId, isDeleted: false, status: 'PENDING', creditNoteDate: { lte: asOf } },
    select: { totalAmount: true },
  });
  const openCredits = creditNotes.reduce((a, c) => a.plus(dec(c.totalAmount)), ZERO);

  let ar = grossAr.minus(overpayCredits).minus(openCredits);
  if (ar.lessThan(0)) ar = ZERO; // net customer-credit position beyond AR is out of scope for the opening asset

  // --- AP: open purchases at asOf, supplier payments date-filtered to ≤ asOf -
  const purchases = await tx.purchase.findMany({
    where: { userId, isDeleted: false, purchaseDate: { lte: asOf } },
    select: {
      totalAmount: true,
      supplierPayments: { where: { isVoided: false, isDeleted: false, paymentDate: { lte: asOf } }, select: { amount: true } },
    },
  });
  const ap = purchases.reduce((a, p) => {
    const paid = p.supplierPayments.reduce((s, x) => s.plus(dec(x.amount)), ZERO);
    const bal = dec(p.totalAmount).minus(paid);
    return bal.greaterThan(0) ? a.plus(bal) : a;
  }, ZERO);

  // --- Inventory: CURRENT WAC value (as-of not reconstructable; see docstring)
  const inv = await tx.inventory.findMany({
    where: { userId, isDeleted: false },
    select: { quantityOnHand: true, avgCost: true },
  });
  const inventory = inv.reduce((a, r) => a.plus(dec(r.quantityOnHand).times(dec(r.avgCost))), ZERO);

  return {
    bank: bank.toString(),
    cash: cash.toString(),
    ar: ar.toString(),
    inventory: inventory.toString(),
    ap: ap.toString(),
  };
}

// ---------------------------------------------------------------------------
// previewCutover
// ---------------------------------------------------------------------------

export async function previewCutover(tx: CutoverTx, userId: string): Promise<CutoverPreview> {
  const s = await loadSettings(tx, userId);
  const asOf = priorDay(s.goLiveDate!);
  const summary = await computeOpeningSummary(tx, userId, asOf);
  const lines = buildOpeningInstructions(summary);
  return { summary, lines, balanced: true, asOf: asOf.toISOString() };
}

// ---------------------------------------------------------------------------
// commitCutover
// ---------------------------------------------------------------------------

export async function commitCutover(tx: CutoverTx, userId: string): Promise<{ id: string } | null> {
  const s = await loadSettings(tx, userId);

  // Idempotency: one opening entry per tenant. Ensure ledgerInitialized is set
  // true on EVERY commit call (even the early-return path) so a prior partial
  // failure that left the flag false can be repaired by re-running commit.
  const existing = await tx.journalEntry.findFirst({
    where: { userId, sourceType: 'Cutover', event: 'opening', isDeleted: false },
  });
  if (existing) {
    await tx.companySettings.update({ where: { id: s.id }, data: { ledgerInitialized: true } });
    return existing;
  }

  const asOf = priorDay(s.goLiveDate!);
  const summary = await computeOpeningSummary(tx, userId, asOf);
  const instructions = buildOpeningInstructions(summary);

  let entry: { id: string } | null = null;
  if (instructions.length > 0) {
    // post() directly — bypasses the cutover gate intentionally (opening entry
    // predates go-live by design; the gate checks ledgerInitialized, not date).
    entry = await post(tx as never, {
      userId,
      sourceType: 'Cutover',
      sourceId: userId,
      event: 'opening',
      date: asOf,
      currencyCode: s.functionalCurrency ?? 'BASE',
      description: 'Opening balances (cutover)',
      isOpeningBalance: true,
      instructions,
    });
  }

  await tx.companySettings.update({ where: { id: s.id }, data: { ledgerInitialized: true } });
  return entry;
}
