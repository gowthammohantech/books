// lib/ledger/landedCost.ts
// Allocate a landed-cost total across invoice/purchase lines proportionally,
// with largest-remainder rounding so that parts sum EXACTLY to the total at 4dp.
import { Prisma } from '@prisma/client';
import { toDecimal, ZERO, type DecimalInput } from './money';

export interface AllocationLine {
  /** Line value (net amount) used as the weight for allocation. */
  value: DecimalInput;
}

/**
 * Allocate `landedTotal` across `lines` proportional to each line's value.
 *
 * Returns an array of allocation strings (one per line, same order) that
 * sum EXACTLY to `landedTotal` at 4 decimal places, using largest-remainder
 * rounding.
 *
 * Special cases:
 * - If all line values are zero (or lines is empty), returns all zeros.
 * - If `landedTotal` is zero, returns all zeros.
 */
export function allocateLandedCost(
  lines: AllocationLine[],
  landedTotal: DecimalInput,
): string[] {
  const total = toDecimal(landedTotal);
  const n = lines.length;

  if (n === 0 || total.equals(ZERO)) {
    return lines.map(() => ZERO.toFixed(4));
  }

  const lineValues = lines.map((l) => toDecimal(l.value));
  const sumValues = lineValues.reduce((acc, v) => acc.plus(v), ZERO);

  if (sumValues.equals(ZERO)) {
    // All line values are zero — cannot allocate proportionally; return zeros.
    return lines.map(() => ZERO.toFixed(4));
  }

  // Scale = 10^4 to work in integers (avoid 4dp rounding issues mid-calc).
  const SCALE = new Prisma.Decimal(10000);
  const totalScaled = total.times(SCALE);

  // Compute exact (real-number) share for each line, truncated to integer.
  const exactShares = lineValues.map((v) => totalScaled.times(v).dividedBy(sumValues));
  const floors = exactShares.map((s) => s.floor());
  const remainders = exactShares.map((s, i) => s.minus(floors[i]!));

  // Sum of floors; the deficit must be distributed via largest-remainder.
  const floorSum = floors.reduce((acc, f) => acc.plus(f), ZERO);
  let deficit = totalScaled.minus(floorSum).floor(); // should be integer

  // Sort indices by remainder descending; break ties by index for stability.
  const sortedIndices = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const diff = remainders[b]!.minus(remainders[a]!);
    if (!diff.equals(ZERO)) return diff.greaterThan(0) ? 1 : -1;
    return a - b;
  });

  // Award +1 unit to the top-remainder lines until deficit is exhausted.
  const result = floors.map((f) => f); // copy
  for (const idx of sortedIndices) {
    if (deficit.lessThanOrEqualTo(0)) break;
    result[idx] = result[idx]!.plus(1);
    deficit = deficit.minus(1);
  }

  // Convert back from scaled integers to 4dp decimals.
  return result.map((r) => r!.dividedBy(SCALE).toFixed(4));
}
