/**
 * The success half of the response contract.
 *
 * `lib/responses.ts` was the slot for this and stood empty — its one export was
 * deleted when the Mongo id alias went, leaving a four-line file. Failures are
 * already centralised in `middleware/prismaError.ts`; this is the other side.
 *
 * SHAPE IS DICTATED BY THE CENSUS, NOT BY TASTE. Across ~2,000 object responses
 * in `controllers/`:
 *
 *   994  { success, message }            <- the most common response by far
 *   205  { success, message, data }
 *   205  { success, data }
 *    47  { success, message, errors }    <- the 422 field-map contract
 *
 * so a helper modelling only `{ success, message, data }` would not fit three
 * quarters of its callers. `message` is therefore optional on `ok`, and `errors`
 * (a `Record<string, string>` field map, distinct from the singular `error`
 * key that carries an exception string) is preserved verbatim because
 * `middleware/handleValidationResult.ts` emits it and the SPA parses it.
 *
 * PAGINATION goes INSIDE `data`. That is the majority placement (47 nested
 * against 19 as a sibling) and the one `apps/web/src/types/apiResponses.ts`
 * already models. The key set is `{ total, page, limit, totalPages }`, used by
 * 60 of the 66 paginated responses; the three outliers (`totalRecords`,
 * `pageSize`, `{ limit, returned }`) are left alone rather than migrated here.
 *
 * NOTHING ADOPTS THIS YET. It exists so the service extraction has one shape to
 * write against; the ~2,000 existing responses migrate with their modules.
 */
import type { Response } from 'express';

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** `{ total, page, limit, totalPages }` from a count and the query that produced it. */
export function toPagination(total: number, page: number, limit: number): Pagination {
  return {
    total,
    page,
    limit,
    // A zero limit would divide to Infinity; a page of nothing is one page.
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/** A page of rows under a named key, e.g. `{ invoices: [...], pagination }`. */
export function paginated<T>(
  key: string,
  rows: T[],
  page: Pagination,
): Record<string, unknown> {
  return { [key]: rows, pagination: page };
}

export const ApiResponse = {
  /** 200 with an optional payload and message. */
  ok<T>(res: Response, data?: T, message?: string): void {
    res.status(200).json({
      success: true,
      ...(message !== undefined ? { message } : {}),
      ...(data !== undefined ? { data } : {}),
    });
  },

  /** 201 for a create. `message` is required: a create is worth naming. */
  created<T>(res: Response, data: T, message: string): void {
    res.status(201).json({ success: true, message, data });
  },

  /**
   * 200 with a page of rows nested under `data`, matching the majority shape:
   *   { success, message, data: { <key>: [...], pagination: {...} } }
   */
  page<T>(res: Response, key: string, rows: T[], p: Pagination, message?: string): void {
    res.status(200).json({
      success: true,
      ...(message !== undefined ? { message } : {}),
      data: paginated(key, rows, p),
    });
  },

  /** 204. No body — do not send one; some clients choke on it. */
  noContent(res: Response): void {
    res.status(204).send();
  },
} as const;
