// lib/reports/pnlByDimension.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  pivotPnlByDimension,
  rollUpToParents,
  UNALLOCATED_KEY,
  type DimGroupRow,
  type PnlAccount,
  type PnlCentre,
} from './pnlByDimension';

const ACCOUNTS: PnlAccount[] = [
  { id: 'acc-sales', code: '4000', name: 'Sales Revenue', accountType: 'INCOME' },
  { id: 'acc-cogs', code: '5000', name: 'Cost of Goods Sold', accountType: 'EXPENSE' },
  { id: 'acc-rent', code: '5100', name: 'Rent', accountType: 'EXPENSE' },
];

const CENTRES: PnlCentre[] = [
  { id: 'cc-sales', code: 'SALES', name: 'Sales Dept' },
  { id: 'cc-acad', code: 'ACAD', name: 'Academy' },
];

/** INCOME is credit-positive; EXPENSE is debit-positive. */
const income = (accountId: string, costCenterId: string | null, amount: string): DimGroupRow =>
  ({ accountId, costCenterId, debit: '0', credit: amount });
const expense = (accountId: string, costCenterId: string | null, amount: string): DimGroupRow =>
  ({ accountId, costCenterId, debit: amount, credit: '0' });

describe('pivotPnlByDimension', () => {
  it('puts each centre in its own column with Unallocated last', () => {
    const r = pivotPnlByDimension([], ACCOUNTS, CENTRES);
    expect(r.columns.map((c) => c.key)).toEqual(['cc-sales', 'cc-acad', UNALLOCATED_KEY]);
    expect(r.columns.at(-1)?.name).toBe('Common / Unallocated');
  });

  it('splits revenue and cost across department columns', () => {
    const r = pivotPnlByDimension(
      [
        income('acc-sales', 'cc-sales', '50000'),
        income('acc-sales', 'cc-acad', '20000'),
        expense('acc-cogs', 'cc-sales', '20000'),
        expense('acc-cogs', 'cc-acad', '8000'),
        expense('acc-rent', null, '6000'),
      ],
      ACCOUNTS,
      CENTRES,
    );

    expect(r.totals.revenue['cc-sales']).toBe('50000.0000');
    expect(r.totals.revenue['cc-acad']).toBe('20000.0000');
    expect(r.totals.expenses['cc-sales']).toBe('20000.0000');
    // Untagged rent lands in Common, not on a department.
    expect(r.totals.expenses[UNALLOCATED_KEY]).toBe('6000.0000');
    expect(r.totals.net['cc-sales']).toBe('30000.0000');
    expect(r.totals.net['cc-acad']).toBe('12000.0000');
    expect(r.totals.net[UNALLOCATED_KEY]).toBe('-6000.0000');
    expect(r.totals.grandNet).toBe('36000.0000');
  });

  it('reconciles: department columns + Common == the grand total', () => {
    // THE invariant this report exists to support. If it fails, the per-line
    // posting is wrong.
    const rows = [
      income('acc-sales', 'cc-sales', '1234.56'),
      income('acc-sales', 'cc-acad', '789.01'),
      income('acc-sales', null, '10.10'),
      expense('acc-cogs', 'cc-sales', '400.40'),
      expense('acc-rent', null, '99.99'),
    ];
    const r = pivotPnlByDimension(rows, ACCOUNTS, CENTRES);

    const sumOf = (totals: Record<string, string>) =>
      r.columns.reduce((s, c) => s.plus(new Prisma.Decimal(totals[c.key])), new Prisma.Decimal(0));

    expect(sumOf(r.totals.revenue).toFixed(4)).toBe(r.totals.grandRevenue);
    expect(sumOf(r.totals.expenses).toFixed(4)).toBe(r.totals.grandExpenses);
    expect(sumOf(r.totals.net).toFixed(4)).toBe(r.totals.grandNet);
  });

  it('per-row column amounts sum to that row total', () => {
    const r = pivotPnlByDimension(
      [income('acc-sales', 'cc-sales', '30'), income('acc-sales', 'cc-acad', '70')],
      ACCOUNTS,
      CENTRES,
    );
    const row = r.revenue.find((x) => x.accountId === 'acc-sales');
    const summed = r.columns.reduce(
      (s, c) => s.plus(new Prisma.Decimal(row?.amounts[c.key] ?? 0)),
      new Prisma.Decimal(0),
    );
    expect(summed.toFixed(4)).toBe(row?.total);
  });

  it('folds an unknown or soft-deleted centre id into Common rather than dropping it', () => {
    // Dropping it would silently break the reconciliation above.
    const r = pivotPnlByDimension(
      [income('acc-sales', 'cc-deleted-long-ago', '500')],
      ACCOUNTS,
      CENTRES,
    );
    expect(r.totals.revenue[UNALLOCATED_KEY]).toBe('500.0000');
    expect(r.totals.grandRevenue).toBe('500.0000');
  });

  it('ignores journal lines on accounts that are not income or expense', () => {
    const r = pivotPnlByDimension(
      [income('acc-bank', 'cc-sales', '9999'), income('acc-sales', 'cc-sales', '100')],
      ACCOUNTS,
      CENTRES,
    );
    expect(r.totals.grandRevenue).toBe('100.0000');
  });

  it('nets a contra movement within the same account and column', () => {
    const r = pivotPnlByDimension(
      [
        income('acc-sales', 'cc-sales', '100'),
        { accountId: 'acc-sales', costCenterId: 'cc-sales', debit: '30', credit: '0' },
      ],
      ACCOUNTS,
      CENTRES,
    );
    expect(r.totals.revenue['cc-sales']).toBe('70.0000');
  });

  it('omits accounts with no activity', () => {
    const r = pivotPnlByDimension([income('acc-sales', 'cc-sales', '10')], ACCOUNTS, CENTRES);
    expect(r.expenses).toHaveLength(0);
    expect(r.revenue).toHaveLength(1);
  });

  it('returns only the Unallocated column shape for empty input', () => {
    const r = pivotPnlByDimension([], ACCOUNTS, []);
    expect(r.columns.map((c) => c.key)).toEqual([UNALLOCATED_KEY]);
    expect(r.totals.grandNet).toBe('0.0000');
  });
});

describe('rollUpToParents', () => {
  const CHILD_CENTRES: PnlCentre[] = [
    { id: 'cc-div', code: 'DIV', name: 'Commercial Division' },
    { id: 'cc-sales', code: 'SALES', name: 'Sales Dept' },
    { id: 'cc-acad', code: 'ACAD', name: 'Academy' },
  ];

  it('sums children into their parent column', () => {
    const base = pivotPnlByDimension(
      [
        income('acc-sales', 'cc-sales', '50000'),
        income('acc-sales', 'cc-acad', '20000'),
        income('acc-sales', null, '1000'),
      ],
      ACCOUNTS,
      CHILD_CENTRES,
    );

    const rolled = rollUpToParents(
      base,
      new Map([
        ['cc-div', null],
        ['cc-sales', 'cc-div'],
        ['cc-acad', 'cc-div'],
      ]),
      new Map(CHILD_CENTRES.map((c) => [c.id, { code: c.code, name: c.name }])),
    );

    expect(rolled.columns.map((c) => c.key)).toEqual(['cc-div', UNALLOCATED_KEY]);
    expect(rolled.totals.revenue['cc-div']).toBe('70000.0000');
    expect(rolled.totals.revenue[UNALLOCATED_KEY]).toBe('1000.0000');
  });

  it('preserves the grand total through the roll-up', () => {
    const base = pivotPnlByDimension(
      [income('acc-sales', 'cc-sales', '30'), expense('acc-cogs', 'cc-acad', '10')],
      ACCOUNTS,
      CHILD_CENTRES,
    );
    const rolled = rollUpToParents(
      base,
      new Map([['cc-div', null], ['cc-sales', 'cc-div'], ['cc-acad', 'cc-div']]),
      new Map(CHILD_CENTRES.map((c) => [c.id, { code: c.code, name: c.name }])),
    );
    expect(rolled.totals.grandNet).toBe(base.totals.grandNet);
    expect(rolled.totals.net['cc-div']).toBe('20.0000');
  });

  it('leaves a top-level centre in its own column', () => {
    const base = pivotPnlByDimension([income('acc-sales', 'cc-sales', '5')], ACCOUNTS, CHILD_CENTRES);
    const rolled = rollUpToParents(
      base,
      new Map([['cc-div', null], ['cc-sales', null], ['cc-acad', null]]),
      new Map(CHILD_CENTRES.map((c) => [c.id, { code: c.code, name: c.name }])),
    );
    expect(rolled.columns.map((c) => c.key)).toContain('cc-sales');
    expect(rolled.totals.revenue['cc-sales']).toBe('5.0000');
  });
});
