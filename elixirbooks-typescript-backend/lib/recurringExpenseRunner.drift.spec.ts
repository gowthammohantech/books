// lib/recurringExpenseRunner.drift.spec.ts
//
// Regression for P2 bug 2: recurring expense schedule drift.
// A missed cron day must NOT permanently shift the schedule, and multiple missed
// periods must NOT collapse into one occurrence. Each generated expense is dated
// on its SCHEDULED date; nextRecurringDate advances from the scheduled date; the
// runner catches up deterministically to the next due date on/after today.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeExpense {
  id: string;
  userId: string;
  expenseId: string | null;
  amount: string;
  tax: string | null;
  sourceType: string | null;
  paymentModeId: string | null;
  bankId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  currencyCode: string | null;
  exchangeRate: unknown;
  referenceNo: string | null;
  isRecurring: boolean;
  isDeleted: boolean;
  stopped: boolean;
  neverExpire: boolean;
  endsOn: Date | null;
  parentExpense: string | null;
  repeatEvery: string;
  customIntervalNumber: number | null;
  customIntervalType: string | null;
  expenseDate: Date | null;
  lastRecurringDate: Date | null;
  nextRecurringDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const store: { expenses: FakeExpense[]; seq: number } = { expenses: [], seq: 0 };

function makeExpenseDelegate() {
  return {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const nrLte = (where.nextRecurringDate as { lte?: Date } | undefined)?.lte;
      return store.expenses.filter(
        (e) =>
          e.isRecurring &&
          !e.isDeleted &&
          !e.stopped &&
          e.parentExpense === null &&
          e.nextRecurringDate != null &&
          (nrLte ? e.nextRecurringDate.getTime() <= nrLte.getTime() : true),
      );
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      // Source lookup (runRecurringForExpense): has an `id`.
      if (typeof where.id === 'string') {
        return store.expenses.find((e) => e.id === where.id) ?? null;
      }
      // Numbering clash check: expenseId is a concrete string.
      if (typeof where.expenseId === 'string') {
        return store.expenses.find((e) => e.expenseId === where.expenseId) ?? null;
      }
      // Numbering "last for tenant" lookup: expenseId: { not: null }.
      const withId = store.expenses
        .filter((e) => e.expenseId != null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return withId[0] ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      store.seq += 1;
      const row: FakeExpense = {
        id: `gen-${store.seq}`,
        createdAt: new Date(2020, 0, 1, 0, 0, store.seq), // strictly increasing
        updatedAt: new Date(),
        parentExpense: null,
        expenseId: null,
        amount: '0',
        tax: null,
        sourceType: null,
        paymentModeId: null,
        bankId: null,
        costCenterId: null,
        projectId: null,
        currencyCode: null,
        exchangeRate: null,
        referenceNo: null,
        isRecurring: false,
        isDeleted: false,
        stopped: false,
        neverExpire: false,
        endsOn: null,
        repeatEvery: 'month',
        customIntervalNumber: null,
        customIntervalType: null,
        expenseDate: null,
        lastRecurringDate: null,
        nextRecurringDate: null,
        userId: '',
        ...(data as Partial<FakeExpense>),
      } as FakeExpense;
      store.expenses.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = store.expenses.find((e) => e.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    }),
  };
}

const expenseDelegate = makeExpenseDelegate();

vi.mock('./prisma', () => ({
  prisma: {
    get expense() {
      return expenseDelegate;
    },
    // GL mapping absent → posting block is skipped entirely.
    ledgerAccountMapping: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        expense: expenseDelegate,
        ledgerAccountMapping: { findFirst: vi.fn(async () => null) },
      }),
    ),
  },
}));

vi.mock('./ledger/ledgerPosting', () => ({ postExpense: vi.fn() }));
vi.mock('./ledger/bankAccount', () => ({ resolveBankGlAccountId: vi.fn(async () => null) }));

import { runDueRecurringExpenses } from './recurringExpenseRunner';

function seedMonthly(nextRecurringDate: Date): void {
  store.expenses.length = 0;
  store.seq = 0;
  store.expenses.push({
    id: 'src-1',
    userId: 'tenant-1',
    expenseId: 'EXP-000001',
    amount: '100',
    tax: '0',
    sourceType: 'CASH',
    paymentModeId: null,
    bankId: null,
    costCenterId: null,
    projectId: null,
    currencyCode: null,
    exchangeRate: null,
    referenceNo: 'RENT',
    isRecurring: true,
    isDeleted: false,
    stopped: false,
    neverExpire: true,
    endsOn: null,
    parentExpense: null,
    repeatEvery: 'month',
    customIntervalNumber: null,
    customIntervalType: null,
    expenseDate: new Date('2025-12-01T00:00:00Z'),
    lastRecurringDate: null,
    nextRecurringDate,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    updatedAt: new Date('2025-12-01T00:00:00Z'),
  });
}

describe('runDueRecurringExpenses — schedule drift', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('catches up each missed period dated on its scheduled date, no drift', async () => {
    // Due Jan 1; cron missed Jan and Feb, runs Mar 15. Expect 3 occurrences
    // dated Jan 1, Feb 1, Mar 1 (each scheduled date), next due Apr 1.
    seedMonthly(new Date('2026-01-01T00:00:00Z'));

    await runDueRecurringExpenses();

    const generated = store.expenses.filter((e) => e.parentExpense === 'src-1');
    const dates = generated
      .map((e) => e.expenseDate!.toISOString().slice(0, 10))
      .sort();
    expect(dates).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);

    const src = store.expenses.find((e) => e.id === 'src-1')!;
    // Advanced from the LAST scheduled date (Mar 1), not from "today" (Mar 15).
    expect(src.nextRecurringDate!.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(src.lastRecurringDate!.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('dates a single due occurrence on its scheduled date, not the cron run day', async () => {
    seedMonthly(new Date('2026-03-01T00:00:00Z'));

    await runDueRecurringExpenses();

    const generated = store.expenses.filter((e) => e.parentExpense === 'src-1');
    expect(generated).toHaveLength(1);
    expect(generated[0].expenseDate!.toISOString().slice(0, 10)).toBe('2026-03-01');
    const src = store.expenses.find((e) => e.id === 'src-1')!;
    expect(src.nextRecurringDate!.toISOString().slice(0, 10)).toBe('2026-04-01');
  });
});
