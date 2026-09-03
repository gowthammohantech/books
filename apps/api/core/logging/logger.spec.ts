import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from './logger';
import { runWithAuditContext } from '../../lib/auditContext';
import { NotFoundError } from '../errors/appError';

const saved: Record<string, string | undefined> = {};
let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const k of ['LOG_LEVEL', 'NODE_ENV']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ['LOG_LEVEL', 'NODE_ENV']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('namespaces', () => {
  it('prefixes the namespace, matching the [boot] / [swagger] convention', () => {
    logger('ledger').info('posted');
    expect(log).toHaveBeenCalledWith('[ledger] posted');
  });

  it('nests a child namespace', () => {
    logger('ledger').child('posting').info('done');
    expect(log).toHaveBeenCalledWith('[ledger:posting] done');
  });

  it('routes warn and error to their own console methods', () => {
    logger('x').warn('careful');
    logger('x').error('broke');
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe('levels', () => {
  it('emits everything below production by default', () => {
    logger('x').debug('d');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('drops debug in production by default', () => {
    process.env.NODE_ENV = 'production';
    logger('x').debug('d');
    logger('x').info('i');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[x] i');
  });

  it('honours LOG_LEVEL over the NODE_ENV default', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'debug';
    logger('x').debug('d');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('silences everything below the floor', () => {
    process.env.LOG_LEVEL = 'error';
    const l = logger('x');
    l.debug('d');
    l.info('i');
    l.warn('w');
    l.error('e');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  // Read per call, not captured at import: dotenv runs after server.ts's imports.
  it('picks up a LOG_LEVEL set after the module was imported', () => {
    logger('x').debug('first');
    expect(log).toHaveBeenCalledTimes(1);
    process.env.LOG_LEVEL = 'warn';
    logger('x').debug('second');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('ignores an unrecognised LOG_LEVEL rather than silencing everything', () => {
    process.env.LOG_LEVEL = 'loud';
    logger('x').info('i');
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('correlation from the request-scoped store', () => {
  it('adds tenantId and userId with no call-site changes', () => {
    runWithAuditContext(
      { userName: 'Ada', userId: 'u1', tenantId: 't1' },
      () => logger('invoice').info('created'),
    );
    expect(log).toHaveBeenCalledWith('[invoice] created', { tenantId: 't1', userId: 'u1' });
  });

  it('emits a bare line outside a request', () => {
    logger('boot').info('migrations applied');
    expect(log).toHaveBeenCalledWith('[boot] migrations applied');
  });

  it('omits whichever correlation field is absent', () => {
    runWithAuditContext({ userName: 'system', tenantId: 't1' }, () => logger('cron').info('ran'));
    expect(log).toHaveBeenCalledWith('[cron] ran', { tenantId: 't1' });
  });

  it('lets explicit fields override correlation', () => {
    runWithAuditContext({ userName: 'Ada', tenantId: 't1' }, () =>
      logger('x').info('acting across tenants', { tenantId: 't2' }),
    );
    expect(log).toHaveBeenCalledWith('[x] acting across tenants', { tenantId: 't2' });
  });
});

describe('error rendering', () => {
  // toHttpError no longer returns these to the client, so the log is the only
  // place the real cause survives.
  it('keeps message and stack', () => {
    const err = new Error('connection refused');
    logger('db').error('query failed', err);
    const [, fields] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.err).toBe('connection refused');
    expect(fields.stack).toContain('connection refused');
  });

  // Every error class in this codebase sets this.name in its constructor, and
  // AppError does it automatically via new.target — which is what makes the
  // class visible here.
  it('names an error that carries its own name, as AppError subclasses do', () => {
    logger('invoice').error('rejected', new NotFoundError('Invoice not found'));
    const [, fields] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.errName).toBe('NotFoundError');
  });

  // A bare `class X extends Error {}` inherits name === 'Error', so there is
  // nothing to report; the message still is.
  it('omits errName for a subclass that never set one', () => {
    class Bare extends Error {}
    logger('x').error('odd', new Bare('no name'));
    const [, fields] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.errName).toBeUndefined();
    expect(fields.err).toBe('no name');
  });

  it('stringifies a non-Error throw', () => {
    logger('x').error('odd', 'just a string');
    const [, fields] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.err).toBe('just a string');
  });

  it('takes extra fields alongside the error', () => {
    logger('x').error('failed', new Error('boom'), { invoiceId: 'i1' });
    const [, fields] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.invoiceId).toBe('i1');
    expect(fields.err).toBe('boom');
  });

  it('handles error() with no error at all', () => {
    logger('x').error('just a message');
    expect(error).toHaveBeenCalledWith('[x] just a message');
  });
});
