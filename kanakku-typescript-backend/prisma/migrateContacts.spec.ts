import { describe, it, expect } from 'vitest';
import { normalizeEmail, normalizeOrg, planMerges } from './migrateContacts';

describe('normalizeEmail', () => {
  it('lowercases + trims', () => { expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com'); });
  it('empty for null', () => { expect(normalizeEmail(null)).toBe(''); });
});

describe('planMerges', () => {
  it('merges on exact email; flags same-org different-email as near-miss', () => {
    const customers = [
      { id: 'c1', email: 'ACME@x.com', name: 'Acme Ltd' },
      { id: 'c2', email: 'beta@x.com', name: 'Beta' },
    ];
    const suppliers = [
      { id: 's1', email: 'acme@x.com', name: 'Acme Limited' },   // exact email -> merge with c1
      { id: 's2', email: 'beta-supplier@x.com', name: 'Beta' },  // same org, diff email -> near-miss
    ];
    const res = planMerges(customers, suppliers);
    expect(res.merges).toEqual([{ customerId: 'c1', supplierId: 's1' }]);
    expect(res.nearMisses).toEqual([{ customerId: 'c2', supplierId: 's2', organisation: 'Beta' }]);
  });

  it('no email never merges (empty email is not a match key)', () => {
    const res = planMerges([{ id: 'c', email: '', name: 'X' }], [{ id: 's', email: '', name: 'X' }]);
    expect(res.merges).toEqual([]);
    // empty-email same-org still surfaces as a near-miss for manual review
    expect(res.nearMisses).toEqual([{ customerId: 'c', supplierId: 's', organisation: 'X' }]);
  });
});
