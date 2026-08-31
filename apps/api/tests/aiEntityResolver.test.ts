/**
 * tests/aiEntityResolver.test.ts
 *
 * Covers the Prisma port of services/ai/entityResolver.loadContext.
 *
 * The headline property is tenant isolation. Four of the eight Mongo queries
 * this replaced (products, tax groups, expense categories, supplier-users)
 * carried NO tenant filter, so one workspace's AI could resolve an entity name
 * against another workspace's records. Every query must now name `tenantId`
 * itself — lib/tenantGuard.ts ships in `warn` mode and does not filter, so
 * delegating to it would leave the hole open.
 *
 * The two shape contracts also matter: the ~450 lines of matching logic index
 * records by `_id`, and findTaxGroup reads `tax_rate_ids[].tax_rate`. Both are
 * produced by loadContext's mapping, so a regression there silently stops every
 * entity from resolving rather than throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.hoisted(() => ({
  customer: vi.fn(),
  supplier: vi.fn(),
  product: vi.fn(),
  taxGroup: vi.fn(),
  expenseCategory: vi.fn(),
  bankDetail: vi.fn(),
  paymentMode: vi.fn(),
  user: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const client = Object.fromEntries(
    Object.entries(findMany).map(([model, fn]) => [model, { findMany: fn }]),
  );
  return { prisma: client, prismaUnscoped: client };
});

import { loadContext } from '../services/ai/entityResolver';

const TENANT = 'tenant-a';

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(findMany)) fn.mockResolvedValue([]);
});

/** The single `where` each model was queried with. */
function whereFor(model: keyof typeof findMany): Record<string, unknown> {
  expect(findMany[model]).toHaveBeenCalledTimes(1);
  return findMany[model].mock.calls[0][0].where;
}

describe('loadContext — tenant isolation', () => {
  it.each(['customer', 'supplier', 'product', 'taxGroup', 'expenseCategory', 'bankDetail'] as const)(
    'scopes %s to the calling tenant',
    async (model) => {
      await loadContext(TENANT);
      expect(whereFor(model)).toMatchObject({ tenantId: TENANT });
    },
  );

  it('scopes supplier-users through TenantMembership, since User has no tenantId', async () => {
    await loadContext(TENANT);
    expect(whereFor('user')).toMatchObject({
      user_type: 2,
      memberships: { some: { tenantId: TENANT, status: 'ACTIVE' } },
    });
  });

  it('leaves PaymentMode unscoped — it is a global lookup table with no tenantId', async () => {
    await loadContext(TENANT);
    expect(whereFor('paymentMode')).not.toHaveProperty('tenantId');
  });

  it('excludes soft-deleted records from every table that has the column', async () => {
    await loadContext(TENANT);
    for (const model of ['customer', 'supplier', 'expenseCategory', 'bankDetail'] as const) {
      expect(whereFor(model)).toMatchObject({ isDeleted: false });
    }
  });
});

describe('loadContext — shapes the matchers depend on', () => {
  it('exposes Prisma `id` as `_id`, which the matching logic indexes by', async () => {
    findMany.customer.mockResolvedValue([
      { id: 'cus-1', name: 'Acme Ltd', email: 'a@acme.test', phone: null },
    ]);

    const context = await loadContext(TENANT);

    expect(context.customers[0]).toMatchObject({ _id: 'cus-1', name: 'Acme Ltd' });
    expect(context.customers[0]).not.toHaveProperty('id');
  });

  it('reshapes the tax_rates relation into the tax_rate_ids form findTaxGroup reads', async () => {
    findMany.taxGroup.mockResolvedValue([
      {
        id: 'tg-1',
        tax_name: 'GST 18%',
        tax_rates: [
          { id: 'tr-1', name: 'CGST', rate: '9' },
          { id: 'tr-2', name: 'SGST', rate: '9' },
        ],
      },
    ]);

    const context = await loadContext(TENANT);

    expect(context.taxGroups[0]).toMatchObject({ _id: 'tg-1', tax_name: 'GST 18%' });
    // findTaxGroup sums `tax_rate` across `tax_rate_ids` and compares it to a
    // number, so these must be numbers — Decimal instances would never match.
    const rates = context.taxGroups[0].tax_rate_ids;
    expect(rates).toEqual([
      { _id: 'tr-1', tax_name: 'CGST', tax_rate: 9 },
      { _id: 'tr-2', tax_name: 'SGST', tax_rate: 9 },
    ]);
    expect(rates.reduce((s: number, r: { tax_rate: number }) => s + r.tax_rate, 0)).toBe(18);
  });

  it('converts product Decimal prices to numbers — the resolver multiplies them by quantity', async () => {
    findMany.product.mockResolvedValue([
      {
        id: 'prod-1',
        name: 'Widget',
        code: 'W-1',
        selling_price: '250.5000',
        purchase_price: '200.0000',
        item_type: 'product',
      },
    ]);

    const context = await loadContext(TENANT);

    expect(context.products[0].selling_price).toBe(250.5);
    expect(typeof context.products[0].selling_price).toBe('number');
  });
});
