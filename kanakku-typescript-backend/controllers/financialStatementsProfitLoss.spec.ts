// controllers/financialStatementsProfitLoss.spec.ts
//
// P1 final review — finding 4: the legacy P&L must present manual/other income
// AND manual/other expense symmetrically BELOW operating income, so gross profit
// and operating income are OPERATING-ONLY (operating margin not inflated by
// non-operating income). The top-level total must still reconcile:
//   netIncome = operatingIncome + otherIncome − otherExpense
// and revenue.total == Σ(revenue.byCategory).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    // ledgerLive → false so we exercise the legacy subledger fallback path.
    companySettings: { findFirst: vi.fn().mockResolvedValue({ ledgerInitialized: false }) },
    creditNote: { findMany: vi.fn().mockResolvedValue([]) },
    purchase: { findMany: vi.fn().mockResolvedValue([]) }, // COGS 0
    journalLine: {
      findMany: vi.fn().mockResolvedValue([
        // manual OTHER income 300 (credit-balance INCOME account)
        { credit: '300', debit: '0', account: { id: 'inc1', name: 'Interest Income', accountType: 'INCOME' } },
        // manual OTHER expense 150 (debit-balance EXPENSE account)
        { credit: '0', debit: '150', account: { id: 'exp1', name: 'Bank Charges', accountType: 'EXPENSE' } },
      ]),
    },
  },
}));

vi.mock('../lib/financialQueries', () => ({
  getRevenueSummary: vi.fn().mockResolvedValue({ taxableRevenue: 1000, outputTax: 0 }),
  getExpenseSummary: vi.fn().mockResolvedValue({ total: 200, byCategory: [{ categoryId: 'c1', name: 'Rent', total: 200 }] }),
}));

import { profitLoss } from './financialStatementsController';

function fakeRes() {
  return {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

const req = { query: {}, user: 'u1' } as never;

describe('profitLoss (legacy) — finding 4: symmetric other income/expense below the line', () => {
  it('gross profit & operating income are operating-only; total==Σ(byCategory); netIncome reconciles', async () => {
    const res = fakeRes();
    await profitLoss(req, res as never);

    const d = res.body.data;

    // revenue.total is OPERATING only (sales), and reconciles with byCategory.
    expect(d.revenue.total).toBe(1000);
    const catSum = d.revenue.byCategory.reduce((s: number, c: any) => s + c.total, 0);
    expect(catSum).toBe(d.revenue.total); // total == Σ(byCategory)

    // Operating subtotals exclude the 300 non-operating manual income.
    expect(d.grossProfit).toBe(1000);      // 1000 − 0 COGS
    expect(d.operatingIncome).toBe(800);   // 1000 − 200 opex   (NOT 1100)

    // Other income/expense reported below the line via manualEntries.
    expect(d.manualEntries.income).toBe(300);
    expect(d.manualEntries.expense).toBe(150);

    // netIncome = operatingIncome + otherIncome − otherExpense = 800 + 300 − 150.
    expect(d.netIncome).toBe(950);
  });
});
