/**
 * Unit tests for documentDefaultsController (D.1)
 *
 * All Prisma calls are mocked — no live DB needed.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Hoist mock factories (vi.mock is hoisted to top of file, so variables
// referenced inside factory must also be hoisted via vi.hoisted)
// ---------------------------------------------------------------------------

const { mockFindUnique, mockFindFirst, mockUpsert, mockRequireUserId } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpsert: vi.fn(),
  mockRequireUserId: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    generalSetting: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
    currency: {
      findFirst: mockFindFirst,
    },
  },
}));

vi.mock('../lib/tenantScope', () => ({
  requireUserId: mockRequireUserId,
  UnauthorizedError: class UnauthorizedError extends Error {
    status = 401;
    constructor(message = 'Not authorized') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are set up
// ---------------------------------------------------------------------------

import {
  getDocumentDefaults,
  updateDocumentDefaults,
} from '../controllers/documentDefaultsController';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function makeReq(body: Record<string, unknown> = {}): Request {
  return { body, user: 'user-123' } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockReturnValue('user-123');
});

// ---------------------------------------------------------------------------
// GET /admin/document-defaults
// ---------------------------------------------------------------------------

describe('getDocumentDefaults', () => {
  it('returns all-fallback defaults when no row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({ code: 'USD' });

    const req = makeReq();
    const res = makeRes();
    await getDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as MockedFunction<typeof res.json>).mock.calls[0][0] as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(body.data.defaultCurrencyCode).toBe('USD');
    expect(body.data.defaultSignType).toBe('none');
    expect(body.data.defaultSignatureId).toBeNull();
    expect(body.data.paymentTermsDays).toBeNull();
    expect(body.data.defaultNotes).toBe('');
    expect(body.data.defaultTerms).toBe('');
  });

  it('returns stored values merged with fallbacks', async () => {
    mockFindUnique.mockResolvedValue({
      value: {
        defaultCurrencyCode: 'INR',
        defaultSignType: 'digitalSignature',
        defaultSignatureId: 'sig-1',
        paymentTermsDays: 30,
        defaultNotes: 'Thanks',
        defaultTerms: 'Net 30',
      },
    });
    mockFindFirst.mockResolvedValue({ code: 'USD' }); // fallback not used

    const req = makeReq();
    const res = makeRes();
    await getDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as MockedFunction<typeof res.json>).mock.calls[0][0] as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.data.defaultCurrencyCode).toBe('INR');
    expect(body.data.defaultSignType).toBe('digitalSignature');
    expect(body.data.defaultSignatureId).toBe('sig-1');
    expect(body.data.paymentTermsDays).toBe(30);
    expect(body.data.defaultNotes).toBe('Thanks');
    expect(body.data.defaultTerms).toBe('Net 30');
  });

  it('falls back to null for defaultCurrencyCode when no default currency exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null); // no default currency

    const req = makeReq();
    const res = makeRes();
    await getDocumentDefaults(req, res);

    const body = (res.json as MockedFunction<typeof res.json>).mock.calls[0][0] as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.data.defaultCurrencyCode).toBeNull();
  });

  it('returns 401 when user is not authenticated', async () => {
    // Throw an error that looks exactly like the mocked UnauthorizedError so
    // `handleUnauthorized` recognises it (instanceof check on the same class).
    const { UnauthorizedError } = await import('../lib/tenantScope');
    mockRequireUserId.mockImplementation(() => { throw new UnauthorizedError(); });

    const req = makeReq();
    const res = makeRes();
    await getDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 500 on prisma error', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB connection failed'));

    const req = makeReq();
    const res = makeRes();
    await getDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/document-defaults
// ---------------------------------------------------------------------------

describe('updateDocumentDefaults', () => {
  it('upserts a full set of defaults and returns them', async () => {
    mockFindUnique.mockResolvedValue(null); // no existing row
    mockFindFirst.mockResolvedValue({ code: 'USD' });
    mockUpsert.mockResolvedValue({});

    const req = makeReq({
      defaultCurrencyCode: 'EUR',
      defaultSignType: 'eSignature',
      defaultSignatureId: 'sig-abc',
      paymentTermsDays: 14,
      defaultNotes: 'note text',
      defaultTerms: 'term text',
    });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    expect(mockUpsert).toHaveBeenCalledOnce();
    const upsertArgs = mockUpsert.mock.calls[0][0] as {
      where: { key: string };
      create: { key: string; groupSlug: string; value: Record<string, unknown> };
      update: { value: Record<string, unknown> };
    };
    expect(upsertArgs.where).toEqual({ key: 'document_defaults' });
    expect(upsertArgs.create.groupSlug).toBe('documents');
    expect(upsertArgs.create.value).toMatchObject({
      defaultCurrencyCode: 'EUR',
      defaultSignType: 'eSignature',
      paymentTermsDays: 14,
    });

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as MockedFunction<typeof res.json>).mock.calls[0][0] as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(body.data.defaultCurrencyCode).toBe('EUR');
    expect(body.data.defaultSignType).toBe('eSignature');
    expect(body.data.paymentTermsDays).toBe(14);
  });

  it('partial PUT merges with existing stored value without wiping other fields', async () => {
    // Existing row has all fields set
    mockFindUnique.mockResolvedValue({
      value: {
        defaultCurrencyCode: 'INR',
        defaultSignType: 'none',
        defaultSignatureId: null,
        paymentTermsDays: 30,
        defaultNotes: 'original note',
        defaultTerms: 'original terms',
      },
    });
    mockFindFirst.mockResolvedValue({ code: 'USD' });
    mockUpsert.mockResolvedValue({});

    // Caller only sends defaultNotes — other fields must be preserved
    const req = makeReq({ defaultNotes: 'updated note' });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    const upsertArgs = mockUpsert.mock.calls[0][0] as {
      update: { value: Record<string, unknown> };
    };
    const merged = upsertArgs.update.value;
    expect(merged.defaultNotes).toBe('updated note');
    expect(merged.defaultCurrencyCode).toBe('INR'); // preserved
    expect(merged.paymentTermsDays).toBe(30); // preserved
    expect(merged.defaultTerms).toBe('original terms'); // preserved
  });

  it('rejects an invalid defaultSignType', async () => {
    const req = makeReq({ defaultSignType: 'badValue' });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('rejects a negative paymentTermsDays', async () => {
    const req = makeReq({ paymentTermsDays: -5 });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('accepts null paymentTermsDays (clears the field)', async () => {
    mockFindUnique.mockResolvedValue({
      value: { paymentTermsDays: 30, defaultNotes: 'x', defaultTerms: 'y' },
    });
    mockFindFirst.mockResolvedValue({ code: 'USD' });
    mockUpsert.mockResolvedValue({});

    const req = makeReq({ paymentTermsDays: null });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    const upsertArgs = mockUpsert.mock.calls[0][0] as {
      update: { value: Record<string, unknown> };
    };
    expect(upsertArgs.update.value.paymentTermsDays).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('coerces string paymentTermsDays to a number', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({ code: 'USD' });
    mockUpsert.mockResolvedValue({});

    const req = makeReq({ paymentTermsDays: '7' });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    const upsertArgs = mockUpsert.mock.calls[0][0] as {
      update: { value: Record<string, unknown> };
    };
    expect(upsertArgs.update.value.paymentTermsDays).toBe(7);
  });

  it('returns 401 when user is not authenticated', async () => {
    const { UnauthorizedError } = await import('../lib/tenantScope');
    mockRequireUserId.mockImplementation(() => { throw new UnauthorizedError(); });

    const req = makeReq({ defaultNotes: 'x' });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 500 on prisma error', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB down'));

    const req = makeReq({ defaultNotes: 'x' });
    const res = makeRes();
    await updateDocumentDefaults(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
