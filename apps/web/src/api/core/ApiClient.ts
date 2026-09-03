/**
 * The typed request layer: envelope unwrapping and error normalisation.
 *
 * It WRAPS `lib/apiClient`, it does not replace it. That module keeps the base
 * URL, the token-attaching request interceptor and the 401 handler wired through
 * `installUnauthorizedHandler` — all of which are correct and none of which
 * belong here. Its own docblock records where its scope deliberately stopped:
 *
 *   "Response unwrapping is NOT done here: 366 call sites read `.data.data` and
 *    44 read `.data.success`, and changing that is a different, much larger
 *    refactor."
 *
 * This is that layer. The count is now 574 hand-written unwraps, each with its
 * own defensive fallback — `hooks/useCurrencies.ts:46` is the high-water mark:
 * `Array.isArray(raw) ? raw : (raw?.currencies ?? raw?.data ?? [])`.
 *
 * IT MUST TOLERATE AN UN-ENVELOPED BODY. About 512 of ~2,000 backend responses
 * carry no `success` key at all, four controllers never emit one, and the
 * country/state/city/profile endpoints return a bare array. A client that
 * insisted on `{success, message, data}` would break every one of them, so
 * `unwrap` returns the payload as-is when the envelope is absent. That
 * tolerance is what lets the two sides migrate independently rather than in a
 * flag day.
 */
import type { AxiosInstance, AxiosRequestConfig } from 'axios';

import api from '@lib/apiClient';

import { toApiError } from './ApiError';

/** The backend's success envelope, when it sends one. */
export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * Is this the `{success, message, data}` shape, or a payload in its own right?
 *
 * Keyed on `success` rather than on the presence of `data`, because a bare
 * payload can legitimately have a `data` property of its own.
 */
function isEnvelope<T>(body: unknown): body is ApiEnvelope<T> {
  return (
    typeof body === 'object' &&
    body !== null &&
    'success' in body &&
    typeof (body as { success: unknown }).success === 'boolean' &&
    'data' in body
  );
}

export function unwrap<T>(body: ApiEnvelope<T> | T): T {
  return isEnvelope<T>(body) ? body.data : (body as T);
}

/**
 * Drop `undefined` and `null` params.
 *
 * axios serialises `{ search: undefined }` to nothing, but `{ search: null }`
 * to `search=`, which several list endpoints treat as a real empty search rather
 * than as absent. Doing it once here is the point of having a client.
 */
function cleanParams(params?: QueryParams): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export class ApiClient {
  protected readonly http: AxiosInstance;

  // Explicit field, not a parameter property: apps/web sets
  // `erasableSyntaxOnly`, which rejects the shorthand.
  constructor(http: AxiosInstance = api) {
    this.http = http;
  }

  protected async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const res = await this.http.request<ApiEnvelope<T> | T>(config);
      return unwrap<T>(res.data);
    } catch (err) {
      throw toApiError(err);
    }
  }

  protected get<T>(url: string, params?: QueryParams): Promise<T> {
    return this.request<T>({ method: 'get', url, params: cleanParams(params) });
  }

  protected post<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: 'post', url, data });
  }

  protected put<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: 'put', url, data });
  }

  protected patch<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: 'patch', url, data });
  }

  protected delete<T>(url: string): Promise<T> {
    return this.request<T>({ method: 'delete', url });
  }

  /**
   * Multipart upload.
   *
   * Content-Type is deliberately NOT set: the browser has to choose it so it can
   * append the multipart boundary. Setting it by hand is the classic way to
   * break an upload, and 25 call sites in this app already set it explicitly
   * because they had to.
   */
  protected upload<T>(url: string, form: FormData, method: 'post' | 'put' = 'post'): Promise<T> {
    return this.request<T>({ method, url, data: form });
  }
}
