/**
 * Parsing the `?page=&limit=&search=` triad off a request.
 *
 * `toPositiveInt` is currently defined byte-identically in two controllers
 * (`Admin/Invoice/invoicePaymentController.ts:28` and
 * `Admin/Purchases/supplierPaymentReadController.ts:35`), and the surrounding
 * parse is written about ten different ways elsewhere — `Number(req.query.page ?? 1)`,
 * `Math.max(1, parseInt(...))`, `parseInt(String(page), 10) || 1`. They disagree
 * on what an absent, zero, negative, fractional or non-numeric value means.
 *
 * This is the one that absorbs them, with the same semantics the two copies
 * already had: a value that is not a finite number >= 1 falls back to the
 * default, and a fractional one floors.
 *
 * IT ADDS A CAP, which none of the existing copies has. `?limit=1000000` is
 * currently passed straight to Prisma's `take`, so any list endpoint will
 * happily try to serialise the whole table.
 */

/** The two controllers' shared helper, verbatim in behaviour. */
export function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export interface ListQuery {
  page: number;
  limit: number;
  search: string;
  /** Rows to skip — `(page - 1) * limit`, the expression 31 controllers spell out. */
  skip: number;
}

export interface ListQueryOptions {
  defaultLimit?: number;
  /** Upper bound on `limit`, whatever the caller asks for. */
  maxLimit?: number;
}

/**
 * `{ page, limit, search, skip }` from a request query.
 *
 * Takes the query object rather than the whole `Request` so it stays trivially
 * testable and does not drag Express into a pure module.
 */
export function parseListQuery(
  query: Record<string, unknown> | undefined,
  { defaultLimit = 10, maxLimit = 200 }: ListQueryOptions = {},
): ListQuery {
  const q = query ?? {};
  const page = toPositiveInt(q.page, 1);
  const limit = Math.min(toPositiveInt(q.limit, defaultLimit), maxLimit);
  const raw = q.search;
  const search = typeof raw === 'string' ? raw.trim() : '';
  return { page, limit, search, skip: (page - 1) * limit };
}
