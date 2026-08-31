/**
 * tests/tenant/tenantContext.test.ts
 *
 * The scope wrappers, and one subtlety that is easy to reintroduce and silent
 * when you do.
 *
 * A Prisma query object is LAZY: it does not run until something awaits it. So
 * `await runAsTenant(id, () => prisma.invoice.findMany())` — the obvious way to
 * write it, and the way the crons in P7 will — used to return the UNSTARTED
 * query, get awaited after the AsyncLocalStorage scope had already closed, and
 * execute with no tenant at all. In warn mode that is a silently unscoped
 * query; in enforce mode it is a thrown error on a cron nobody is watching.
 *
 * The wrappers now adopt a returned thenable inside the scope. These tests pin
 * that, using a hand-rolled lazy thenable so the behaviour is visible without a
 * database.
 */
import { describe, it, expect } from 'vitest';

import {
  runAsSystem,
  runAsTenant,
  getTenantId,
  isBypassed,
  setVerifiedTenantId,
  TenantContextMissingError,
} from '../../lib/tenantContext';
import { runWithAuditContext, getAuditContext } from '../../lib/auditContext';

/**
 * Reads the tenant only when someone actually subscribes — the same laziness a
 * Prisma query object has, which is what makes this whole class of bug
 * possible.
 */
function lazyTenantProbe(): PromiseLike<string> {
  return {
    then: ((onFulfilled?: (v: string) => unknown) => {
      const seen = getTenantId() ?? 'NONE';
      return Promise.resolve(onFulfilled ? onFulfilled(seen) : seen);
    }) as PromiseLike<string>['then'],
  };
}

describe('scope wrappers', () => {
  it('runAsTenant puts the tenant on the context', () => {
    runAsTenant('t-1', () => {
      expect(getTenantId()).toBe('t-1');
      expect(isBypassed()).toBe(false);
    });
  });

  it('runAsSystem bypasses instead of naming a tenant', () => {
    runAsSystem(() => {
      expect(getTenantId()).toBeNull();
      expect(isBypassed()).toBe(true);
    });
  });

  it('restores the previous scope afterwards', () => {
    runAsTenant('outer', () => {
      runAsTenant('inner', () => expect(getTenantId()).toBe('inner'));
      expect(getTenantId()).toBe('outer');
    });
    expect(getTenantId()).toBeNull();
  });

  it('rejects an empty tenant id rather than opening an unscoped scope', () => {
    expect(() => runAsTenant('', () => null)).toThrow(TenantContextMissingError);
  });
});

describe('lazily-started work starts INSIDE the scope', () => {
  it('runAsTenant: a returned thenable still sees the tenant', async () => {
    // Without the adoption in runIn(), this resolves to 'NONE'.
    await expect(runAsTenant('t-9', () => lazyTenantProbe())).resolves.toBe('t-9');
  });

  it('runAsSystem: a returned thenable still sees the bypass', async () => {
    const bypassed = await runAsSystem(() => ({
      then: (r: (v: boolean) => void) => r(isBypassed()),
    }) as PromiseLike<boolean>);
    expect(bypassed).toBe(true);
  });

  it('an async callback keeps working, unchanged', async () => {
    await expect(
      runAsTenant('t-2', async () => {
        await Promise.resolve();
        return getTenantId();
      }),
    ).resolves.toBe('t-2');
  });

  it('a plain synchronous value passes straight through', () => {
    expect(runAsTenant('t-3', () => 41 + 1)).toBe(42);
  });

  it('the tenant survives several await hops', async () => {
    const seen = await runAsTenant('t-4', async () => {
      await new Promise((r) => setTimeout(r, 1));
      await Promise.resolve();
      return getTenantId();
    });
    expect(seen).toBe('t-4');
  });

  it('a rejection still propagates', async () => {
    await expect(
      runAsTenant('t-5', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});

describe('setVerifiedTenantId', () => {
  it('promotes the tenant on the CURRENT scope without opening a new one', () => {
    // authMiddleware.protect runs inside the scope middleware/auditContext.ts
    // opened, so it cannot call storage.run again without ending that scope
    // when it returns. Mutating the stored object is correct here, and only here.
    runWithAuditContext({ userName: 'test', tenantId: 'claimed-by-jwt' }, () => {
      expect(getTenantId()).toBe('claimed-by-jwt');
      setVerifiedTenantId('verified-by-membership');
      expect(getTenantId()).toBe('verified-by-membership');
      expect(getAuditContext()?.tenantId).toBe('verified-by-membership');
    });
  });

  it('is a no-op outside any scope rather than throwing', () => {
    expect(() => setVerifiedTenantId('x')).not.toThrow();
  });
});
