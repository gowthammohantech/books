import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { round2Number, toDecimal, toNum } from './decimal.js';

/** The old frontend implementation, kept here only to pin what changed. */
const legacyFloatRound2 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

describe('round2', () => {
  it('rounds half-up, matching the backend Decimal rule', () => {
    expect(round2Number('2.385')).toBe(2.39);
    expect(round2Number('1.005')).toBe(1.01);
    expect(round2Number('0.125')).toBe(0.13);
  });

  it('leaves already-2dp values alone', () => {
    expect(round2Number(26.97)).toBe(26.97);
    expect(round2Number(0)).toBe(0);
  });

  it('handles negatives symmetrically', () => {
    expect(round2Number('-2.385')).toBe(-2.39);
  });

  it('collapses non-finite input to 0 rather than propagating NaN into a total', () => {
    expect(round2Number(Number.NaN)).toBe(0);
    expect(round2Number(Number.POSITIVE_INFINITY)).toBe(0);
    expect(round2Number(null as unknown as number)).toBe(0);
  });
});

describe('the divergence this package exists to close', () => {
  // The frontend used Math.round((v + Number.EPSILON) * 100) / 100, which rounds
  // a .xx5 boundary DOWN wherever the binary float sits just below it. Over
  // 2,000,000 realistic line computations the two rules disagreed on 0.12% of
  // cases — always by exactly one cent. These are real examples from that sweep.
  it.each([
    [1, 13.25, 18, 2.38, 2.39],
    [1, 23.25, 18, 4.18, 4.19],
    [1, 26.25, 18, 4.72, 4.73],
    [1, 42.7, 5, 2.13, 2.14],
    [1, 43.5, 5, 2.17, 2.18],
    [1, 46.25, 18, 8.32, 8.33],
  ])('qty %i x %s @ %i%%: float gave %s, Decimal gives %s', (qty, rate, pct, legacy, correct) => {
    const raw = (qty * rate * pct) / 100;
    expect(legacyFloatRound2(raw)).toBe(legacy);
    expect(round2Number(raw)).toBe(correct);
  });

  it('agrees with the float rule everywhere it was already right', () => {
    // Sanity: the change is confined to the .xx5 boundary, not a wholesale shift.
    let disagreements = 0;
    for (let cents = 1; cents <= 5000; cents++) {
      const raw = (cents / 100) * 0.18;
      if (legacyFloatRound2(raw) !== round2Number(raw)) disagreements++;
    }
    expect(disagreements).toBeGreaterThan(0);
    expect(disagreements / 5000).toBeLessThan(0.01);
  });
});

describe('toDecimal', () => {
  it('accepts a Decimal, a string and a number', () => {
    expect(toDecimal(new Decimal('1.5')).toString()).toBe('1.5');
    expect(toDecimal('1.5').toString()).toBe('1.5');
    expect(toDecimal(1.5).toString()).toBe('1.5');
  });

  it('accepts anything with toString — the Prisma.Decimal bridge', () => {
    // Prisma bundles its own minified decimal.js, so a Prisma.Decimal is a
    // different class. Crossing that boundary by toString() is version-proof;
    // relying on the internal d/e/s representation is not.
    const prismaLike = { toString: () => '123.455' };
    expect(toDecimal(prismaLike).toString()).toBe('123.455');
    expect(round2Number(prismaLike)).toBe(123.46);
  });

  it('falls back rather than throwing on junk', () => {
    expect(toDecimal('not a number').toNumber()).toBe(0);
    expect(toDecimal(undefined).toNumber()).toBe(0);
    expect(toDecimal('').toNumber()).toBe(0);
  });
});

describe('toNum', () => {
  it('matches the backend coercion: empty and non-finite collapse to the fallback', () => {
    expect(toNum('')).toBe(0);
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum('abc')).toBe(0);
    expect(toNum('12.5')).toBe(12.5);
    expect(toNum(undefined, 7)).toBe(7);
  });
});
