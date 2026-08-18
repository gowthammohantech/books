import { describe, it, expect } from 'vitest';
import { resolveDisplayName, validateContactIdentity } from './contactIdentity';

describe('resolveDisplayName', () => {
  it('prefers organisation', () => {
    expect(resolveDisplayName({ organisation: 'Dreams Technologies', firstName: 'Vijaya', lastName: 'Kumar' })).toBe('Dreams Technologies');
  });
  it('falls back to person name', () => {
    expect(resolveDisplayName({ firstName: 'Vijaya', lastName: 'Kumar' })).toBe('Vijaya Kumar');
  });
  it('empty when nothing', () => {
    expect(resolveDisplayName({})).toBe('');
  });
});

describe('validateContactIdentity', () => {
  it('accepts organisation only', () => {
    expect(validateContactIdentity({ organisation: 'Acme' })).toEqual({ ok: true });
  });
  it('accepts full person name only', () => {
    expect(validateContactIdentity({ firstName: 'A', lastName: 'B' })).toEqual({ ok: true });
  });
  it('rejects first-name only with no org', () => {
    expect(validateContactIdentity({ firstName: 'A' })).toEqual({ ok: false, error: 'A contact needs an organisation, or both a first and last name.' });
  });
  it('rejects empty', () => {
    expect(validateContactIdentity({})).toEqual({ ok: false, error: 'A contact needs an organisation, or both a first and last name.' });
  });
});
