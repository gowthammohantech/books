import { describe, it, expect } from 'vitest';
import { buildSalaryOwed } from './salaryOwed';

describe('buildSalaryOwed', () => {
  it('owed = Σ run nets, paid = Σ settlements, outstanding = owed − paid, entries date-sorted', () => {
    const res = buildSalaryOwed(
      [
        { date: new Date('2026-05-05'), description: 'May pay run', amount: 800 },
        { date: new Date('2026-06-05'), description: 'Jun pay run', amount: 800 },
      ],
      [{ date: new Date('2026-05-28'), description: 'Salary payment', amount: 800 }],
    );
    expect(res.owed).toBe(1600);
    expect(res.paid).toBe(800);
    expect(res.outstanding).toBe(800);
    expect(res.entries).toHaveLength(3);
    expect(res.entries[0].description).toBe('May pay run');
    expect(res.entries[1].paid).toBe(800); // 28 May settlement sorts before 5 Jun run
  });

  it('nets to zero when fully paid', () => {
    const res = buildSalaryOwed(
      [{ date: new Date('2026-05-05'), description: 'May', amount: 800 }],
      [{ date: new Date('2026-05-28'), description: 'Pay', amount: 800 }],
    );
    expect(res.outstanding).toBe(0);
  });

  it('returns zeros for no activity', () => {
    expect(buildSalaryOwed([], [])).toEqual({ entries: [], owed: 0, paid: 0, outstanding: 0 });
  });
});
