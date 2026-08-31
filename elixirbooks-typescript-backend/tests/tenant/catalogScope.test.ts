/**
 * tests/tenant/catalogScope.test.ts
 *
 * P4 regression tripwire for the twelve tables that were INSTALL-GLOBAL until
 * this phase: Product, Brand, Category, Unit, TaxGroup, ExpenseCategory,
 * CustomField(+Value,+DataType), EmailTemplate, GeneralSetting and Currency.
 *
 * These never had a tenant column at all, so their controllers had nothing to
 * filter by — `prisma.brand.findMany({ where })` with an empty `where` was
 * CORRECT code against the old schema and a total leak against the new one.
 * That makes them a different risk from the models P0–P3 touched: no compiler
 * error marks a missing filter on a read, and no test failed when the column
 * appeared. This suite is the check that would have failed.
 *
 * Shape follows the existing `*.tenantScope.test.ts` files: vi.hoisted mocks,
 * vi.mock('../../lib/prisma'), assert the `where` handed to prisma. The
 * assertion is deliberately about the ARGUMENTS rather than the response —
 * a handler that returns nothing because the mock returned nothing proves
 * nothing; a handler that asked the database for `tenantId: 'tenant-a'` does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-a';

type Args = { where?: Record<string, unknown> };

const m = vi.hoisted(() => {
  const mk = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  });
  return {
    brand: mk(),
    category: mk(),
    unit: mk(),
    taxGroup: mk(),
    expenseCategory: mk(),
    currency: mk(),
    emailTemplate: mk(),
    customField: mk(),
    customFieldDataType: mk(),
    generalSetting: mk(),
    product: mk(),
    inventory: mk(),
    taxRate: mk(),
    notificationType: mk(),
    fieldType: mk(),
    module: mk(),
  };
});

vi.mock('../../lib/prisma', () => ({
  prisma: {
    ...m,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(m)),
  },
}));

import { getAllBrands, getBrandById } from '../../controllers/BrandsController';
import { getAllCategories, getCategoryById } from '../../controllers/CategoryController';
import { getUnits, getUnitById } from '../../controllers/UnitsController';
import { getAllTaxGroups, getTaxGroupById } from '../../controllers/TaxGroupController';
import { getAllExpenseCategories } from '../../controllers/expenseCategoryController';
import { getAllCurrencies } from '../../controllers/currencyController';
import { listEmailTemplates } from '../../controllers/emailTeamplateController';
import { getCustomFields } from '../../controllers/customFieldController';
import { getAllCustomFieldDataTypes } from '../../controllers/customFieldDataTypeController';
import { listGeneralSettings } from '../../controllers/CompanySettingsController';
import { getAllProducts } from '../../controllers/ProductController';

function makeReqRes(overrides: Partial<Request> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: 'user-1',
    query: {},
    params: {},
    body: {},
    protocol: 'http',
    get: () => 'localhost',
    ...overrides,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

/** Every `where` this delegate was asked for must name our tenant. */
function expectAllScoped(delegate: Record<string, ReturnType<typeof vi.fn>>, name: string) {
  const calls: Args[] = [];
  for (const fn of Object.values(delegate)) {
    for (const call of fn.mock.calls) {
      if (call[0] && typeof call[0] === 'object' && 'where' in call[0]) calls.push(call[0] as Args);
    }
  }
  expect(calls.length, `${name}: expected at least one query`).toBeGreaterThan(0);
  for (const args of calls) {
    expect(args.where, `${name}: a query went out with no tenant filter`).toMatchObject({
      tenantId: TENANT_ID,
    });
  }
}

beforeEach(() => {
  for (const delegate of Object.values(m)) {
    for (const fn of Object.values(delegate)) {
      fn.mockReset();
      fn.mockResolvedValue(null);
    }
    delegate.findMany.mockResolvedValue([]);
    delegate.count.mockResolvedValue(0);
  }
  m.module.findFirst.mockResolvedValue({ id: 'mod-1' });
});

describe('formerly-global catalogs are read per tenant', () => {
  it('Brand list and get', async () => {
    let { req, res } = makeReqRes();
    await getAllBrands(req, res);
    ({ req, res } = makeReqRes({ params: { id: 'b-1' } as never }));
    await getBrandById(req, res);
    expectAllScoped(m.brand, 'Brand');
  });

  it('Category list and get', async () => {
    let { req, res } = makeReqRes();
    await getAllCategories(req, res);
    ({ req, res } = makeReqRes({ params: { id: 'c-1' } as never }));
    await getCategoryById(req, res);
    expectAllScoped(m.category, 'Category');
  });

  it('Unit list and get', async () => {
    let { req, res } = makeReqRes();
    await getUnits(req, res);
    ({ req, res } = makeReqRes({ params: { id: 'u-1' } as never }));
    await getUnitById(req, res);
    expectAllScoped(m.unit, 'Unit');
  });

  it('TaxGroup list and get', async () => {
    let { req, res } = makeReqRes();
    await getAllTaxGroups(req, res);
    ({ req, res } = makeReqRes({ params: { id: 'tg-1' } as never }));
    await getTaxGroupById(req, res);
    expectAllScoped(m.taxGroup, 'TaxGroup');
  });

  it('ExpenseCategory list', async () => {
    const { req, res } = makeReqRes();
    await getAllExpenseCategories(req, res);
    expectAllScoped(m.expenseCategory, 'ExpenseCategory');
  });

  it('Currency list', async () => {
    const { req, res } = makeReqRes();
    await getAllCurrencies(req, res);
    expectAllScoped(m.currency, 'Currency');
  });

  it('EmailTemplate list', async () => {
    const { req, res } = makeReqRes();
    await listEmailTemplates(req, res);
    expectAllScoped(m.emailTemplate, 'EmailTemplate');
  });

  it('CustomField list', async () => {
    const { req, res } = makeReqRes();
    await getCustomFields(req, res);
    expectAllScoped(m.customField, 'CustomField');
  });

  it('CustomFieldDataType list', async () => {
    const { req, res } = makeReqRes();
    await getAllCustomFieldDataTypes(req, res);
    expectAllScoped(m.customFieldDataType, 'CustomFieldDataType');
  });

  it('GeneralSetting list', async () => {
    const { req, res } = makeReqRes();
    await listGeneralSettings(req, res);
    expectAllScoped(m.generalSetting, 'GeneralSetting');
  });

  it('Product list', async () => {
    const { req, res } = makeReqRes();
    await getAllProducts(req, res);
    expectAllScoped(m.product, 'Product');
  });
});

describe('a foreign id is not readable', () => {
  // The single-row handlers moved from findUnique({ id }) to
  // findFirst({ id, tenantId }); with the tenant filter in place another
  // company's id simply misses, which is the 404 this asserts.
  it.each([
    ['Brand', getBrandById, m.brand],
    ['Category', getCategoryById, m.category],
    ['Unit', getUnitById, m.unit],
    ['TaxGroup', getTaxGroupById, m.taxGroup],
  ] as const)('%s get by a foreign id 404s', async (_name, handler, delegate) => {
    delegate.findFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ params: { id: 'owned-by-tenant-b' } as never });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'owned-by-tenant-b', tenantId: TENANT_ID }),
      }),
    );
  });
});
