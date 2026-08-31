import { describe, it, expect } from 'vitest';
import { COUNTRY_PACKS, getPack, COUNTRY_CODES } from './index';
import { LEDGER_ROLES } from '../roles';

describe('country packs', () => {
  it('exposes all six jurisdictions', () => {
    expect([...COUNTRY_CODES].sort()).toEqual(['AU', 'EU', 'GB', 'IN', 'NZ', 'US']);
  });

  it('each pack maps every role and uses the right currency + fiscal start', () => {
    const expected: Record<string, { ccy: string; fy: number }> = {
      IN: { ccy: 'INR', fy: 4 }, GB: { ccy: 'GBP', fy: 4 }, EU: { ccy: 'EUR', fy: 1 },
      US: { ccy: 'USD', fy: 1 }, AU: { ccy: 'AUD', fy: 7 }, NZ: { ccy: 'NZD', fy: 4 },
    };
    for (const code of COUNTRY_CODES) {
      const p = getPack(code)!;
      expect(p.defaultFunctionalCurrency).toBe(expected[code].ccy);
      expect(p.fiscalYearStartMonth).toBe(expected[code].fy);
      for (const role of LEDGER_ROLES) expect(p.roleMap[role]).toBeTruthy();
    }
  });

  it('US treats input sales tax as an expense (not a reclaimable asset)', () => {
    const us = getPack('US')!;
    const inp = us.accounts.find((a) => a.role === 'INPUT_TAX')!;
    expect(inp.accountType).toBe('EXPENSE');
  });

  it('getPack returns null for an unknown country', () => {
    expect(getPack('ZZ')).toBeNull();
  });
});
