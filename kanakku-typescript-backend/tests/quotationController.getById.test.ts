/**
 * tests/quotationController.getById.test.ts
 *
 * GET /api/admin/quotations/:id (getQuotationById) — the AUTHENTICATED admin edit-view
 * fetch. Wave-3 Task 1: the response must carry publicViewEnabled/publicViewToken so
 * the edit view / email-compose flow can read the existing public-link state directly,
 * instead of blind-POSTing enableQuotationPublicLink on every load just to discover
 * whether a link already exists (closes the W4 note).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockQuotationFindFirst } = vi.hoisted(() => ({
  mockQuotationFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    quotation: { findFirst: mockQuotationFindFirst },
  },
}));

import { getQuotationById } from '../controllers/Admin/Invoice/quotationController';

function makeReqRes(id: string) {
  const req = {
    params: { id },
    protocol: 'http',
    get: vi.fn().mockReturnValue('localhost'),
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

function baseQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    userId: 'user-1',
    quotationId: 'QT-000001',
    salesPerson: null,
    contactId: null,
    billToContactId: null,
    contact: null,
    billToContact: null,
    customer: null,
    user: null,
    billFromUser: null,
    billToCustomer: null,
    signature: null,
    sign_type: null,
    signatureName: null,
    signatureImage: null,
    bank: null,
    quotationDate: new Date('2026-07-01T00:00:00.000Z'),
    expiryDate: new Date('2026-07-31T00:00:00.000Z'),
    referenceNo: null,
    status: 'draft',
    paymentTerms: null,
    taxableAmount: 100,
    totalDiscount: 0,
    vat: 0,
    roundOff: 0,
    TotalAmount: 100,
    items: [],
    notes: null,
    termsAndCondition: null,
    convert_type: null,
    currencyCode: 'USD',
    taxTreatment: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    publicViewToken: null,
    publicViewEnabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getQuotationById — public-link state exposure', () => {
  it('returns publicViewEnabled=false / publicViewToken=null when no link has been created', async () => {
    mockQuotationFindFirst.mockResolvedValue(baseQuotation());
    const { req, res } = makeReqRes('q-1');

    await getQuotationById(req, res);

    expect(res.status).not.toHaveBeenCalledWith(404);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(payload.data.publicViewEnabled).toBe(false);
    expect(payload.data.publicViewToken).toBeNull();
  });

  it('returns the existing publicViewEnabled/publicViewToken when a link is already active', async () => {
    const token = 'c'.repeat(64);
    mockQuotationFindFirst.mockResolvedValue(
      baseQuotation({ publicViewEnabled: true, publicViewToken: token }),
    );
    const { req, res } = makeReqRes('q-1');

    await getQuotationById(req, res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(payload.data.publicViewEnabled).toBe(true);
    expect(payload.data.publicViewToken).toBe(token);
  });
});
