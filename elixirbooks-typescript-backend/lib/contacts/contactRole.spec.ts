import { describe, it, expect } from 'vitest';
import { deriveRole, contactViewWhere } from './contactRole';

describe('deriveRole', () => {
  it('both', () => expect(deriveRole({ hasClientTxn: true, hasSupplierTxn: true })).toEqual({ isClient: true, isSupplier: true }));
  it('neither', () => expect(deriveRole({ hasClientTxn: false, hasSupplierTxn: false })).toEqual({ isClient: false, isSupplier: false }));
});

describe('contactViewWhere', () => {
  it('all-active filters userId + ACTIVE + not deleted', () => {
    const w = contactViewWhere('u1', 'all-active') as Record<string, unknown>;
    expect(w).toMatchObject({ userId: 'u1', isDeleted: false, status: 'ACTIVE' });
  });
  it('clients requires a client-side relation', () => {
    const w = JSON.stringify(contactViewWhere('u1', 'clients'));
    expect(w).toContain('invoicesAsContact'); // some-relation predicate present
  });
  it('hidden filters status HIDDEN', () => {
    expect(contactViewWhere('u1', 'hidden')).toMatchObject({ status: 'HIDDEN' });
  });
});
