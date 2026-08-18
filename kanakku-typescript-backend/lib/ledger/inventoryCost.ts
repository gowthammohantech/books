// lib/ledger/inventoryCost.ts
import { Prisma } from '@prisma/client';
import { toDecimal, ZERO, type DecimalInput } from './money';

export interface StockState {
  quantityOnHand: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

/** Weighted-average receipt: avg = (qoh*avg + qtyIn*unitCost)/(qoh+qtyIn).
 *  Keeps the prior average when qtyIn is zero or the resulting quantity is <= 0.
 *
 *  Oversell guard (bug 1): when on-hand is at or below zero (an earlier oversell
 *  drove quantityOnHand negative), the prior average has no valid quantity base to
 *  blend against — blending the incoming cost into a negative base dilutes the
 *  average and, for a large enough oversell, flips it negative, which would then
 *  produce negative COGS on the next sale. In that case a receipt RESETS the
 *  average to the incoming unit cost instead of blending. The result is also
 *  clamped so avgCost can never go below zero. */
export function applyReceipt(state: StockState, qtyIn: DecimalInput, unitCost: DecimalInput): StockState {
  const qIn = toDecimal(qtyIn);
  if (qIn.lessThanOrEqualTo(0)) return state;
  const newQty = state.quantityOnHand.plus(qIn);
  if (newQty.lessThanOrEqualTo(0)) {
    return { quantityOnHand: newQty, avgCost: state.avgCost };
  }
  const unit = toDecimal(unitCost);
  if (state.quantityOnHand.lessThanOrEqualTo(0)) {
    // Fresh base after an oversell (or from zero): adopt the incoming cost.
    return { quantityOnHand: newQty, avgCost: unit.lessThan(0) ? ZERO : unit };
  }
  const totalCost = state.quantityOnHand.times(state.avgCost).plus(qIn.times(unit));
  const blended = totalCost.dividedBy(newQty);
  return { quantityOnHand: newQty, avgCost: blended.lessThan(0) ? ZERO : blended };
}

/** Issue at current average. Returns COGS and the new state. Average is unchanged
 *  by an issue; quantity may go negative (oversell) — COGS still uses current avg. */
export function applyIssue(state: StockState, qtyOut: DecimalInput): { state: StockState; cogs: Prisma.Decimal } {
  const qOut = toDecimal(qtyOut);
  if (qOut.lessThanOrEqualTo(0)) return { state, cogs: ZERO };
  const cogs = qOut.times(state.avgCost);
  return { state: { quantityOnHand: state.quantityOnHand.minus(qOut), avgCost: state.avgCost }, cogs };
}
