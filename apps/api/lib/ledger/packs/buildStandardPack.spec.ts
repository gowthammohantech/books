import { describe, it, expect } from 'vitest';
import { buildStandardPack } from './buildStandardPack';
import { LEDGER_ROLES } from '../roles';

describe('buildStandardPack', () => {
  const pack = buildStandardPack({
    countryCode: 'IN', name: 'India', defaultFunctionalCurrency: 'INR',
    fiscalYearStartMonth: 4, taxRegime: 'GST_INDIA',
    outputTaxName: 'GST Payable (Output)', inputTaxName: 'GST Receivable (Input)',
  });

  it('maps every ledger role to an account code that exists in the CoA', () => {
    const codes = new Set(pack.accounts.map((a) => a.code));
    for (const role of LEDGER_ROLES) {
      const code = pack.roleMap[role];
      expect(code, `role ${role} must be mapped`).toBeTruthy();
      expect(codes.has(code), `role ${role} -> ${code} must exist in CoA`).toBe(true);
    }
  });

  it('has unique account codes', () => {
    const codes = pack.accounts.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every non-root account references an existing parent', () => {
    const codes = new Set(pack.accounts.map((a) => a.code));
    for (const a of pack.accounts) {
      if (a.parentCode) expect(codes.has(a.parentCode)).toBe(true);
    }
  });

  it('carries country metadata', () => {
    expect(pack.defaultFunctionalCurrency).toBe('INR');
    expect(pack.fiscalYearStartMonth).toBe(4);
    expect(pack.taxRegime).toBe('GST_INDIA');
  });

  it('labels tax accounts per the country', () => {
    const out = pack.accounts.find((a) => a.role === 'OUTPUT_TAX');
    const inp = pack.accounts.find((a) => a.role === 'INPUT_TAX');
    expect(out?.name).toBe('GST Payable (Output)');
    expect(inp?.name).toBe('GST Receivable (Input)');
  });
});
