/**
 * tests/tenant/crossTenantLeak.test.ts
 *
 * The headline regression suite: run the highest-value READ endpoints as one
 * tenant and assert that every query they issue names that tenant.
 *
 * WHY THE ASSERTION IS ON THE ARGUMENTS, NOT THE RESPONSE. A handler that
 * returns nothing because a mocked client returned nothing proves nothing at
 * all. A handler that asked the database for `tenantId: 'tenant-a'` proves the
 * filter was there. This is the same reasoning — and the same
 * vi.hoisted + vi.mock('../../lib/prisma') shape — as the thirteen existing
 * `*.tenantScope.test.ts` files, extended across the read surface rather than
 * one controller at a time.
 *
 * WHY IT MATTERS WITH THE GUARD IN PLACE. lib/tenantGuard.ts is defence in
 * depth, not a replacement for scoping: it ships in `warn` mode, it cannot see
 * raw SQL, and it does not filter relation reads. A controller that scopes
 * itself is the first line; this suite is what keeps that line honest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT = 'tenant-a';

/** Every delegate method a read path might reach for. */
function delegate() {
  return {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  };
}

const MODELS = [
  'invoice', 'invoicePayment', 'quotation', 'creditNote', 'debitNote',
  'deliveryChallan', 'purchase', 'purchaseOrder', 'supplierPayment', 'expense',
  'expenseCategory', 'product', 'brand', 'category', 'unit', 'taxGroup',
  'taxRate', 'customer', 'contact', 'supplier', 'bankDetail', 'bankTransaction',
  'pettyCash', 'pettyCashTransaction', 'inventory', 'inventoryCostLayer',
  'account', 'journalEntry', 'journalLine', 'ledgerAccountMapping',
  'companySettings', 'currency', 'generalSetting', 'customField',
  'customFieldValue', 'emailTemplate', 'reminder', 'vehicle', 'signature',
  'localization', 'exchangeRate', 'costCenter', 'project', 'transactionCategory',
  'accountCreditEntry', 'refund', 'paymentTransaction', 'fixedAsset', 'budget',
  'accountingPeriod', 'invoiceTemplate', 'recurringInvoiceSchedule',
  // Explicit / global models the handlers also touch.
  'user', 'tenantMembership', 'auditLog', 'module', 'paymentMode', 'country',
  'state', 'city', 'notificationType', 'fieldType',
] as const;

const m = vi.hoisted(() => {
  const models = [
    'invoice', 'invoicePayment', 'quotation', 'creditNote', 'debitNote',
    'deliveryChallan', 'purchase', 'purchaseOrder', 'supplierPayment', 'expense',
    'expenseCategory', 'product', 'brand', 'category', 'unit', 'taxGroup',
    'taxRate', 'customer', 'contact', 'supplier', 'bankDetail', 'bankTransaction',
    'pettyCash', 'pettyCashTransaction', 'inventory', 'inventoryCostLayer',
    'account', 'journalEntry', 'journalLine', 'ledgerAccountMapping',
    'companySettings', 'currency', 'generalSetting', 'customField',
    'customFieldValue', 'emailTemplate', 'reminder', 'vehicle', 'signature',
    'localization', 'exchangeRate', 'costCenter', 'project', 'transactionCategory',
    'accountCreditEntry', 'refund', 'paymentTransaction', 'fixedAsset', 'budget',
    'accountingPeriod', 'invoiceTemplate', 'recurringInvoiceSchedule',
    'user', 'tenantMembership', 'auditLog', 'module', 'paymentMode', 'country',
    'state', 'city', 'notificationType', 'fieldType',
  ];
  const client: Record<string, unknown> = {};
  for (const name of models) {
    client[name] = {
      findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(),
      aggregate: vi.fn(), groupBy: vi.fn(), create: vi.fn(), createMany: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
      upsert: vi.fn(),
    };
  }
  return client;
});

vi.mock('../../lib/prisma', () => ({
  prisma: { ...m, $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(m)) },
  prismaUnscoped: { ...m, $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(m)) },
}));

import { getAllInvoices } from '../../controllers/Admin/Invoice/invoiceController';
import { listQuotations } from '../../controllers/Admin/Invoice/quotationController';
import { getAllCreditNotes } from '../../controllers/Admin/Invoice/creditNoteController';
import { getAllPurchases } from '../../controllers/Admin/Purchases/purchaseController';
import { listPurchaseOrders } from '../../controllers/Admin/Purchases/purchaseOrderController';
import { getAllExpenses } from '../../controllers/expenseController';
import { getAllProducts } from '../../controllers/ProductController';
import { getAllBrands } from '../../controllers/BrandsController';
import { getAllCategories } from '../../controllers/CategoryController';
import { listContacts } from '../../controllers/contactController';
import { listBankDetails } from '../../controllers/bankDetailController';
import { getAllCurrencies } from '../../controllers/currencyController';

/**
 * Models whose reads are legitimately unscoped: platform reference data, and
 * the four the guard classifies as EXPLICIT (scoped by hand, or actor-scoped).
 * Asserting on these would be asserting the wrong invariant.
 */
const NOT_TENANT_SCOPED = new Set([
  'user', 'tenantMembership', 'auditLog',
  'module', 'paymentMode', 'country', 'state', 'city', 'notificationType', 'fieldType',
]);

function makeReq(over: Partial<Request> = {}): Request {
  return {
    tenantId: TENANT,
    user: 'user-1',
    actor: { userId: 'user-1', tenantId: TENANT, membershipId: 'm1', roleId: 'r1', roleName: 'Owner', isOwner: true, perms: new Map() },
    query: {},
    params: {},
    body: {},
    headers: {},
    protocol: 'http',
    get: () => 'localhost',
    ...over,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {} as Record<string, unknown>;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res as unknown as Response;
}

/** Recursively: does this where clause constrain the tenant, anywhere? */
function namesTenant(where: unknown, depth = 0): boolean {
  if (!where || typeof where !== 'object' || depth > 5) return false;
  if (Array.isArray(where)) return where.some((w) => namesTenant(w, depth + 1));
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === 'tenantId' && value === TENANT) return true;
    // A relation filter (`{ purchase: { tenantId } }`) or a boolean combinator
    // both count — what matters is that the tenant appears in the predicate.
    if (value && typeof value === 'object' && namesTenant(value, depth + 1)) return true;
  }
  return false;
}

/** Every recorded call, across every mocked model, as `model.op(args)`. */
function recordedCalls(): Array<{ model: string; op: string; args: Record<string, unknown> }> {
  const out: Array<{ model: string; op: string; args: Record<string, unknown> }> = [];
  for (const model of MODELS) {
    const d = m[model] as Record<string, { mock: { calls: unknown[][] } }>;
    if (!d) continue;
    for (const [op, fn] of Object.entries(d)) {
      for (const call of fn.mock.calls) {
        if (call[0] && typeof call[0] === 'object') {
          out.push({ model, op, args: call[0] as Record<string, unknown> });
        }
      }
    }
  }
  return out;
}

beforeEach(() => {
  for (const model of MODELS) {
    const d = m[model] as Record<string, ReturnType<typeof vi.fn>>;
    for (const fn of Object.values(d)) {
      fn.mockReset();
      fn.mockResolvedValue(null);
    }
    d.findMany.mockResolvedValue([]);
    d.count.mockResolvedValue(0);
    d.aggregate.mockResolvedValue({ _sum: {}, _count: 0, _max: {}, _min: {} });
    d.groupBy.mockResolvedValue([]);
  }
  // A few reads the list handlers make unconditionally.
  (m.module as Record<string, ReturnType<typeof vi.fn>>).findFirst.mockResolvedValue({ id: 'mod-1' });
  (m.companySettings as Record<string, ReturnType<typeof vi.fn>>).findFirst.mockResolvedValue({
    id: 'cs1', taxRegime: 'NONE', functionalCurrency: 'GBP', ledgerInitialized: true,
  });
  (m.companySettings as Record<string, ReturnType<typeof vi.fn>>).findUnique.mockResolvedValue({
    id: 'cs1', taxRegime: 'NONE', functionalCurrency: 'GBP', ledgerInitialized: true,
  });
});

const ENDPOINTS: Array<[string, (req: Request, res: Response) => Promise<unknown>]> = [
  ['invoices', getAllInvoices],
  ['quotations', listQuotations],
  ['credit notes', getAllCreditNotes],
  ['purchases', getAllPurchases],
  ['purchase orders', listPurchaseOrders],
  ['expenses', getAllExpenses],
  ['products', getAllProducts],
  ['brands', getAllBrands],
  ['categories', getAllCategories],
  ['contacts', listContacts],
  ['bank details', listBankDetails],
  ['currencies', getAllCurrencies],
];

describe('list endpoints only ever ask for the acting tenant', () => {
  it.each(ENDPOINTS)('%s', async (_name, handler) => {
    await handler(makeReq(), makeRes());

    const calls = recordedCalls().filter(
      (c) => !NOT_TENANT_SCOPED.has(c.model) && 'where' in c.args,
    );

    // A handler that issued no scoped query at all would pass vacuously.
    expect(calls.length, 'expected at least one tenant-scoped query').toBeGreaterThan(0);

    const unscoped = calls.filter((c) => !namesTenant(c.args.where));
    expect(
      unscoped.map((c) => `${c.model}.${c.op}(${JSON.stringify(c.args.where)})`),
      'these queries went out without naming the acting tenant',
    ).toEqual([]);
  });
});

describe('a second tenant asks for its own rows, not the first tenant\'s', () => {
  it('the filter follows req.tenantId rather than being hard-coded', async () => {
    await getAllInvoices(makeReq({ tenantId: 'tenant-b' } as Partial<Request>), makeRes());
    const calls = recordedCalls().filter((c) => c.model === 'invoice' && 'where' in c.args);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(JSON.stringify(c.args.where)).toContain('tenant-b');
      expect(JSON.stringify(c.args.where)).not.toContain(TENANT);
    }
  });
});
