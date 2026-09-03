/**
 * A logger with levels, namespaces and request correlation.
 *
 * WHY: 690 `console.*` calls (503 of them `console.error`) with no level
 * control, no correlation, and no way to turn anything down in production. The
 * dominant shape is `catch (err) { console.error('Failed to X:', err); ... }`,
 * repeated per handler, which means a production log tells you something failed
 * but not for whom or in which workspace.
 *
 * CORRELATION IS FREE HERE. `lib/auditContext.ts` already puts `userId`,
 * `tenantId`, `ipAddress` and `userAgent` into AsyncLocalStorage for every
 * request, via a middleware mounted globally before all routes. This reads that
 * store, so a call site gets correlation without passing anything.
 *
 * IT MUST NOT OPEN ITS OWN STORE. `lib/auditContext.ts:3-15` says so directly —
 * it is "the process's ONE request-scoped store", and a second
 * AsyncLocalStorage would be a second source of truth for who a request is.
 * Correlation fields are read from there, never re-derived.
 *
 * NO DEPENDENCY. Nothing logging-related is installed, and the shape below is
 * small enough that adding pino would buy configuration surface rather than
 * capability. If structured transport or sampling is ever needed, this module is
 * the seam to swap — which is the point of having it.
 *
 * NAMESPACES follow the convention already in the code: `server.ts` writes
 * `[boot]` and `[swagger]`, `lib/aiCrypto.ts` writes `[aiCrypto]`.
 *
 * SCOPE: nothing migrates off `console.*` in this commit, and there is no
 * `no-console` lint rule to force it. Modules adopt this as they are touched.
 */
import { getAuditContext } from '../../lib/auditContext';

export const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type Level = (typeof LEVELS)[number];

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * The floor, from `LOG_LEVEL`.
 *
 * Read per call rather than captured at import: `dotenv.config()` runs after
 * server.ts's import block, so anything snapshotting the environment at module
 * load reads it unset. Defaults to `debug` outside production so a dev loop
 * keeps the output it has today.
 */
function threshold(): number {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw && raw in RANK) return RANK[raw as Level];
  return process.env.NODE_ENV === 'production' ? RANK.info : RANK.debug;
}

export interface LogFields {
  [key: string]: unknown;
}

/** Correlation from the request-scoped store, omitting whatever is absent. */
function correlation(): LogFields {
  const ctx = getAuditContext();
  if (!ctx) return {};
  const out: LogFields = {};
  if (ctx.tenantId) out.tenantId = ctx.tenantId;
  if (ctx.userId) out.userId = ctx.userId;
  return out;
}

/**
 * An Error rendered for a log line.
 *
 * The message and stack are kept — this is the one place they belong, now that
 * `toHttpError` no longer returns them to the client.
 */
function renderError(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      err: err.message,
      ...(err.name !== 'Error' ? { errName: err.name } : {}),
      ...(err.stack ? { stack: err.stack } : {}),
    };
  }
  if (err === undefined) return {};
  return { err: String(err) };
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** `error(msg, err)` or `error(msg, err, fields)` — the shape 503 call sites already have. */
  error(message: string, err?: unknown, fields?: LogFields): void;
  /** A sub-namespace, e.g. `logger('ledger').child('posting')` -> `[ledger:posting]`. */
  child(suffix: string): Logger;
}

function emit(namespace: string, level: Level, message: string, fields: LogFields): void {
  if (RANK[level] < threshold()) return;

  const payload = { ...correlation(), ...fields };
  const prefix = `[${namespace}]`;
  // console is the transport on purpose: it is what the container captures, and
  // swapping it is this module's job rather than every call site's.
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (Object.keys(payload).length === 0) {
    sink(`${prefix} ${message}`);
  } else {
    sink(`${prefix} ${message}`, payload);
  }
}

/** A logger for one namespace. */
export function logger(namespace: string): Logger {
  return {
    debug: (message, fields = {}) => emit(namespace, 'debug', message, fields),
    info: (message, fields = {}) => emit(namespace, 'info', message, fields),
    warn: (message, fields = {}) => emit(namespace, 'warn', message, fields),
    error: (message, err, fields = {}) =>
      emit(namespace, 'error', message, { ...renderError(err), ...fields }),
    child: (suffix) => logger(`${namespace}:${suffix}`),
  };
}
