// lib/ledger/roleResolver.spec.ts
import { describe, it, expect } from 'vitest';
import { makeResolver } from './roleResolver';
import { LedgerError } from './buildLines';

describe('makeResolver', () => {
  const rows = [
    { roleKey: 'AR', accountId: 'acc-ar' },
    { roleKey: 'SALES_REVENUE', accountId: 'acc-rev' },
  ];

  it('resolves a known role', () => {
    const r = makeResolver(rows);
    expect(r('AR')).toBe('acc-ar');
  });

  it('passes through an explicit accountId without consulting the map', () => {
    const r = makeResolver(rows);
    expect(r(undefined, 'acc-direct')).toBe('acc-direct');
  });

  it('throws LedgerError for an unmapped role', () => {
    const r = makeResolver(rows);
    expect(() => r('COGS')).toThrow(LedgerError);
  });
});
