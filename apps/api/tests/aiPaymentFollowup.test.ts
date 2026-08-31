/**
 * tests/aiPaymentFollowup.test.ts
 *
 * Covers the Prisma port of services/ai/paymentFollowup.getOverdueInvoices,
 * which backs the overdue list and the AI-drafted payment chaser. It queried a
 * Mongo instance that no longer exists, so it reported nothing overdue however
 * many invoices were outstanding.
 *
 * The port also fixes a party-resolution mismatch: the Mongo version read only
 * the legacy `customer` relation, so new-flow invoices (which set `contactId`
 * and leave `customer` null) showed as "Unknown" here while
 * aiController.generateFollowup — already contact-first — named them correctly.
 * Both paths must agree, or the list and the drafted email disagree about who
 * is being chased.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoiceFindMany = vi.hoisted(() => vi.fn());

vi.mock('../lib/prisma', () => {
  const client = { invoice: { findMany: mockInvoiceFindMany } };
  return { prisma: client, prismaUnscoped: client };
});

import { getOverdueInvoices } from '../services/ai/paymentFollowup';

const TENANT = 'tenant-a';

function invoice(overrides: Record<string, unknown> = {}) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() - 10);
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-1',
    TotalAmount: '1500.0000',
    status: 'SENT',
    invoiceDate: new Date('2026-07-01'),
    dueDate,
    contact: null,
    billToContact: null,
    customer: null,
    billToCustomer: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceFindMany.mockResolvedValue([]);
});

describe('getOverdueInvoices — query', () => {
  it('selects unsettled invoices past their due date, for this tenant only', async () => {
    await getOverdueInvoices(TENANT);

    const args = mockInvoiceFindMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ tenantId: TENANT, isDeleted: false });
    expect(args.where.status).toEqual({ in: ['SENT', 'UNPAID', 'OVERDUE', 'PARTIALLY_PAID'] });
    expect(args.where.dueDate.lt).toBeInstanceOf(Date);
    expect(args.orderBy).toEqual({ dueDate: 'asc' });
  });
});

describe('getOverdueInvoices — party resolution', () => {
  it('prefers the contact over the legacy customer, matching generateFollowup', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      invoice({
        contact: {
          firstName: 'Jo',
          lastName: 'Patel',
          organisation: null,
          email: 'jo@contact.test',
        },
        customer: { name: 'Stale Legacy Name', email: 'stale@legacy.test', phone: null },
      }),
    ]);

    const [row] = await getOverdueInvoices(TENANT);

    expect(row.customerName).toBe('Jo Patel');
    expect(row.customerEmail).toBe('jo@contact.test');
  });

  it('uses the contact organisation when there is one', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      invoice({
        contact: {
          firstName: 'Jo',
          lastName: 'Patel',
          organisation: 'Acme Ltd',
          email: 'ap@acme.test',
        },
      }),
    ]);

    const [row] = await getOverdueInvoices(TENANT);

    expect(row.customerName).toBe('Acme Ltd');
  });

  it('falls back to the legacy customer for older invoices', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      invoice({ customer: { name: 'Legacy Co', email: 'legacy@test', phone: null } }),
    ]);

    const [row] = await getOverdueInvoices(TENANT);

    expect(row.customerName).toBe('Legacy Co');
    expect(row.customerEmail).toBe('legacy@test');
  });

  it('reports Unknown, not a crash, when an invoice has no party at all', async () => {
    mockInvoiceFindMany.mockResolvedValue([invoice()]);

    const [row] = await getOverdueInvoices(TENANT);

    expect(row.customerName).toBe('Unknown');
    expect(row.customerEmail).toBeNull();
  });
});

describe('getOverdueInvoices — derived fields', () => {
  it('converts the Decimal total to a number for the prompt and JSON response', async () => {
    mockInvoiceFindMany.mockResolvedValue([invoice({ TotalAmount: '1500.5000' })]);

    const [row] = await getOverdueInvoices(TENANT);

    expect(row.TotalAmount).toBe(1500.5);
    expect(typeof row.TotalAmount).toBe('number');
  });

  it('counts whole days overdue from the due date', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 45);
    mockInvoiceFindMany.mockResolvedValue([invoice({ dueDate })]);

    const [row] = await getOverdueInvoices(TENANT);

    expect(row.daysOverdue).toBe(45);
  });
});
