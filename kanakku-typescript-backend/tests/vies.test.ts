import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateVatOnline } from '../lib/vies';

/**
 * VIES tests run with a MOCKED fetch — the CI/test env has NO internet, and we
 * must never make a real outbound call to the EU government service. Every test
 * here stubs globalThis.fetch.
 *
 * Contract (lib/vies.validateVatOnline):
 *  - valid VIES response       -> { checked:true,  valid:true,  name, source:'vies' }
 *  - invalid VIES response     -> { checked:true,  valid:false,            source:'vies' }
 *  - timeout / abort / network -> { checked:false, valid:<structural>,     source:'offline' }  (fail-open)
 *  - non-2xx response          -> { checked:false, valid:<structural>,     source:'offline' }  (fail-open)
 *  - GB (post-Brexit, not VIES)-> never calls fetch; offline/structural
 */

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const errResponse = (status: number): Response =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

describe('validateVatOnline', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns checked+valid+name when VIES reports the VAT number valid', async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({ valid: true, name: 'ACME GMBH', countryCode: 'DE', vatNumber: '123456789' }),
    );
    const r = await validateVatOnline('DE123456789');
    expect(r).toEqual({ checked: true, valid: true, name: 'ACME GMBH', source: 'vies' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('strips the country prefix and sends countryCode + vatNumber to VIES', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ valid: true, name: 'X' }));
    await validateVatOnline('DE 123 456 789');
    const call = fetchSpy.mock.calls[0];
    const init = call[1] as { body?: string } | undefined;
    expect(init?.body).toBeTypeOf('string');
    const payload = JSON.parse(init!.body as string);
    expect(payload.countryCode).toBe('DE');
    expect(payload.vatNumber).toBe('123456789');
  });

  it('returns checked:true valid:false when VIES reports the VAT number invalid', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ valid: false }));
    const r = await validateVatOnline('DE000000000');
    expect(r.checked).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.source).toBe('vies');
  });

  it('fails open on timeout/abort -> uses structural result, source offline', async () => {
    fetchSpy.mockImplementationOnce(() => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    });
    // DE123456789 is structurally valid (9 digits).
    const r = await validateVatOnline('DE123456789');
    expect(r).toEqual({ checked: false, valid: true, source: 'offline' });
  });

  it('fails open on a generic network error -> structural result, offline', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    // Structurally INVALID body for DE (needs 9 digits) -> structural false.
    const r = await validateVatOnline('DE12');
    expect(r).toEqual({ checked: false, valid: false, source: 'offline' });
  });

  it('fails open on a non-2xx response -> structural result, offline', async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(500));
    const r = await validateVatOnline('DE123456789');
    expect(r).toEqual({ checked: false, valid: true, source: 'offline' });
  });

  it('treats GB as offline/structural and never calls VIES (post-Brexit)', async () => {
    const r = await validateVatOnline('GB123456789');
    expect(r.checked).toBe(false);
    expect(r.source).toBe('offline');
    expect(r.valid).toBe(true); // 9 digits -> structurally valid GB
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats a non-EU prefix as offline/structural and never calls VIES', async () => {
    const r = await validateVatOnline('US123456789');
    expect(r.checked).toBe(false);
    expect(r.source).toBe('offline');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('honours a custom timeoutMs via AbortController without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ valid: true, name: 'T' }));
    const r = await validateVatOnline('DE123456789', { timeoutMs: 1 });
    expect(r.checked).toBe(true);
  });
});
