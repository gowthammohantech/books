import { describe, it, expect } from 'vitest';
import { buildExpensesOwed } from './myMoneyController';

describe('buildExpensesOwed', () => {
  it('sums owed from reimbursable expenses and reimbursed from settlements; outstanding = owed - reimbursed', () => {
    const res = buildExpensesOwed(
      [
        { date: new Date('2026-05-01'), description: 'Taxi', amount: 100 },
        { date: new Date('2026-05-10'), description: 'Hotel', amount: 250 },
      ],
      [{ date: new Date('2026-05-20'), description: 'Reimbursement', amount: 100 }],
    );
    expect(res.owed).toBe(350);
    expect(res.reimbursed).toBe(100);
    expect(res.outstanding).toBe(250);
    expect(res.entries).toHaveLength(3);
    expect(res.entries[0].description).toBe('Taxi'); // sorted by date asc
    expect(res.entries[2].reimbursed).toBe(100);
  });

  it('nets to zero when fully reimbursed', () => {
    const res = buildExpensesOwed(
      [{ date: new Date('2026-05-01'), description: 'Taxi', amount: 100 }],
      [{ date: new Date('2026-06-01'), description: 'Reimbursement', amount: 100 }],
    );
    expect(res.outstanding).toBe(0);
  });

  it('returns zeros for no activity', () => {
    const res = buildExpensesOwed([], []);
    expect(res).toEqual({ entries: [], owed: 0, reimbursed: 0, outstanding: 0 });
  });
});
