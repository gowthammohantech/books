/**
 * `toHttpError` / `prismaErrorHandler` — the app's last-resort error translator.
 *
 * It has had no coverage until now: the two supertest suites build their own
 * bare `express()` app rather than importing `server.ts`, so the handler mounted
 * at `server.ts:121` was never exercised by a test despite being the thing that
 * decides what every uncaught failure looks like to the client.
 *
 * Three defects are pinned here, all of which shipped:
 *   - an error carrying `status` was ignored, so an UnauthorizedError escaping a
 *     controller surfaced as 500 "Not authorized" instead of 401;
 *   - ForeignTenantRowError sets `code = 'P2025'` specifically so not-found
 *     handling works, but it is not a Prisma.PrismaClientKnownRequestError, so
 *     the instanceof check missed it and it became a 500 instead of a 404;
 *   - the 500 branch returned `err.message` verbatim to the caller.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

import { toHttpError, prismaErrorHandler } from '../middleware/prismaError';
import { UnauthorizedError as ScopeUnauthorizedError } from '../lib/tenantScope';
import { ForeignTenantRowError, TenantMismatchError } from '../lib/tenantGuard';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PeriodLockedError,
  UnauthorizedError,
  UnprocessableEntityError,
} from '../core/errors/appError';

function runHandler(err: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json, headersSent: false } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  prismaErrorHandler(err, {} as Request, res, next);
  return { res, json, next, body: json.mock.calls[0]?.[0] as Record<string, unknown> | undefined };
}

describe('toHttpError — errors that know their own status', () => {
  it.each([
    [new BadRequestError('bad'), 400],
    [new UnauthorizedError('nope'), 401],
    [new ForbiddenError('no'), 403],
    [new NotFoundError('gone'), 404],
    [new ConflictError('clash'), 409],
    [new UnprocessableEntityError('unprocessable'), 422],
    [new PeriodLockedError('locked'), 423],
  ])('maps %s to its declared status', (err, status) => {
    expect(toHttpError(err).status).toBe(status);
  });

  it('keeps the thrown message, which was written for the caller', () => {
    expect(toHttpError(new NotFoundError('Invoice not found')).message).toBe('Invoice not found');
  });

  it('carries field details through as `errors`, matching the validation contract', () => {
    const err = new BadRequestError('Validation failed', { invoiceNumber: 'already exists' });
    expect(toHttpError(err).details).toEqual({ invoiceNumber: 'already exists' });
    expect(runHandler(err).body).toEqual({
      success: false,
      message: 'Validation failed',
      errors: { invoiceNumber: 'already exists' },
    });
  });

  it('omits `errors` entirely when there are none', () => {
    expect(runHandler(new NotFoundError('gone')).body).toEqual({
      success: false,
      message: 'gone',
    });
  });
});

// The pre-existing classes are NOT re-pointed at AppError; they are honoured
// structurally, by carrying a numeric status. These pin that.
describe('toHttpError — the pre-existing status-bearing classes', () => {
  it('gives lib/tenantScope UnauthorizedError a 401, not a 500', () => {
    expect(toHttpError(new ScopeUnauthorizedError()).status).toBe(401);
  });

  it('gives ForeignTenantRowError a 404, not a 500', () => {
    // Its own docblock says it is "shaped like Prisma's P2025 so existing
    // not-found handling keeps working" — which was not true of this handler.
    expect(toHttpError(new ForeignTenantRowError('Invoice')).status).toBe(404);
  });

  it('gives TenantMismatchError a 403', () => {
    expect(toHttpError(new TenantMismatchError('Invoice', 'a', 'b')).status).toBe(403);
  });

  it('ignores a `status` that is not a plausible HTTP code', () => {
    // An unrelated property called `status` must not become the response code.
    const job = Object.assign(new Error('job failed'), { status: 'PENDING' });
    expect(toHttpError(job).status).toBe(500);
    const numeric = Object.assign(new Error('job failed'), { status: 7 });
    expect(toHttpError(numeric).status).toBe(500);
  });
});

describe('toHttpError — Prisma errors', () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: 'test',
      meta,
    });

  it('maps a unique violation to 409 naming the field', () => {
    const { status, message } = toHttpError(known('P2002', { target: ['email'] }));
    expect(status).toBe(409);
    expect(message).toContain('email');
  });

  it('maps a foreign-key violation to 400', () => {
    expect(toHttpError(known('P2003', { field_name: 'customerId' })).status).toBe(400);
  });

  it('maps a missing record to 404', () => {
    expect(toHttpError(known('P2025')).status).toBe(404);
  });

  it('maps an unrecognised Prisma code to 400 rather than 500', () => {
    expect(toHttpError(known('P2099')).status).toBe(400);
  });
});

describe('prismaErrorHandler — the 500 path does not leak', () => {
  it('never returns the message of an unrecognised error', () => {
    const secret = 'connect ECONNREFUSED 10.0.0.7:5432 password=hunter2';
    const { res, body } = runHandler(new Error(secret));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body).toEqual({ success: false, message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('logs the real error instead, so it is not simply lost', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('the real cause');
    runHandler(err);
    expect(spy).toHaveBeenCalledWith('Unhandled error:', err);
    spy.mockRestore();
  });

  it('does not log for a deliberate 4xx', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runHandler(new NotFoundError('gone'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('delegates to next() once the response has already been sent', () => {
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json, headersSent: true } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error('too late');
    prismaErrorHandler(err, {} as Request, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(json).not.toHaveBeenCalled();
  });
});
