// lib/ledger/buildLines.ts
import { toDecimal, sumDecimals, ZERO } from './money';
import type { BuiltLine, LineInstruction, PostingInput } from './types';

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export class PeriodLockedError extends LedgerError {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodLockedError';
  }
}

export type AccountResolver = (roleKey?: string, accountId?: string) => string;

const fmt = (d: ReturnType<typeof toDecimal>): string => d.toFixed(4);

/** Per-line working record: the built line plus the decimals needed to
 *  compute (and, when necessary, absorb) the base-currency rounding residual. */
interface WorkLine {
  line: BuiltLine;
  amount: ReturnType<typeof toDecimal>;
  base: ReturnType<typeof toDecimal>; // rounded to 4dp
  isDebit: boolean;
}

export function buildLines(input: PostingInput, resolve: AccountResolver): BuiltLine[] {
  if (!input.instructions.length) {
    throw new LedgerError('posting has no instructions');
  }
  const rate = toDecimal(input.exchangeRate ?? 1);

  const work: WorkLine[] = input.instructions.map((ins: LineInstruction) => {
    if (!ins.roleKey && !ins.accountId) {
      throw new LedgerError('instruction needs roleKey or accountId');
    }
    if (ins.roleKey && ins.accountId) {
      throw new LedgerError('instruction has both roleKey and accountId');
    }
    const amount = toDecimal(ins.amount);
    if (amount.isNegative()) {
      throw new LedgerError('instruction amount must be >= 0');
    }
    // baseAmount override: when supplied, use it directly as the functional-
    // currency value for this leg (required for FX settlement legs where
    // AR/AP are relieved at the original document rate and cash at the payment
    // rate). A leg with amount=0 and a nonzero baseAmount is valid (FX adj leg).
    const baseAmtRaw =
      ins.baseAmount != null ? toDecimal(ins.baseAmount) : amount.times(rate);
    if (baseAmtRaw.isNegative()) {
      throw new LedgerError('instruction baseAmount must be >= 0');
    }
    // Round each leg's base to the 4dp the engine persists. Independent rounding
    // of the sum-side leg vs the component legs can leave a half-ulp split (see
    // the residual reconciliation below).
    const baseAmt = toDecimal(fmt(baseAmtRaw));
    // Stored per-line exchangeRate: reconstruct from base/foreign ratio.
    // When foreign amount is 0 (FX adjustment leg), fall back to the entry rate.
    const lineRate = amount.greaterThan(ZERO) ? baseAmt.dividedBy(amount) : rate;
    const isDebit = ins.side === 'debit';
    return {
      amount,
      base: baseAmt,
      isDebit,
      line: {
        accountId: resolve(ins.roleKey, ins.accountId),
        debit: fmt(isDebit ? amount : ZERO),
        credit: fmt(isDebit ? ZERO : amount),
        currencyCode: input.currencyCode,
        exchangeRate: lineRate.toFixed(8),
        baseDebit: fmt(isDebit ? baseAmt : ZERO),
        baseCredit: fmt(isDebit ? ZERO : baseAmt),
        taxRoleKey: ins.taxRoleKey ?? null,
        description: ins.description ?? null,
      },
    };
  });

  const totalDebit = sumDecimals(work.filter((w) => w.isDebit).map((w) => w.base));
  const totalCredit = sumDecimals(work.filter((w) => !w.isDebit).map((w) => w.base));
  const residual = totalDebit.minus(totalCredit); // 4dp; +ve → debits exceed credits

  if (!residual.isZero()) {
    // Each leg's independent 4dp rounding can drift by at most half a ulp, so the
    // debit/credit sums can differ by at most (nLines × 1 ulp). A residual within
    // that bound is a pure rounding artifact and is absorbed into the largest-base
    // leg — keeping the difference inside the document's own control account
    // (AR/AP) where it is immaterial, and mirroring how the payment posts derive
    // their FX residual from already-rounded legs so the entry balances by
    // construction. Anything larger is a genuine imbalance and still throws.
    const tolerance = toDecimal(work.length).times('0.0001');
    if (residual.abs().greaterThan(tolerance)) {
      throw new LedgerError(
        `unbalanced entry: baseDebit ${totalDebit.toFixed(4)} != baseCredit ${totalCredit.toFixed(4)}`,
      );
    }
    // Pick the leg with the largest base magnitude (the sum-side control account
    // for ordinary documents) and adjust its base side so the sums match exactly.
    let target = work[0];
    for (const w of work) {
      if (w.base.greaterThan(target.base)) target = w;
    }
    if (target.isDebit) {
      const adj = target.base.minus(residual);
      target.line.baseDebit = fmt(adj);
      if (target.amount.greaterThan(ZERO)) target.line.exchangeRate = adj.dividedBy(target.amount).toFixed(8);
    } else {
      const adj = target.base.plus(residual);
      target.line.baseCredit = fmt(adj);
      if (target.amount.greaterThan(ZERO)) target.line.exchangeRate = adj.dividedBy(target.amount).toFixed(8);
    }
  }

  return work.map((w) => w.line);
}
