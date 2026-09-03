/**
 * Wraps an async route handler so a rejection reaches the error middleware.
 *
 * WHY IT IS SHORT: Express 5 already forwards a rejected promise from a route
 * handler to the error middleware — there is no `express-async-errors` shim in
 * this app, and two live routes (`gstFilingController.ts:79` and `:101`) have no
 * try/catch and depend on exactly that. So this adds no behaviour on its own.
 *
 * WHAT IT ADDS is a name for the intent. Of 623 try/catch blocks in
 * `controllers/`, the overwhelming majority end in a hand-rolled
 * `res.status(500).json(...)` that is strictly worse than doing nothing: it
 * turns a typed error the central handler would have translated into a 401, 404
 * or 409 into a flat 500, and until now it also leaked the message. Wrapping a
 * handler is the signal that it has no catch on purpose, rather than by
 * omission — which matters when the next reader is deciding whether to add one.
 *
 * The overload keeps `Request` generic parameters intact, so a handler typed
 * with route params does not lose them on the way through.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler<Req extends Request = Request>(
  fn: AsyncRequestHandler<Req>,
): RequestHandler {
  return function wrapped(req, res, next) {
    // The try/catch is not redundant with .catch(): a handler that throws
    // synchronously does so while `fn(...)` is being evaluated, before
    // Promise.resolve ever wraps it, so .catch() alone would let it escape.
    // An async function cannot do that, but the wrapper should not depend on
    // every caller having remembered the keyword.
    try {
      Promise.resolve(fn(req as Req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
}
