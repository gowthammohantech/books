import { describe, it, expect } from 'vitest';
import { resolveEntityLabel } from '../../lib/auditLabels';

describe('resolveEntityLabel', () => {
  it('uses the registered resolver for a model', () => {
    expect(resolveEntityLabel('Invoice', { id: '1', invoiceNumber: 'INV-001' })).toBe('INV-001');
    expect(resolveEntityLabel('Customer', { id: '9', name: 'Acme' })).toBe('Acme');
  });

  it('falls back to id when no resolver or field is missing', () => {
    expect(resolveEntityLabel('UnknownModel', { id: 'abc' })).toBe('abc');
    expect(resolveEntityLabel('Invoice', { id: 'abc' })).toBe('abc');
  });

  it('returns null when there is no record', () => {
    expect(resolveEntityLabel('Invoice', null)).toBeNull();
  });
});
