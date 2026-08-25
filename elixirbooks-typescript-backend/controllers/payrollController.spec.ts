import { describe, it, expect } from 'vitest';
import { validateProfileInput, computeLineTotals } from './payrollController';

describe('validateProfileInput', () => {
  it('rejects missing employeeUserId', () => {
    expect(validateProfileInput({})).toEqual({ ok: false, errors: { employeeUserId: 'Employee is required.' } });
  });
  it('rejects negative defaultGross', () => {
    expect(validateProfileInput({ employeeUserId: 'e1', defaultGross: -5 })).toEqual({
      ok: false, errors: { defaultGross: 'Default gross must be zero or positive.' },
    });
  });
  it('accepts valid input', () => {
    expect(validateProfileInput({ employeeUserId: 'e1', defaultGross: 1000 })).toEqual({ ok: true });
  });
});

describe('computeLineTotals', () => {
  it('sums deduction lines and computes net', () => {
    expect(computeLineTotals(1000, [{ label: 'PAYE', amount: 150 }, { label: 'NI', amount: 50 }]))
      .toEqual({ deductions: 200, net: 800 });
  });
  it('handles no deductions', () => {
    expect(computeLineTotals(500, [])).toEqual({ deductions: 0, net: 500 });
  });
  it('throws when deductions exceed gross', () => {
    expect(() => computeLineTotals(100, [{ label: 'x', amount: 200 }])).toThrow(/exceed/i);
  });
});
