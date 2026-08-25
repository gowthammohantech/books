// lib/ledger/landedCost.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { allocateLandedCost } from './landedCost';

const D = (v: string) => new Prisma.Decimal(v);

// Helper: sum an array of allocation strings and verify it equals expected at 4dp.
function sumAllocations(allocs: string[]): Prisma.Decimal {
  return allocs.reduce((acc, a) => acc.plus(D(a)), D('0'));
}

// ---------------------------------------------------------------------------
// Zero landed cost
// ---------------------------------------------------------------------------
describe('allocateLandedCost — zero landed cost', () => {
  it('returns all zeros when landedTotal is 0', () => {
    const lines = [{ value: '100' }, { value: '200' }];
    const result = allocateLandedCost(lines, '0');
    expect(result).toHaveLength(2);
    result.forEach((r) => expect(r).toBe('0.0000'));
  });

  it('returns empty array for empty lines', () => {
    const result = allocateLandedCost([], '50');
    expect(result).toHaveLength(0);
  });

  it('returns all zeros when all line values are zero', () => {
    const lines = [{ value: '0' }, { value: '0' }];
    const result = allocateLandedCost(lines, '100');
    result.forEach((r) => expect(r).toBe('0.0000'));
  });
});

// ---------------------------------------------------------------------------
// Even split
// ---------------------------------------------------------------------------
describe('allocateLandedCost — even split', () => {
  it('splits equally when lines have equal value', () => {
    const lines = [{ value: '100' }, { value: '100' }];
    const result = allocateLandedCost(lines, '50');

    expect(result).toHaveLength(2);
    result.forEach((r) => expect(r).toBe('25.0000'));

    // Sum must equal landed total exactly.
    expect(sumAllocations(result).equals(D('50'))).toBe(true);
  });

  it('four equal lines', () => {
    const lines = [{ value: '250' }, { value: '250' }, { value: '250' }, { value: '250' }];
    const result = allocateLandedCost(lines, '40');
    result.forEach((r) => expect(r).toBe('10.0000'));
    expect(sumAllocations(result).equals(D('40'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Proportional split
// ---------------------------------------------------------------------------
describe('allocateLandedCost — proportional split', () => {
  it('allocates 2:1 ratio correctly', () => {
    // line1 value 200, line2 value 100 → ratio 2:1, total = 30
    // line1 gets 20, line2 gets 10
    const lines = [{ value: '200' }, { value: '100' }];
    const result = allocateLandedCost(lines, '30');

    expect(result[0]).toBe('20.0000');
    expect(result[1]).toBe('10.0000');
    expect(sumAllocations(result).equals(D('30'))).toBe(true);
  });

  it('allocates 3:1:1 ratio correctly', () => {
    // 300 / (300+100+100) = 60%, 100/500 = 20% each; total 10
    // → 6 + 2 + 2 = 10
    const lines = [{ value: '300' }, { value: '100' }, { value: '100' }];
    const result = allocateLandedCost(lines, '10');

    expect(result[0]).toBe('6.0000');
    expect(result[1]).toBe('2.0000');
    expect(result[2]).toBe('2.0000');
    expect(sumAllocations(result).equals(D('10'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rounding sums exactly (largest-remainder guarantee)
// ---------------------------------------------------------------------------
describe('allocateLandedCost — rounding exact sum', () => {
  it('three equal lines with indivisible total sum to exact total', () => {
    // 3 equal lines, landed = 10.0001 → each gets ~3.3333... (4dp)
    // 3.3333 + 3.3333 + 3.3335 = 10.0001 (one gets remainder)
    const lines = [{ value: '1' }, { value: '1' }, { value: '1' }];
    const result = allocateLandedCost(lines, '10.0001');

    const sum = sumAllocations(result);
    expect(sum.equals(D('10.0001'))).toBe(true);
  });

  it('three lines with 1/3 weight, total=1 → sums to exactly 1', () => {
    const lines = [{ value: '1' }, { value: '1' }, { value: '1' }];
    const result = allocateLandedCost(lines, '1');
    const sum = sumAllocations(result);
    expect(sum.equals(D('1'))).toBe(true);
  });

  it('seven equal lines with non-divisible total sums exactly', () => {
    const lines = Array.from({ length: 7 }, () => ({ value: '1' }));
    const total = '100';
    const result = allocateLandedCost(lines, total);
    const sum = sumAllocations(result);
    expect(sum.equals(D(total))).toBe(true);
  });

  it('two lines with irrational split (100 and 99.99) sum to total', () => {
    const lines = [{ value: '100' }, { value: '99.99' }];
    const total = '0.0001';
    const result = allocateLandedCost(lines, total);
    const sum = sumAllocations(result);
    expect(sum.equals(D(total))).toBe(true);
  });

  it('large real-world case: 3 lines, total=123.45', () => {
    const lines = [{ value: '500' }, { value: '300' }, { value: '200' }];
    const total = '123.45';
    const result = allocateLandedCost(lines, total);
    const sum = sumAllocations(result);
    expect(sum.equals(D(total))).toBe(true);
    // line0 should get the largest share
    expect(D(result[0]!).greaterThan(D(result[1]!))).toBe(true);
    expect(D(result[1]!).greaterThan(D(result[2]!))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Single line
// ---------------------------------------------------------------------------
describe('allocateLandedCost — single line', () => {
  it('single line receives entire landed cost', () => {
    const result = allocateLandedCost([{ value: '999' }], '75.1234');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('75.1234');
  });
});
