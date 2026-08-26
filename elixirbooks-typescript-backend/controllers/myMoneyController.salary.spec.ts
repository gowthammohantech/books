import { describe, it, expect } from 'vitest';
import { buildSalaryOwed } from '../lib/payroll/salaryOwed';

describe('My Money salary block contract', () => {
  it('outstanding reflects owed minus paid', () => {
    const r = buildSalaryOwed(
      [{ date: new Date('2026-05-05'), description: 'm1', amount: 800 }],
      [{ date: new Date('2026-05-28'), description: 'pay', amount: 500 }],
    );
    expect({ owed: r.owed, paid: r.paid, outstanding: r.outstanding }).toEqual({ owed: 800, paid: 500, outstanding: 300 });
  });
});
