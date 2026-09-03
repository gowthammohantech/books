/**
 * One normalised error for every failed request.
 *
 * WHY: the response interceptor in `lib/apiClient.ts` re-rejects the raw
 * `AxiosError`, so every call site digs the message out itself. There are 65
 * `axios.isAxiosError(...)` guards and 62 hand-written `?.response?.data?.message`
 * chains across the app, and the fallbacks disagree — some show the server's
 * message, some a hardcoded string, some nothing.
 *
 * `store/auth/authSlice.ts:80` already had the right implementation, in one
 * place, for one slice. This is that function promoted, so `axios` stops being
 * an import in 43 files that only wanted to read a message.
 */
import axios from 'axios';

export class ApiError extends Error {
  /** HTTP status, or null when the request never reached the server. */
  readonly status: number | null;
  /** Field-level errors, from the backend's `errors` key on a 422. */
  readonly details?: Record<string, string>;
  readonly reason?: unknown;

  // Fields are declared and assigned rather than taken as constructor parameter
  // properties: apps/web compiles with `erasableSyntaxOnly`, which forbids the
  // shorthand because it emits runtime code from a type annotation.
  constructor(
    status: number | null,
    message: string,
    details?: Record<string, string>,
    reason?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.reason = reason;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Offline, DNS failure, timeout — the request never got an answer. */
  get isNetwork(): boolean {
    return this.status === null;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /**
   * The session is gone.
   *
   * Note `installUnauthorizedHandler` in lib/apiClient already logs out and
   * redirects on a 401, so a caller rarely needs this — it exists so a screen on
   * a no-redirect path (/signin, /setup, /signup) can show the message inline
   * instead.
   */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** A validation failure carrying a field map. */
  get isValidation(): boolean {
    return this.status === 422 || (this.status === 400 && this.details !== undefined);
  }
}

/**
 * Turn anything thrown by a request into an `ApiError`.
 *
 * Message precedence follows what the backend actually sends: its own `message`
 * first (the only text written for a user), then the HTTP status text, then the
 * caller's fallback. That is the order `readError` used, and changing it would
 * change what thousands of toasts say.
 */
export function toApiError(error: unknown, fallback = 'Something went wrong'): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      // No response at all: offline, aborted, DNS, timeout. Distinguishable from
      // a 500 by `isNetwork`, because the two want different UI.
      return new ApiError(null, error.message || 'Network error', undefined, error);
    }
    const data = error.response.data as
      | { message?: string; error?: string; errors?: Record<string, string> }
      | undefined;
    return new ApiError(
      error.response.status,
      data?.message || error.response.statusText || fallback,
      // `errors` is the field map (middleware/handleValidationResult emits it on
      // a 422); the singular `error` is an exception string and is not it.
      data?.errors,
      error,
    );
  }

  if (error instanceof Error) return new ApiError(null, error.message, undefined, error);
  return new ApiError(null, fallback, undefined, error);
}

/** The message to show a user, from anything. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  return toApiError(error, fallback).message;
}
