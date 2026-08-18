// controllers/reconciliationController.ts
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { trialBalanceFrom, type AccountBalance } from '../lib/ledger/statements';
import { parseAsOf } from '../lib/reports/asOf';

// ---------------------------------------------------------------------------
// GL account balance loader — mirrors the one in financialStatementsController.
// Aggregates base debit/credit per account from posted journal lines up to asOf.
// ---------------------------------------------------------------------------
/** AccountBalance plus parentId, so reconciliation can roll per-bank sub-accounts
 *  up to their BANK/CASH control parent (A2). */
type AccountBalanceWithParent = AccountBalance & { parentId: string | null };

async function loadAccountBalances(userId: string, asOf: Date): Promise<AccountBalanceWithParent[]> {
  const accounts = await prisma.account.findMany({
    where: { userId, isDeleted: false },
    include: {
      journalLines: {
        where: {
          journalEntry: { userId, isDeleted: false, entryDate: { lte: asOf } },
        },
        select: { baseDebit: true, baseCredit: true },
      },
      roleMappings: { select: { roleKey: true } },
    },
    orderBy: { code: 'asc' },
  });
  return accounts.map((a) => {
    const debit = a.journalLines.reduce((s, l) => s.plus(l.baseDebit), new Prisma.Decimal(0));
    const credit = a.journalLines.reduce((s, l) => s.plus(l.baseCredit), new Prisma.Decimal(0));
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      parentId: a.parentId ?? null,
      debit: debit.toString(),
      credit: credit.toString(),
      role: a.roleMappings[0]?.roleKey ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// GL balance helpers — same sign conventions as statements.ts
//   AR (ASSET role): debit-normal → net = debit - credit
//   AP (LIABILITY role): credit-normal → net = credit - debit
//   BANK (ASSET role): debit-normal → net = debit - credit
// ---------------------------------------------------------------------------
function glNet(a: AccountBalance): number {
  const d = Number(a.debit);
  const c = Number(a.credit);
  // ASSET + EXPENSE: debit-normal; LIABILITY + EQUITY + INCOME: credit-normal
  if (a.accountType === 'ASSET' || a.accountType === 'EXPENSE') return d - c;
  return c - d;
}

function sumByRole(accounts: AccountBalance[], role: string): number {
  return accounts
    .filter((a) => a.role === role)
    .reduce((s, a) => s + glNet(a), 0);
}

/**
 * Combined GL bank+cash balance INCLUDING per-bank sub-accounts (A2).
 *
 * Bank legs now post to BankDetail.accountId — a child Account nested under the
 * BANK control account. Those children carry no role mapping, so a plain
 * sumByRole('BANK') would miss them. We therefore roll up: start from the
 * BANK/CASH role accounts (the control parents) and include every account whose
 * parent chain leads to one of them. The signed contribution uses each account's
 * own normal side (glNet) — children share the parent's ASSET type, so the sum
 * equals the parent rollup and the trial balance is unaffected.
 */
function sumBankCashWithChildren(accounts: AccountBalanceWithParent[]): number {
  const roots = new Set(
    accounts.filter((a) => a.role === 'BANK' || a.role === 'CASH').map((a) => a.id),
  );
  if (roots.size === 0) return 0;
  const byId = new Map(accounts.map((a) => [a.id, a]));

  // An account is "in scope" if itself or any ancestor is a BANK/CASH root.
  const inScope = (a: AccountBalanceWithParent): boolean => {
    let cur: AccountBalanceWithParent | undefined = a;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (roots.has(cur.id)) return true;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  return accounts.filter(inScope).reduce((s, a) => s + glNet(a), 0);
}

const TALLY_TOLERANCE = 0.01;
function tied(diff: number): boolean {
  return Math.abs(diff) < TALLY_TOLERANCE;
}

// ---------------------------------------------------------------------------
// Open invoices sub-ledger: Σ (TotalAmount − Σ non-voided payments)
// for invoices that are UNPAID / PARTIALLY_PAID / OVERDUE / SENT.
//
// Same canonical query as agingController.arAging / balanceSheet receivables —
// EXCEPT everything is date-filtered to asOf so the outstanding figure is
// point-in-time-correct for a back-dated asOf:
//  - invoiceDate <= asOf
//  - payments received_on <= asOf
//  - status is NOT gated on the current value: an invoice now PAID may have
//    been fully outstanding at asOf (its cash landed later), and the GL AR
//    control — filtered by entryDate <= asOf — still carries it. Gating on the
//    live status here would drop it and manufacture a false AR mismatch. We
//    drop only DRAFT (never posts to AR) and CANCELLED (reversed), then keep
//    rows whose as-of outstanding is positive.
// For the default asOf=today this is identical to ar-aging; they diverge only
// for a historical asOf where a payment landed afterwards (intentional — a rec
// is a point-in-time statement).
// ---------------------------------------------------------------------------
async function openInvoicesTotal(userId: string, asOf: Date): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      isDeleted: false,
      invoiceType: 'INVOICE',
      invoiceDate: { lte: asOf },
      status: { notIn: ['DRAFT', 'CANCELLED'] },
    },
    select: {
      TotalAmount: true,
      payments: {
        where: { isVoided: false, received_on: { lte: asOf } },
        select: { amount: true },
      },
    },
  });

  let total = new Prisma.Decimal(0);
  for (const inv of invoices) {
    const gross = new Prisma.Decimal(inv.TotalAmount?.toString() ?? '0');
    const paid = inv.payments.reduce(
      (s, p) => s.plus(new Prisma.Decimal(p.amount?.toString() ?? '0')),
      new Prisma.Decimal(0),
    );
    const outstanding = gross.minus(paid);
    if (outstanding.greaterThan(0)) total = total.plus(outstanding);
  }
  return Number(total.toFixed(4));
}

// ---------------------------------------------------------------------------
// Unrefunded credit-note AR: Σ totalAmount for credit notes that sit in AR.
//
// GL posting reality:
//   Issuance  : Dr SALES_RETURNS / Cr AR  → AR balance reduced by totalAmount
//   Refund    : Dr AR / Cr BANK           → AR balance restored by totalAmount
//
// So the AR control includes a negative contribution for each credit note that
// has been issued but not yet cash-refunded. A credit note leaves AR only when
// its cash refund is posted (event='refund' on the CreditNote JE). We detect
// that by checking whether a non-deleted JournalEntry with sourceType='CreditNote',
// sourceId=cn.id, event='refund', entryDate<=asOf exists.
//
// CANCELLED credit notes: if a credit note is CANCELLED its 'issued' JE is
// reversed (the reversal re-debits AR), so it no longer reduces GL AR. We
// therefore exclude CANCELLED credit notes from the AR subledger deduction.
// ---------------------------------------------------------------------------
async function openCreditNotesAr(userId: string, asOf: Date): Promise<number> {
  const creditNotes = await prisma.creditNote.findMany({
    where: {
      userId,
      isDeleted: false,
      status: { not: 'CANCELLED' },
      creditNoteDate: { lte: asOf },
    },
    select: {
      id: true,
      totalAmount: true,
    },
  });

  if (creditNotes.length === 0) return 0;

  // Find which credit notes have already been cash-refunded (Dr AR / Cr Bank)
  // by checking for a 'refund' journal entry posted on or before asOf.
  const refundedIds = new Set<string>();
  const refundJEs = await prisma.journalEntry.findMany({
    where: {
      userId,
      isDeleted: false,
      sourceType: 'CreditNote',
      sourceId: { in: creditNotes.map((cn) => cn.id) },
      event: 'refund',
      entryDate: { lte: asOf },
    },
    select: { sourceId: true },
  });
  for (const je of refundJEs) {
    if (je.sourceId) refundedIds.add(je.sourceId);
  }

  // Sum unrefunded credit note amounts
  let total = new Prisma.Decimal(0);
  for (const cn of creditNotes) {
    if (!refundedIds.has(cn.id)) {
      total = total.plus(new Prisma.Decimal(cn.totalAmount?.toString() ?? '0'));
    }
  }
  return Number(total.toFixed(4));
}

// ---------------------------------------------------------------------------
// Open bills sub-ledger: Σ outstanding purchase balance AS-OF asOf.
//
// balanceAmount is the CURRENT balance (totalAmount − Σ payments). To make it
// point-in-time we ADD BACK supplier payments made after asOf, so a bill settled
// after asOf still shows as open — matching the GL AP control, which is filtered
// by entryDate <= asOf. Gating on the current balanceAmount>0 would drop a
// now-settled bill that was open at asOf and manufacture a false AP mismatch.
// Cancelled bills are excluded (they never sit in AP). purchaseDate <= asOf.
// ---------------------------------------------------------------------------
async function openBillsTotal(userId: string, asOf: Date): Promise<number> {
  const purchases = await prisma.purchase.findMany({
    where: {
      userId,
      isDeleted: false,
      status: { not: 'cancelled' },
      purchaseDate: { lte: asOf },
    },
    select: {
      balanceAmount: true,
      supplierPayments: {
        where: { isVoided: false, paymentDate: { gt: asOf } },
        select: { amount: true },
      },
    },
  });

  let total = new Prisma.Decimal(0);
  for (const p of purchases) {
    const laterPaid = p.supplierPayments.reduce(
      (s, sp) => s.plus(new Prisma.Decimal(sp.amount?.toString() ?? '0')),
      new Prisma.Decimal(0),
    );
    const outstanding = new Prisma.Decimal(p.balanceAmount?.toString() ?? '0').plus(laterPaid);
    if (outstanding.greaterThan(0)) total = total.plus(outstanding);
  }
  return Number(total.toFixed(4));
}

// ---------------------------------------------------------------------------
// Bank sub-ledger: per BankDetail, compare GL balance vs currentBalance
// vs Σ EXPLAINED (non-deleted) bank transactions.
//
// Sign convention for BankTransactionType:
//   Money-in  (positive): DEPOSIT, RECEIPT, TRANSFER_IN
//   Money-out (negative): WITHDRAWAL, PAYMENT, TRANSFER_OUT
//
// sumExplained = openingBalance + Σ signed transaction amounts
// currentVsExplainedTied = currentBalance vs sumExplained (real per-account check)
//
// v1 GL-matching limitation:
//   BankDetail has no FK to Account, so we cannot match GL balances per bank
//   account. We put the combined GL BANK+CASH balance on the first row only.
//   Non-first rows have glMatchAvailable=false and no GL-based tie is asserted.
//   The currentVsExplainedTied check (book vs explained) IS per-account and real.
//
// v2 caveats (single-currency single-bank installs are fully accurate today):
//   - BankDetail.currencyCode may differ from the company base currency; the
//     book/explained sums are in account currency while the GL balance is base
//     currency, so a foreign-currency bank row is an apples-to-oranges compare.
// ---------------------------------------------------------------------------
interface BankRow {
  bankAccountId: string;
  name: string;
  /** A2: the per-bank GL sub-account (BankDetail.accountId), when linked. */
  accountId: string | null;
  /** True when a real per-bank GL balance is available:
   *   - A2 (preferred): this bank has its own accountId → ledgerBalance is the
   *     signed Σ JournalLine for that account (always valid, any bank count).
   *   - v1 fallback: exactly one bank with NO accountId → the combined GL
   *     BANK+CASH balance is attributed to that single row. */
  glMatchAvailable: boolean;
  glBalance: number;         // only meaningful when glMatchAvailable=true
  /** A2: signed GL balance of this bank's own accountId (null when un-linked). */
  ledgerBalance: number | null;
  currentBalance: number;
  /** openingBalance + Σ signed EXPLAINED bank-txn amounts (the per-account book). */
  sumExplained: number;
  currentVsExplainedTied: boolean; // real per-account: currentBalance vs sumExplained
  glVsCurrentTied: boolean | null; // null when glMatchAvailable=false
  glVsExplainedTied: boolean | null; // null when glMatchAvailable=false
  /** A2: ledgerBalance − sumExplained for linked banks (the reconciling difference). */
  glVsExplainedDiff: number | null;
  tied: boolean | null;      // null when GL match not available for this row
}

/** Aggregate cross-bank GL check (the only honest GL comparison for multi-bank). */
interface BankAggregate {
  glTotal: number;           // Σ GL BANK + CASH accounts
  currentTotal: number;      // Σ currentBalance across all banks
  explainedTotal: number;    // Σ sumExplained across all banks
  glVsCurrentDiff: number;
  glVsExplainedDiff: number;
  glVsCurrentTied: boolean;
  glVsExplainedTied: boolean;
  perBankGlAvailable: boolean; // false for multi-bank (honest), true for single-bank
}

const MONEY_OUT_TYPES = new Set(['WITHDRAWAL', 'PAYMENT', 'TRANSFER_OUT']);

async function bankRows(
  userId: string,
  accounts: AccountBalanceWithParent[],
  asOf: Date,
): Promise<{ rows: BankRow[]; aggregate: BankAggregate }> {
  const banks = await prisma.bankDetail.findMany({
    where: { userId, isDeleted: false },
    select: {
      id: true,
      bankName: true,
      accountId: true,
      currentBalance: true,
      openingBalance: true,
      bankTransactions: {
        where: {
          isDeleted: false,
          explainStatus: 'EXPLAINED',
          transactionDate: { lte: asOf },
        },
        select: { type: true, amount: true },
      },
    },
  });

  // Total combined GL BANK+CASH balance, rollup-aware so per-bank sub-accounts
  // (BankDetail.accountId children) are included — see sumBankCashWithChildren.
  const totalGlBank = sumBankCashWithChildren(accounts);

  // A2: per-bank GL attribution via BankDetail.accountId. Index the GL account
  // balances by id so a linked bank can read its OWN signed ledger balance.
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // v1 fallback: a per-row GL match for an UN-LINKED bank is only valid when
  // there is exactly ONE bank with no accountId (the single bank IS the GL bank
  // account). For N>1 unlinked banks we cannot attribute the combined GL balance.
  const unlinkedBanks = banks.filter((b) => !b.accountId);
  const singleUnlinkedBank = unlinkedBanks.length === 1;

  const rows: BankRow[] = banks.map((b) => {
    const currentBal = Number(new Prisma.Decimal(b.currentBalance?.toString() ?? '0').toFixed(4));

    // Sum explained transactions using signed amounts. Accumulate in
    // Prisma.Decimal (not float) so many transactions don't drift — same
    // discipline as openInvoicesTotal/openBillsTotal.
    // sumExplained = openingBalance + Σ signed EXPLAINED amounts.
    let explainedDec = new Prisma.Decimal(b.openingBalance?.toString() ?? '0');
    for (const tx of b.bankTransactions) {
      const amt = new Prisma.Decimal(tx.amount?.toString() ?? '0');
      explainedDec = MONEY_OUT_TYPES.has(tx.type)
        ? explainedDec.minus(amt)
        : explainedDec.plus(amt);
    }
    const explainedNet = Number(explainedDec.toFixed(4));

    // Real per-account check: currentBalance vs sumExplained (no GL needed)
    const currentVsExplained = currentBal - explainedNet;
    const cveTied = tied(currentVsExplained);

    // A2: when this bank has its own GL sub-account, its signed balance IS the
    // per-bank ledger balance (Dr−Cr for the ASSET-normal sub-account). This is
    // valid for ANY bank count — the real per-account tie-out.
    const ownAccount = b.accountId ? accountById.get(b.accountId) ?? null : null;
    const ledgerBalance = ownAccount ? glNet(ownAccount) : null;

    let glMatchAvailable: boolean;
    let glBal: number;
    if (ledgerBalance !== null) {
      // Linked bank: real per-account GL balance.
      glMatchAvailable = true;
      glBal = ledgerBalance;
    } else if (singleUnlinkedBank && unlinkedBanks[0]?.id === b.id) {
      // Un-linked single-bank fallback (legacy behaviour, no accountId).
      glMatchAvailable = true;
      glBal = totalGlBank;
    } else {
      glMatchAvailable = false;
      glBal = 0;
    }

    const glVsCurrent = glMatchAvailable ? glBal - currentBal : null;
    const glVsExplained = glMatchAvailable ? glBal - explainedNet : null;

    return {
      bankAccountId: b.id,
      name: b.bankName,
      accountId: b.accountId ?? null,
      glMatchAvailable,
      glBalance: glBal,
      ledgerBalance,
      currentBalance: currentBal,
      sumExplained: explainedNet,
      currentVsExplainedTied: cveTied,
      glVsCurrentTied: glVsCurrent !== null ? tied(glVsCurrent) : null,
      glVsExplainedTied: glVsExplained !== null ? tied(glVsExplained) : null,
      glVsExplainedDiff: glVsExplained !== null ? Number(glVsExplained.toFixed(4)) : null,
      tied: glMatchAvailable
        ? (tied(glVsCurrent as number) && tied(glVsExplained as number))
        : null,
    };
  });

  // Aggregate: Σ GL vs Σ currentBalance vs Σ sumExplained.
  // This is the honest cross-bank GL check regardless of bank count.
  const currentTotal = rows.reduce((s, r) => s + r.currentBalance, 0);
  const explainedTotal = rows.reduce((s, r) => s + r.sumExplained, 0);
  const glVsCurrentDiff = Number((totalGlBank - currentTotal).toFixed(4));
  const glVsExplainedDiff = Number((totalGlBank - explainedTotal).toFixed(4));

  const aggregate: BankAggregate = {
    glTotal: totalGlBank,
    currentTotal,
    explainedTotal,
    glVsCurrentDiff,
    glVsExplainedDiff,
    glVsCurrentTied: tied(glVsCurrentDiff),
    glVsExplainedTied: tied(glVsExplainedDiff),
    // True when every bank row has a real per-bank GL balance (A2: all banks
    // linked to their own accountId, or the legacy single-unlinked-bank case).
    perBankGlAvailable: rows.length > 0 && rows.every((r) => r.glMatchAvailable),
  };

  return { rows, aggregate };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function tallyCheck(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const asOf = parseAsOf(req.query.asOf);

    // 1. GL account balances (all accounts up to asOf)
    const accounts = await loadAccountBalances(userId, asOf);

    // 2. Trial balance
    const tb = trialBalanceFrom(accounts);

    // 3. AR: GL control vs sub-ledger (open invoices − unrefunded credit notes)
    //
    // GL AR = invoices in AR − credit notes sitting in AR (issued, not yet refunded).
    // The subledger must net the same two components to tie to the GL control.
    const arGl = sumByRole(accounts, 'AR');
    const arOpenInvoices = await openInvoicesTotal(userId, asOf);
    const arOpenCreditNotes = await openCreditNotesAr(userId, asOf);
    const arSubledger = Number((arOpenInvoices - arOpenCreditNotes).toFixed(4));
    const arDiff = Number((arGl - arSubledger).toFixed(4));

    // 4. AP: GL control vs sub-ledger open bills
    const apGl = sumByRole(accounts, 'AP');
    const apSubledger = await openBillsTotal(userId, asOf);
    const apDiff = Number((apGl - apSubledger).toFixed(4));

    // 5. Bank: per-account comparison + aggregate GL check
    const { rows: bankRowsData, aggregate: bankAggregate } = await bankRows(userId, accounts, asOf);

    // 6. Overall tied (honest: only count checks we actually performed)
    const arTied = tied(arDiff);
    const apTied = tied(apDiff);
    // Per-account book-vs-explained check is real for all rows
    const allCurrentVsExplainedTied = bankRowsData.every((b) => b.currentVsExplainedTied);
    // bankGlFullyMatched: true only if every bank row has a GL match (v1: only single-bank)
    const bankGlFullyMatched = bankRowsData.every((b) => b.glMatchAvailable);
    // overallTied: TB balanced + AR + AP + all per-row book checks + aggregate GL-vs-current
    // The aggregate is the correct GL check for any bank count (single or multi).
    const overallTied =
      tb.balanced &&
      arTied &&
      apTied &&
      allCurrentVsExplainedTied &&
      bankAggregate.glVsCurrentTied;

    res.json({
      success: true,
      data: {
        asOf: asOf.toISOString(),
        trialBalance: {
          totalDebit: tb.totals.debit,
          totalCredit: tb.totals.credit,
          balanced: tb.balanced,
        },
        ar: {
          glControl: arGl,
          subledgerOpenInvoices: arOpenInvoices,
          subledgerOpenCreditNotes: arOpenCreditNotes,
          subledgerNet: arSubledger,
          diff: arDiff,
          tied: arTied,
        },
        ap: {
          glControl: apGl,
          subledgerOpenBills: apSubledger,
          diff: apDiff,
          tied: apTied,
        },
        bank: bankRowsData,
        bankAggregate,
        bankGlFullyMatched,
        overallTied,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('tallyCheck error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute tally check' });
  }
}

const handlers = { tallyCheck };
module.exports = handlers;
module.exports.default = handlers;
