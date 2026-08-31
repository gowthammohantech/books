/**
 * tests/tenant/tenantGuard.unit.test.ts
 *
 * The guard is a pure function, so it can be tested directly — no database, no
 * mocked client, no ambiguity about what it decided.
 *
 * The cases below are the contract: what happens per operation, what happens
 * with no tenant, what happens when a caller names a different tenant than the
 * one they are acting as, and — the property the whole rollout plan rests on —
 * that `warn` mode leaves every query argument untouched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  applyTenantGuard,
  assertBeforeRowInTenant,
  flattenCompoundKeys,
  mentionsTenant,
  guardMode,
  TenantMismatchError,
  ForeignTenantRowError,
  type GuardContext,
} from '../../lib/tenantGuard';
import { TenantContextMissingError } from '../../lib/tenantContext';

const T = 'tenant-a';
const OTHER = 'tenant-b';

const enforce: GuardContext = { tenantId: T, bypass: false, mode: 'enforce' };
const warn: GuardContext = { tenantId: T, bypass: false, mode: 'warn' };
const off: GuardContext = { tenantId: T, bypass: false, mode: 'off' };
const system: GuardContext = { tenantId: null, bypass: true, mode: 'enforce' };
const noTenant: GuardContext = { tenantId: null, bypass: false, mode: 'enforce' };

afterEach(() => vi.restoreAllMocks());

describe('mode selection', () => {
  it('defaults to warn, and only accepts the three known values', () => {
    const prev = process.env.TENANT_GUARD_MODE;
    try {
      delete process.env.TENANT_GUARD_MODE;
      expect(guardMode()).toBe('warn');
      process.env.TENANT_GUARD_MODE = 'enforce';
      expect(guardMode()).toBe('enforce');
      process.env.TENANT_GUARD_MODE = 'off';
      expect(guardMode()).toBe('off');
      process.env.TENANT_GUARD_MODE = 'nonsense';
      expect(guardMode()).toBe('warn'); // never silently off
    } finally {
      if (prev === undefined) delete process.env.TENANT_GUARD_MODE;
      else process.env.TENANT_GUARD_MODE = prev;
    }
  });
});

describe('reads and bulk writes', () => {
  it('merges the tenant filter with AND, not a spread', () => {
    // A spread would let a caller's OR sit beside the filter and re-widen the
    // query past this tenant.
    const d = applyTenantGuard('Invoice', 'findMany', {
      where: { OR: [{ status: 'PAID' }, { status: 'UNPAID' }] },
    }, enforce);
    expect(d.args).toEqual({
      where: { AND: [{ OR: [{ status: 'PAID' }, { status: 'UNPAID' }] }, { tenantId: T }] },
    });
  });

  it('scopes a query that had no where at all', () => {
    const d = applyTenantGuard('Product', 'findMany', {}, enforce);
    expect(d.args).toEqual({ where: { AND: [{}, { tenantId: T }] } });
  });

  it.each(['findFirst', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany'])(
    'scopes %s',
    (op) => {
      const d = applyTenantGuard('Expense', op, { where: { isDeleted: false } }, enforce);
      expect((d.args as { where: { AND: unknown[] } }).where.AND).toContainEqual({ tenantId: T });
    },
  );

  it('throws when the caller names a different tenant', () => {
    // Never silently overridden: an explicit mismatched filter is a bug, and
    // quietly correcting it would hide the bug and answer a question the caller
    // did not ask.
    expect(() =>
      applyTenantGuard('Invoice', 'findMany', { where: { tenantId: OTHER } }, enforce),
    ).toThrow(TenantMismatchError);
  });

  it('accepts a caller filter that names the SAME tenant', () => {
    expect(() =>
      applyTenantGuard('Invoice', 'findMany', { where: { tenantId: T } }, enforce),
    ).not.toThrow();
  });
});

describe('findUnique', () => {
  it('is post-checked rather than rewritten', () => {
    // A rewrite to findFirst would have to run on the base client, outside any
    // enclosing interactive $transaction, and would lose findUnique batching.
    const d = applyTenantGuard('Invoice', 'findUnique', { where: { id: 'i1' } }, enforce);
    expect(d.checkResultTenant).toBe(true);
    expect(d.args).toEqual({ where: { id: 'i1' } });
  });

  it('adds tenantId to a select that omits it, so there is something to check', () => {
    const d = applyTenantGuard('Invoice', 'findUnique', {
      where: { id: 'i1' }, select: { id: true, invoiceNumber: true },
    }, enforce);
    expect(d.args).toEqual({
      where: { id: 'i1' },
      select: { id: true, invoiceNumber: true, tenantId: true },
    });
  });

  it('leaves a select alone when it already asks for tenantId', () => {
    const args = { where: { id: 'i1' }, select: { id: true, tenantId: true } };
    const d = applyTenantGuard('Invoice', 'findUnique', args, enforce);
    expect(d.args).toEqual(args);
  });
});

describe('creates', () => {
  it('stamps tenantId onto create data', () => {
    const d = applyTenantGuard('Brand', 'create', { data: { brand_name: 'Acme' } }, enforce);
    expect(d.args).toEqual({ data: { brand_name: 'Acme', tenantId: T } });
  });

  it('stamps every element of a createMany', () => {
    const d = applyTenantGuard('Unit', 'createMany', {
      data: [{ unit_name: 'Pieces' }, { unit_name: 'Hours' }],
    }, enforce);
    expect(d.args).toEqual({
      data: [
        { unit_name: 'Pieces', tenantId: T },
        { unit_name: 'Hours', tenantId: T },
      ],
    });
  });

  it('stamps a nested create one level deep', () => {
    // Limitation 1: Prisma dispatches this as a single Invoice operation, so
    // the InvoicePayment rows are never offered to the extension separately.
    const d = applyTenantGuard('Invoice', 'create', {
      data: {
        invoiceNumber: 'INV-000001',
        payments: { create: [{ amount: 100 }, { amount: 50 }] },
      },
    }, enforce);
    const data = (d.args as { data: Record<string, any> }).data;
    expect(data.tenantId).toBe(T);
    expect(data.payments.create).toEqual([
      { amount: 100, tenantId: T },
      { amount: 50, tenantId: T },
    ]);
  });

  it('does NOT stamp a nested create whose target is a global model', () => {
    const d = applyTenantGuard('CustomField', 'create', {
      data: { labelName: 'PO Ref', module: { connect: { id: 'm1' } } },
    }, enforce);
    const data = (d.args as { data: Record<string, any> }).data;
    expect(data.tenantId).toBe(T);
    expect(data.module).toEqual({ connect: { id: 'm1' } });
  });

  it('throws when create data names a different tenant', () => {
    expect(() =>
      applyTenantGuard('Brand', 'create', { data: { brand_name: 'X', tenantId: OTHER } }, enforce),
    ).toThrow(TenantMismatchError);
  });
});

describe('single-record writes', () => {
  it.each(['update', 'delete', 'upsert'])('asks for a before-row check on %s', (op) => {
    const d = applyTenantGuard('Invoice', op, { where: { id: 'i1' }, data: {}, create: {} }, enforce);
    expect(d.checkBeforeTenant).toBe(true);
  });

  it('stamps the create branch of an upsert', () => {
    const d = applyTenantGuard('GeneralSetting', 'upsert', {
      where: { tenantId_key: { tenantId: T, key: 'k' } },
      create: { key: 'k', value: 1 },
      update: { value: 1 },
    }, enforce);
    expect((d.args as { create: Record<string, unknown> }).create).toEqual({
      key: 'k', value: 1, tenantId: T,
    });
  });

  it('refuses a row that belongs to another tenant', () => {
    expect(() => assertBeforeRowInTenant('Invoice', { id: 'i1', tenantId: OTHER }, enforce))
      .toThrow(ForeignTenantRowError);
  });

  it('shapes that refusal like Prisma P2025 so existing handling still works', () => {
    try {
      assertBeforeRowInTenant('Invoice', { id: 'i1', tenantId: OTHER }, enforce);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('P2025');
    }
  });

  it('allows a row that belongs to this tenant', () => {
    expect(() => assertBeforeRowInTenant('Invoice', { id: 'i1', tenantId: T }, enforce)).not.toThrow();
  });

  it('does NOT refuse when the before-row is null', () => {
    // Null means the row does not exist (Prisma raises its own P2025) or is
    // uncommitted inside this transaction. Neither is a cross-tenant access,
    // and treating them as one would break upsert-inside-transaction.
    expect(() => assertBeforeRowInTenant('Invoice', null, enforce)).not.toThrow();
  });
});

describe('models the guard does not touch', () => {
  it('passes global reference data through untouched', () => {
    const args = { where: { iso2: 'GB' } };
    expect(applyTenantGuard('Country', 'findMany', args, enforce).args).toBeUndefined();
  });

  it('passes explicitly-scoped models through untouched', () => {
    // User has no tenantId to filter on — one person belongs to N workspaces.
    // userController scopes it by hand through TenantMembership.
    for (const model of ['User', 'TenantMembership', 'LoginActivity', 'AuditLog']) {
      expect(applyTenantGuard(model, 'findMany', {}, enforce).args).toBeUndefined();
    }
  });
});

describe('context', () => {
  it('throws when a tenant model is queried with no tenant in context', () => {
    // Fail loud: every tenant's rows would be a leak, and none would be silent
    // data loss that looks like an empty account.
    expect(() => applyTenantGuard('Invoice', 'findMany', {}, noTenant))
      .toThrow(TenantContextMissingError);
  });

  it('passes everything through under runAsSystem', () => {
    expect(applyTenantGuard('Invoice', 'findMany', {}, system).args).toBeUndefined();
  });

  it('passes everything through when the mode is off', () => {
    expect(applyTenantGuard('Invoice', 'findMany', {}, off).args).toBeUndefined();
  });
});

describe('warn mode changes nothing', () => {
  it('never rewrites arguments, for any operation', () => {
    const cases: Array<[string, string, unknown]> = [
      ['Invoice', 'findMany', { where: { status: 'PAID' } }],
      ['Invoice', 'findUnique', { where: { id: 'i1' } }],
      ['Invoice', 'findUnique', { where: { id: 'i1' }, select: { id: true } }],
      ['Brand', 'create', { data: { brand_name: 'X' } }],
      ['Unit', 'createMany', { data: [{ unit_name: 'A' }] }],
      ['Invoice', 'update', { where: { id: 'i1' }, data: {} }],
      ['Invoice', 'deleteMany', { where: {} }],
    ];
    for (const [model, op, args] of cases) {
      // `undefined` is how the guard says "run exactly what the caller wrote".
      expect(applyTenantGuard(model, op, args, warn).args, `${model}.${op}`).toBeUndefined();
    }
  });

  it('reports a mismatch instead of throwing it', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      applyTenantGuard('Invoice', 'findMany', { where: { tenantId: OTHER } }, warn),
    ).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Tenant mismatch'));
  });

  it('reports a missing tenant context instead of throwing it', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = applyTenantGuard('Invoice', 'findMany', {}, { tenantId: null, bypass: false, mode: 'warn' });
    expect(d.args).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('NO TENANT in context'));
  });

  it('reports a query it would have narrowed', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyTenantGuard('Invoice', 'findMany', { where: { isDeleted: false } }, warn);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('would have been filtered by tenantId'));
  });

  it('stays quiet about a query that already scopes itself', () => {
    // Otherwise the ~95% of call sites that were already correct would bury the
    // signal from the ones that were not.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyTenantGuard('Invoice', 'findMany', { where: { tenantId: T, isDeleted: false } }, warn);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports a foreign row on a single-record write instead of refusing it', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertBeforeRowInTenant('Invoice', { id: 'i1', tenantId: OTHER }, warn)).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('owned by tenant'));
  });
});

describe('helpers', () => {
  it('flattens a compound unique key into plain scalar filters', () => {
    // findFirst takes a WhereInput, which has no notion of a compound unique
    // input — without this the audit before-read fails and takes the guard's
    // foreign-row check with it.
    expect(flattenCompoundKeys('GeneralSetting', { tenantId_key: { tenantId: T, key: 'k' } }))
      .toEqual({ tenantId: T, key: 'k' });
  });

  it('flattens a NAMED compound index too', () => {
    expect(
      flattenCompoundKeys('Customer', {
        customer_external_upsert_idx: { externalSource: 'x', externalRef: 'r', tenantId: T },
      }),
    ).toEqual({ externalSource: 'x', externalRef: 'r', tenantId: T });
  });

  it('leaves an ordinary where alone', () => {
    const w = { id: 'i1', isDeleted: false };
    expect(flattenCompoundKeys('Invoice', w)).toEqual(w);
  });

  it('does not mistake a relation filter for a compound key', () => {
    const w = { purchase: { tenantId: T } };
    expect(flattenCompoundKeys('SupplierPayment', w)).toEqual(w);
  });

  it('detects a tenant filter through AND/OR/NOT', () => {
    expect(mentionsTenant({ tenantId: T })).toBe(true);
    expect(mentionsTenant({ AND: [{ isDeleted: false }, { tenantId: T }] })).toBe(true);
    expect(mentionsTenant({ OR: [{ tenantId: T }] })).toBe(true);
    expect(mentionsTenant({ isDeleted: false })).toBe(false);
    expect(mentionsTenant(undefined)).toBe(false);
  });
});
