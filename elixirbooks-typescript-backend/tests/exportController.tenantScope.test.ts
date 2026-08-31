/**
 * tests/exportController.tenantScope.test.ts
 *
 * The export surface is the highest-consequence leak in the app: every other
 * endpoint returns a page of rows behind a UI, this one hands over a file. A
 * single missed filter here does not show a stray record in a list — it puts
 * another company's full ledger, customer list, product costs and margins into
 * a zip the user downloads and keeps.
 *
 * It was tenant-scoped before this conversion and stayed so through the P3
 * rename, with ONE exception the P4 sweep found: buildProducts carried a
 * comment saying the product catalogue was global, because until P4 it was.
 * That is exactly the kind of correct-then-wrong code that motivates checking
 * the whole surface rather than the parts that changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'stream';
import type { Request, Response } from 'express';

const TENANT = 'tenant-a';

const m = vi.hoisted(() => {
  const models = [
    'invoice', 'invoicePayment', 'creditNote', 'debitNote', 'purchase',
    'supplierPayment', 'expense', 'product', 'customer', 'contact', 'supplier',
    'bankTransaction', 'bankDetail', 'account', 'journalEntry', 'journalLine',
    'companySettings', 'project', 'timeEntry', 'leaveRequest', 'costCenter',
    'timesheet', 'payRun', 'payRunLine', 'payrollProfile', 'user',
  ];
  const client: Record<string, unknown> = {};
  for (const name of models) {
    client[name] = {
      findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
      count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(),
    };
  }
  return client;
});

vi.mock('../lib/prisma', () => ({
  prisma: m,
  prismaUnscoped: m,
}));

import * as exporter from '../controllers/exportController';

const MODELS = Object.keys(m);

/** User has no tenantId — one person, N workspaces — so it cannot be filtered. */
const NOT_TENANT_SCOPED = new Set(['user']);

function makeReq(tenantId = TENANT): Request {
  return {
    tenantId,
    user: 'user-1',
    query: {},
    params: {},
    headers: {},
    protocol: 'http',
    get: () => 'localhost',
  } as unknown as Request;
}

/**
 * A real writable stream wearing the Express response methods: the backup-zip
 * handler pipes an `archiver` into `res`, which needs `.on`/`.write`/`.end`
 * rather than a plain object of spies.
 */
function makeRes(): Response {
  const res = new PassThrough() as unknown as Record<string, unknown>;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.attachment = vi.fn(() => res);
  // Drain, so the pipe never blocks on backpressure in a test.
  (res as unknown as PassThrough).resume();
  return res as unknown as Response;
}

function namesTenant(where: unknown, wanted: string, depth = 0): boolean {
  if (!where || typeof where !== 'object' || depth > 5) return false;
  if (Array.isArray(where)) return where.some((w) => namesTenant(w, wanted, depth + 1));
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === 'tenantId' && value === wanted) return true;
    if (value && typeof value === 'object' && namesTenant(value, wanted, depth + 1)) return true;
  }
  return false;
}

function unscopedCalls(wanted: string): string[] {
  const bad: string[] = [];
  for (const model of MODELS) {
    if (NOT_TENANT_SCOPED.has(model)) continue;
    const d = m[model] as Record<string, { mock: { calls: unknown[][] } }>;
    for (const [op, fn] of Object.entries(d)) {
      for (const call of fn.mock.calls) {
        const args = call[0] as Record<string, unknown> | undefined;
        if (!args || typeof args !== 'object' || !('where' in args)) continue;
        if (!namesTenant(args.where, wanted)) {
          bad.push(`${model}.${op}(${JSON.stringify(args.where)})`);
        }
      }
    }
  }
  return bad;
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
    d.aggregate.mockResolvedValue({ _sum: {}, _count: 0 });
    d.groupBy.mockResolvedValue([]);
  }
  (m.companySettings as Record<string, ReturnType<typeof vi.fn>>).findFirst
    .mockResolvedValue({ id: 'cs1', ledgerInitialized: true, functionalCurrency: 'GBP' });
});

const CSV_EXPORTS: Array<[string, (req: Request, res: Response) => Promise<void>]> = [
  ['journal entries', exporter.exportJournalEntries],
  ['chart of accounts', exporter.exportChartOfAccounts],
  ['invoices', exporter.exportInvoices],
  ['invoice items', exporter.exportInvoiceItems],
  ['products', exporter.exportProducts],
  ['bank transactions', exporter.exportBankTransactions],
  ['customers', exporter.exportCustomers],
  ['trial balance', exporter.exportTrialBalance],
  ['balance sheet', exporter.exportBalanceSheet],
  ['profit and loss', exporter.exportProfitAndLoss],
  ['AR aging', exporter.exportArAging],
  ['AP aging', exporter.exportApAging],
];

describe('every CSV export asks only for the acting tenant', () => {
  it.each(CSV_EXPORTS)('%s', async (_name, handler) => {
    await handler(makeReq(), makeRes());
    expect(
      unscopedCalls(TENANT),
      'these export queries went out without naming the acting tenant',
    ).toEqual([]);
  });
});

describe('the products export', () => {
  it('is scoped — it was the ONE export that legitimately was not, until P4', async () => {
    await exporter.exportProducts(makeReq(), makeRes());
    const calls = (m.product as Record<string, { mock: { calls: unknown[][] } }>).findMany.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(JSON.stringify(call[0])).toContain(TENANT);
    }
  });
});

describe('the backup zip', () => {
  it('scopes every table it bundles', async () => {
    // The single highest-consequence surface: one missed filter here ships
    // another company's whole ledger as a file the user keeps.
    await exporter.exportBackupZip(makeReq(), makeRes());
    expect(unscopedCalls(TENANT)).toEqual([]);
  });

  it('follows req.tenantId rather than any hard-coded value', async () => {
    await exporter.exportBackupZip(makeReq('tenant-b'), makeRes());
    expect(unscopedCalls('tenant-b')).toEqual([]);
  });
});
