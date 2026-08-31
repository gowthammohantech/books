import { describe, it, expect } from 'vitest';

import { runWithAuditContext, getAuditContext } from '../../lib/auditContext';
import {
  getTenantId,
  isBypassed,
  runAsSystem,
  runAsTenant,
  setVerifiedTenantId,
  TenantContextMissingError,
} from '../../lib/tenantContext';

const ctx = (over: Record<string, unknown> = {}) =>
  ({ userName: 'test', ...over } as any);

describe('tenantContext', () => {
  it('reports no tenant and no bypass outside any scope', () => {
    expect(getTenantId()).toBeNull();
    expect(isBypassed()).toBe(false);
  });

  it('reads the tenant off the request-scoped store', () => {
    runWithAuditContext(ctx({ tenantId: 't1' }), () => {
      expect(getTenantId()).toBe('t1');
      expect(isBypassed()).toBe(false);
    });
  });

  describe('runAsTenant', () => {
    it('opens a scope with the given tenant', () => {
      runAsTenant('t1', () => {
        expect(getTenantId()).toBe('t1');
        expect(isBypassed()).toBe(false);
      });
    });

    it('restores the outer tenant when the callback returns', () => {
      runAsTenant('outer', () => {
        runAsTenant('inner', () => {
          expect(getTenantId()).toBe('inner');
        });
        expect(getTenantId()).toBe('outer');
      });
      expect(getTenantId()).toBeNull();
    });

    it('inherits the actor from the parent context', () => {
      runWithAuditContext(ctx({ userId: 'u1', userName: 'Asha' }), () => {
        runAsTenant('t1', () => {
          expect(getAuditContext()).toMatchObject({
            userId: 'u1',
            userName: 'Asha',
            tenantId: 't1',
          });
        });
      });
    });

    it('survives an await boundary', async () => {
      await runAsTenant('t1', async () => {
        await Promise.resolve();
        expect(getTenantId()).toBe('t1');
      });
      expect(getTenantId()).toBeNull();
    });

    it('rejects an empty tenant id rather than silently scoping to nothing', () => {
      expect(() => runAsTenant('', () => null)).toThrow(TenantContextMissingError);
    });

    it('clears an inherited bypass so nested work is scoped again', () => {
      runAsSystem(() => {
        runAsTenant('t1', () => {
          expect(isBypassed()).toBe(false);
          expect(getTenantId()).toBe('t1');
        });
        expect(isBypassed()).toBe(true);
      });
    });
  });

  describe('runAsSystem', () => {
    it('sets bypass and clears the tenant', () => {
      runAsSystem(() => {
        expect(isBypassed()).toBe(true);
        expect(getTenantId()).toBeNull();
      });
    });

    it('restores the surrounding tenant scope afterwards', () => {
      runAsTenant('t1', () => {
        runAsSystem(() => {
          expect(getTenantId()).toBeNull();
        });
        expect(getTenantId()).toBe('t1');
        expect(isBypassed()).toBe(false);
      });
    });
  });

  describe('setVerifiedTenantId', () => {
    it('overwrites the tenant on the current store in place', () => {
      runWithAuditContext(ctx({ tenantId: 'claimed' }), () => {
        setVerifiedTenantId('verified');
        expect(getTenantId()).toBe('verified');
      });
    });

    it('is a no-op outside a scope rather than throwing', () => {
      expect(() => setVerifiedTenantId('t1')).not.toThrow();
      expect(getTenantId()).toBeNull();
    });
  });
});
