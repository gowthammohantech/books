import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { unwrap } from './ApiClient';
import { ApiError, toApiError, errorMessage } from './ApiError';

function axiosErrorWith(status: number, data: unknown, statusText = ''): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = {
    status,
    statusText,
    data,
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  } as never;
  return err;
}

describe('unwrap', () => {
  it('takes `data` out of the standard envelope', () => {
    expect(unwrap({ success: true, message: 'ok', data: { id: 'p1' } })).toEqual({ id: 'p1' });
  });

  // ~512 of the backend's ~2,000 responses carry no `success` key, four
  // controllers never emit one, and /admin/countries returns a bare array. A
  // client that required the envelope would break all of them.
  it('returns an un-enveloped body unchanged', () => {
    expect(unwrap([{ id: 'c1' }])).toEqual([{ id: 'c1' }]);
    expect(unwrap({ firstName: 'Ada' })).toEqual({ firstName: 'Ada' });
    expect(unwrap({ message: 'Product not found' })).toEqual({ message: 'Product not found' });
  });

  // Keyed on `success`, not on the presence of `data` — a bare payload may well
  // have a `data` property of its own, and unwrapping it would lose the rest.
  it('does not mistake a payload with a `data` field for an envelope', () => {
    const body = { id: 'r1', data: [1, 2, 3] };
    expect(unwrap(body)).toEqual(body);
  });

  it('keeps a null or empty payload rather than substituting one', () => {
    expect(unwrap({ success: true, message: 'Nothing linked', data: null })).toBeNull();
    expect(unwrap({ success: true, data: [] })).toEqual([]);
  });

  it('passes through a failure envelope rather than throwing', () => {
    // A non-2xx never reaches unwrap — axios rejects first — but a 200 carrying
    // success:false does, and its data is still the payload.
    expect(unwrap({ success: false, message: 'nope', data: { partial: true } })).toEqual({
      partial: true,
    });
  });
});

describe('toApiError', () => {
  it('prefers the backend message, which is the only text written for a user', () => {
    const err = toApiError(axiosErrorWith(409, { message: 'Code already exists' }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('Code already exists');
  });

  it('falls back to status text, then to the caller fallback', () => {
    expect(toApiError(axiosErrorWith(500, {}, 'Internal Server Error')).message).toBe(
      'Internal Server Error',
    );
    expect(toApiError(axiosErrorWith(500, {}), 'Could not save').message).toBe('Could not save');
  });

  // The field map on a 422 is `errors`; the singular `error` is an exception
  // string. middleware/handleValidationResult.ts owns that contract and the SPA
  // already parses it.
  it('carries the 422 field map through as details', () => {
    const err = toApiError(
      axiosErrorWith(422, { message: 'Validation failed', errors: { name: 'Name is required' } }),
    );
    expect(err.details).toEqual({ name: 'Name is required' });
    expect(err.isValidation).toBe(true);
  });

  it('does not mistake the singular `error` string for a field map', () => {
    const err = toApiError(axiosErrorWith(500, { message: 'Server error', error: 'stack-ish' }));
    expect(err.details).toBeUndefined();
  });

  // A request that never got an answer wants different UI from a 500, so the
  // two have to be distinguishable.
  it('reports a network failure with a null status', () => {
    const offline = new AxiosError('Network Error');
    const err = toApiError(offline);
    expect(err.status).toBeNull();
    expect(err.isNetwork).toBe(true);
  });

  it('handles a plain Error and a non-Error throw', () => {
    expect(toApiError(new Error('boom')).message).toBe('boom');
    expect(toApiError('just a string', 'fallback').message).toBe('fallback');
    expect(toApiError(undefined, 'fallback').message).toBe('fallback');
  });

  it('is idempotent', () => {
    const first = toApiError(axiosErrorWith(404, { message: 'gone' }));
    expect(toApiError(first)).toBe(first);
  });

  it('exposes the status predicates callers used to hand-roll', () => {
    expect(toApiError(axiosErrorWith(404, {})).isNotFound).toBe(true);
    expect(toApiError(axiosErrorWith(401, {})).isUnauthorized).toBe(true);
  });
});

describe('errorMessage', () => {
  it('is the one-liner that replaces the ?.response?.data?.message chains', () => {
    expect(errorMessage(axiosErrorWith(400, { message: 'Bad input' }))).toBe('Bad input');
    expect(errorMessage(null, 'Something went wrong')).toBe('Something went wrong');
  });
});
