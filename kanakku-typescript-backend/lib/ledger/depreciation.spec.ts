// lib/ledger/depreciation.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { monthlyDepreciation, depreciationDue } from './depreciation';

// Helper: build a minimal FixedAsset-like object
function makeAsset(o: {
  cost: string;
  salvageValue: string;
  usefulLifeMonths: number;
  acquisitionDate: Date;
  accumulatedDepreciation?: string;
  lastDepreciatedOn?: Date | null;
}) {
  return {
    cost: new Prisma.Decimal(o.cost),
    salvageValue: new Prisma.Decimal(o.salvageValue),
    usefulLifeMonths: o.usefulLifeMonths,
    acquisitionDate: o.acquisitionDate,
    accumulatedDepreciation: new Prisma.Decimal(o.accumulatedDepreciation ?? '0'),
    lastDepreciatedOn: o.lastDepreciatedOn ?? null,
  };
}

describe('monthlyDepreciation', () => {
  it('computes (cost - salvage) / months', () => {
    const result = monthlyDepreciation(
      new Prisma.Decimal('12000'),
      new Prisma.Decimal('0'),
      12,
    );
    expect(result.toFixed(4)).toBe('1000.0000');
  });

  it('factors in salvage value', () => {
    const result = monthlyDepreciation(
      new Prisma.Decimal('12000'),
      new Prisma.Decimal('2000'),
      60,
    );
    // (12000 - 2000) / 60 = 166.6666...
    expect(result.toFixed(4)).toBe('166.6667');
  });

  it('returns 0 when usefulLifeMonths is 0 (guard)', () => {
    const result = monthlyDepreciation(
      new Prisma.Decimal('10000'),
      new Prisma.Decimal('0'),
      0,
    );
    expect(result.toFixed(4)).toBe('0.0000');
  });
});

describe('depreciationDue', () => {
  it('first-month: 1 month elapsed → monthly amount', () => {
    const asset = makeAsset({
      cost: '12000',
      salvageValue: '0',
      usefulLifeMonths: 12,
      acquisitionDate: new Date('2026-01-01'),
      accumulatedDepreciation: '0',
    });
    // asOf is 1 month after acquisition
    const result = depreciationDue(asset, new Date('2026-02-01'));
    expect(result.months).toBe(1);
    expect(new Prisma.Decimal(result.amount).toFixed(4)).toBe('1000.0000');
  });

  it('mid-life: several months elapsed → multiple months × monthly', () => {
    const asset = makeAsset({
      cost: '12000',
      salvageValue: '0',
      usefulLifeMonths: 12,
      acquisitionDate: new Date('2026-01-01'),
      accumulatedDepreciation: '0',
    });
    // 3 months elapsed
    const result = depreciationDue(asset, new Date('2026-04-01'));
    expect(result.months).toBe(3);
    expect(new Prisma.Decimal(result.amount).toFixed(4)).toBe('3000.0000');
  });

  it('uses lastDepreciatedOn instead of acquisitionDate when set', () => {
    const asset = makeAsset({
      cost: '12000',
      salvageValue: '0',
      usefulLifeMonths: 12,
      acquisitionDate: new Date('2026-01-01'),
      accumulatedDepreciation: '1000', // already depreciated 1 month
      lastDepreciatedOn: new Date('2026-02-01'),
    });
    // 2 more months elapsed since lastDepreciatedOn
    const result = depreciationDue(asset, new Date('2026-04-01'));
    expect(result.months).toBe(2);
    expect(new Prisma.Decimal(result.amount).toFixed(4)).toBe('2000.0000');
  });

  it('final cap: does not exceed depreciable base (cost - salvage)', () => {
    const asset = makeAsset({
      cost: '12000',
      salvageValue: '0',
      usefulLifeMonths: 12,
      acquisitionDate: new Date('2026-01-01'),
      accumulatedDepreciation: '11500', // almost fully depreciated
      lastDepreciatedOn: new Date('2026-11-01'),
    });
    // asOf forces 2 months but only 500 depreciable base remains
    const result = depreciationDue(asset, new Date('2026-12-01'));
    expect(result.months).toBe(1);
    // Would be 1000 but capped at remaining depreciable base = 12000 - 0 - 11500 = 500
    expect(new Prisma.Decimal(result.amount).toFixed(4)).toBe('500.0000');
  });

  it('zero when up-to-date (no months elapsed)', () => {
    const asset = makeAsset({
      cost: '12000',
      salvageValue: '0',
      usefulLifeMonths: 12,
      acquisitionDate: new Date('2026-01-01'),
      accumulatedDepreciation: '1000',
      lastDepreciatedOn: new Date('2026-02-01'),
    });
    // Same date as lastDepreciatedOn → 0 months elapsed
    const result = depreciationDue(asset, new Date('2026-02-01'));
    expect(result.months).toBe(0);
    expect(result.amount).toBe('0');
  });

  it('zero when fully depreciated (accumulated >= depreciable base)', () => {
    const asset = makeAsset({
      cost: '12000',
      salvageValue: '2000',
      usefulLifeMonths: 60,
      acquisitionDate: new Date('2026-01-01'),
      accumulatedDepreciation: '10000', // fully depreciated (cost - salvage = 10000)
      lastDepreciatedOn: new Date('2026-06-01'),
    });
    const result = depreciationDue(asset, new Date('2026-12-01'));
    expect(result.months).toBe(0);
    expect(result.amount).toBe('0');
  });
});
