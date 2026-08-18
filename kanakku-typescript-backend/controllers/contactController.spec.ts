import { describe, it, expect } from 'vitest';
import { validateContactBody } from './contactController';

describe('validateContactBody', () => {
  it('rejects when no identity', () => {
    expect(validateContactBody({})).toEqual({ ok: false, errors: { identity: 'A contact needs an organisation, or both a first and last name.' } });
  });
  it('accepts organisation only', () => {
    expect(validateContactBody({ organisation: 'Acme' })).toEqual({ ok: true });
  });
  it('rejects negative payment term', () => {
    expect(validateContactBody({ organisation: 'Acme', defaultPaymentTermDays: -1 })).toEqual({ ok: false, errors: { defaultPaymentTermDays: 'Payment term must be zero or more days.' } });
  });
});
