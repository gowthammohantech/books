// controllers/supplierBalancesController.spec.ts
//
// P1 final review — finding 3: supplier balances must only count POSTED debit
// notes. A draft ('new') DN does NOT post to the AP GL (Task 4 gate), so it must
// NOT reduce the displayed payable, or the report disagrees with the AP control.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Dataset the mock filters honour the controller's `where.status` clause against.
const DEBIT_NOTES = [
  { contactId: 'ct1', status: 'issued', totalAmount: '50', contact: { firstName: 'Acme', lastName: null, organisation: null } },
  // A DRAFT DN — must be excluded by the posted-gate (notIn ['new','cancelled']).
  { contactId: 'ct1', status: 'new', totalAmount: '999', contact: { firstName: 'Acme', lastName: null, organisation: null } },
  { contactId: 'ct1', status: 'cancelled', totalAmount: '777', contact: { firstName: 'Acme', lastName: null, organisation: null } },
];

function applyStatusFilter<T extends { status: string }>(rows: T[], where: any): T[] {
  const s = where?.status;
  return rows.filter((r) => {
    if (s?.notIn) return !s.notIn.includes(r.status);
    if (s?.not) return r.status !== s.not;
    return true;
  });
}

const debitNoteWhereSpy = vi.fn();

vi.mock('../lib/prisma', () => ({
  prisma: {
    purchase: {
      findMany: vi.fn().mockResolvedValue([
        { contactId: 'ct1', totalAmount: '100', contact: { firstName: 'Acme', lastName: null, organisation: null } },
      ]),
    },
    supplierPayment: { findMany: vi.fn().mockResolvedValue([]) },
    debitNote: {
      findMany: vi.fn().mockImplementation(async (args: any) => {
        debitNoteWhereSpy(args.where);
        return applyStatusFilter(DEBIT_NOTES, args.where);
      }),
    },
  },
}));

vi.mock('../lib/contacts/contactIdentity', () => ({
  resolveDisplayName: (b: { firstName?: string | null }) => b.firstName ?? 'Unknown',
}));

import { supplierBalances } from './supplierBalancesController';

function fakeRes() {
  return {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() {},
    send() {},
  };
}

const req = { query: {}, path: '/reports/supplier-balances', originalUrl: '/reports/supplier-balances', user: 'u1' } as never;

beforeEach(() => vi.clearAllMocks());

describe('supplierBalances — finding 3: draft debit notes must not reduce payable', () => {
  it('excludes a draft (new) DN and a cancelled DN; only the posted DN reduces the balance', async () => {
    const res = fakeRes();
    await supplierBalances(req, res as never);

    // The DN query must use the posted-gate matching the bill filter.
    expect(debitNoteWhereSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: { notIn: ['new', 'cancelled'] } }),
    );

    const row = res.body.data.rows.find((r: any) => r.contactId === 'ct1');
    expect(row).toBeTruthy();
    // bills 100 − posted DN 50 = 50. Draft 999 and cancelled 777 excluded.
    expect(row.paymentsAndReturns).toBe('50');
    expect(row.balance).toBe('50');
  });
});
