// tests/requirePermission.test.ts
import { describe, it, expect, vi } from 'vitest';
import { requirePermission } from '../middleware/requirePermission';

function mkRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const perm = (o: Partial<Record<string, boolean>> = {}) => ({
  view: false, create: false, edit: false, delete: false, allowAll: false, ...o,
});

describe('requirePermission', () => {
  it('allows when the action flag is true', () => {
    const req: any = { actor: { perms: new Map([['invoices', perm({ view: true })]]) } };
    const res = mkRes(); const next = vi.fn();
    requirePermission('invoices', 'view')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows when allowAll is true regardless of action', () => {
    const req: any = { actor: { perms: new Map([['invoices', perm({ allowAll: true })]]) } };
    const res = mkRes(); const next = vi.fn();
    requirePermission('invoices', 'delete')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('403s when the action flag is false', () => {
    const req: any = { actor: { perms: new Map([['invoices', perm({ view: true })]]) } };
    const res = mkRes(); const next = vi.fn();
    requirePermission('invoices', 'create')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('403s when the module is absent or actor missing', () => {
    const res1 = mkRes(); const next1 = vi.fn();
    requirePermission('customers', 'view')({ actor: { perms: new Map() } } as any, res1, next1);
    expect(res1.status).toHaveBeenCalledWith(403);

    const res2 = mkRes(); const next2 = vi.fn();
    requirePermission('customers', 'view')({} as any, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(403);
  });

  // A shared reference-data endpoint (e.g. tax groups) that several document
  // types legitimately need can be gated on a LIST of modules — access is
  // granted if the actor has the action on ANY ONE of them, so a role with
  // just 'purchases' access (and no 'invoices') still isn't locked out.
  describe('array moduleSlug (any-of)', () => {
    it('allows when the actor has the action on any one of the listed modules', () => {
      const req: any = { actor: { perms: new Map([['purchase-list', perm({ view: true })]]) } };
      const res = mkRes(); const next = vi.fn();
      requirePermission(['invoices', 'purchase-list', 'quotations'], 'view')(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('403s when none of the listed modules grant the action', () => {
      const req: any = { actor: { perms: new Map([['invoices', perm({ view: true })]]) } };
      const res = mkRes(); const next = vi.fn();
      requirePermission(['purchase-list', 'quotations'], 'view')(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows via allowAll on any one listed module', () => {
      const req: any = { actor: { perms: new Map([['quotations', perm({ allowAll: true })]]) } };
      const res = mkRes(); const next = vi.fn();
      requirePermission(['invoices', 'quotations'], 'edit')(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
