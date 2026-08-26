// lib/reports/budgetVariance.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { computeVariance, type VarianceRow } from './budgetVariance';

describe('computeVariance', () => {
  // ── INCOME accounts ─────────────────────────────────────────────────────────
  // For INCOME: actual ≥ budget → favorable (positive variance)
  // variance = actual − budget

  it('INCOME over-budget: variance positive, favorable', () => {
    const rows = [
      { accountId: 'a1', accountName: 'Sales', accountType: 'INCOME', budget: '1000', actual: '1200' },
    ];
    const result = computeVariance(rows);
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0];
    expect(r.variance).toBe('200.0000');
    expect(r.variancePct).toBe('20.0000');
    expect(r.favorable).toBe(true);
  });

  it('INCOME under-budget: variance negative, unfavorable', () => {
    const rows = [
      { accountId: 'a2', accountName: 'Sales', accountType: 'INCOME', budget: '1000', actual: '800' },
    ];
    const result = computeVariance(rows);
    const r = result.rows[0];
    expect(r.variance).toBe('-200.0000');
    expect(r.variancePct).toBe('-20.0000');
    expect(r.favorable).toBe(false);
  });

  it('INCOME exactly on budget: variance zero, favorable (neutral counts as favorable)', () => {
    const rows = [
      { accountId: 'a3', accountName: 'Sales', accountType: 'INCOME', budget: '1000', actual: '1000' },
    ];
    const result = computeVariance(rows);
    const r = result.rows[0];
    expect(r.variance).toBe('0.0000');
    expect(r.variancePct).toBe('0.0000');
    expect(r.favorable).toBe(true);
  });

  // ── EXPENSE accounts ─────────────────────────────────────────────────────────
  // For EXPENSE: actual ≤ budget → favorable (spending under budget)
  // variance = actual − budget (so negative when favorable)

  it('EXPENSE under-budget: variance negative, favorable', () => {
    const rows = [
      { accountId: 'b1', accountName: 'Rent', accountType: 'EXPENSE', budget: '2000', actual: '1800' },
    ];
    const result = computeVariance(rows);
    const r = result.rows[0];
    expect(r.variance).toBe('-200.0000');
    expect(r.variancePct).toBe('-10.0000');
    expect(r.favorable).toBe(true);
  });

  it('EXPENSE over-budget: variance positive, unfavorable', () => {
    const rows = [
      { accountId: 'b2', accountName: 'Rent', accountType: 'EXPENSE', budget: '2000', actual: '2400' },
    ];
    const result = computeVariance(rows);
    const r = result.rows[0];
    expect(r.variance).toBe('400.0000');
    expect(r.variancePct).toBe('20.0000');
    expect(r.favorable).toBe(false);
  });

  it('EXPENSE exactly on budget: variance zero, favorable', () => {
    const rows = [
      { accountId: 'b3', accountName: 'Rent', accountType: 'EXPENSE', budget: '2000', actual: '2000' },
    ];
    const result = computeVariance(rows);
    const r = result.rows[0];
    expect(r.variance).toBe('0.0000');
    expect(r.variancePct).toBe('0.0000');
    expect(r.favorable).toBe(true);
  });

  // ── Zero budget: variancePct null ─────────────────────────────────────────────

  it('zero budget returns null variancePct', () => {
    const rows = [
      { accountId: 'c1', accountName: 'Other', accountType: 'INCOME', budget: '0', actual: '500' },
    ];
    const result = computeVariance(rows);
    const r = result.rows[0];
    expect(r.variancePct).toBeNull();
    expect(r.variance).toBe('500.0000');
  });

  // ── Totals ────────────────────────────────────────────────────────────────────

  it('computes correct totals across multiple rows', () => {
    const rows = [
      { accountId: 'a1', accountName: 'Sales', accountType: 'INCOME', budget: '1000', actual: '1200' },
      { accountId: 'b1', accountName: 'Rent', accountType: 'EXPENSE', budget: '500', actual: '400' },
    ];
    const result = computeVariance(rows);
    expect(result.totals.totalBudget).toBe('1500.0000');
    expect(result.totals.totalActual).toBe('1600.0000');
    expect(result.totals.totalVariance).toBe('100.0000');
  });

  it('empty input returns empty rows and zero totals', () => {
    const result = computeVariance([]);
    expect(result.rows).toHaveLength(0);
    expect(result.totals.totalBudget).toBe('0.0000');
    expect(result.totals.totalActual).toBe('0.0000');
    expect(result.totals.totalVariance).toBe('0.0000');
  });

  it('uses Prisma.Decimal for precise arithmetic', () => {
    const rows = [
      { accountId: 'a1', accountName: 'Sales', accountType: 'INCOME', budget: '333.3333', actual: '333.3334' },
    ];
    const result = computeVariance(rows);
    const r = result.rows[0];
    // variance = 333.3334 - 333.3333 = 0.0001 exactly
    expect(new Prisma.Decimal(r.variance).equals(new Prisma.Decimal('0.0001'))).toBe(true);
  });
});
