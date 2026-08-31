// lib/documentNumbering.spec.ts
//
// Primary coverage for lib/documentNumbering.ts, shared by the five callers
// that used to duplicate it byte-for-byte (creditNote/debitNote/purchase/
// supplierPayment controllers + lib/ledger/applyBillPayment.ts):
// nextDocumentNumber(), isNumberFieldConflict(), withDocumentNumberRetry()
// (success, retry-then-succeed, retries exhausted) and handleNumberConflict().
//
// The install-wide clash-check/fallback branch was deleted in P4 along with
// the install-wide @unique it existed to work around, so the tests for it are
// gone too. What replaces them is the assertion that a second tenant with no
// rows starts at 000001 even though another tenant already holds that number
// — the behaviour the fallback used to prevent.
import { describe, it, expect, vi } from 'vitest';

import {
  nextDocumentNumber,
  isNumberFieldConflict,
  withDocumentNumberRetry,
  handleNumberConflict,
  MAX_NUMBER_RETRIES,
  type NumberingModel,
} from './documentNumbering';

function p2002(field: string): Error & { code: string; meta: { target: string[] } } {
  const err = new Error('Unique constraint failed') as Error & { code: string; meta: { target: string[] } };
  err.code = 'P2002';
  err.meta = { target: [field] };
  return err;
}

describe('nextDocumentNumber', () => {
  it("continues this tenant's series, with a single scoped query", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ debitNoteId: 'DN-000004' });
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'debitNoteId',
      prefix: 'DN-',
      tenantWhere: { tenantId: 'tenant-1' },
    });

    expect(result).toBe('DN-000005');
    // Exactly one read: the install-wide clash probe and its fallback query
    // were deleted in P4.
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { debitNoteId: { not: null }, tenantId: 'tenant-1' },
      orderBy: { createdAt: 'desc' },
      select: { debitNoteId: true },
    });
  });

  it('starts a fresh tenant at 000001 when it has no prior rows', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null);
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'paymentId',
      prefix: 'PAY-',
      tenantWhere: { purchase: { tenantId: 'tenant-1' } },
    });

    expect(result).toBe('PAY-000001');
  });

  it('lets a second tenant reuse a number another tenant already holds', async () => {
    // The whole point of P4/M11. Before it, this tenant's PUR-000001 collided
    // with tenant-1's under an install-wide @unique, and the helper silently
    // skipped the newcomer forward to PUR-000043. Now (tenantId, purchaseId)
    // is the constraint, so a fresh tenant simply starts at 1 — and there is
    // no second query that could see the other tenant's row at all.
    const findFirst = vi.fn().mockResolvedValueOnce(null);
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'purchaseId',
      prefix: 'PUR-',
      tenantWhere: { tenantId: 'tenant-2' },
    });

    expect(result).toBe('PUR-000001');
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-2' }) }),
    );
  });

  it('respects a custom width and prefix', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ creditNoteNumber: 'CN-7' });
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'creditNoteNumber',
      prefix: 'CN-',
      width: 3,
      tenantWhere: { tenantId: 'tenant-1' },
    });

    expect(result).toBe('CN-008');
  });
});

describe('isNumberFieldConflict', () => {
  it('matches a P2002 whose meta.target names the field', () => {
    expect(isNumberFieldConflict(p2002('debitNoteId'), 'debitNoteId')).toBe(true);
  });

  it('matches case-insensitively and against a string target', () => {
    const err = { code: 'P2002', meta: { target: 'DebitNote_tenantId_debitNoteId_key' } };
    expect(isNumberFieldConflict(err, 'debitNoteId')).toBe(true);
  });

  it('matches the COMPOSITE target Prisma reports after P4', () => {
    // M11 turned every document-number @unique into @@unique([tenantId, X]),
    // so meta.target is now a two-element array. The substring scan has to
    // still find the field in it, or withDocumentNumberRetry would stop
    // recognising the collisions it exists to retry.
    const err = { code: 'P2002', meta: { target: ['tenantId', 'invoiceNumber'] } };
    expect(isNumberFieldConflict(err, 'invoiceNumber')).toBe(true);
  });

  it('still rejects a composite P2002 on an unrelated field', () => {
    const err = { code: 'P2002', meta: { target: ['tenantId', 'code'] } };
    expect(isNumberFieldConflict(err, 'invoiceNumber')).toBe(false);
  });

  it('does not match a P2002 on a different field', () => {
    expect(isNumberFieldConflict(p2002('email'), 'debitNoteId')).toBe(false);
  });

  it('does not match a non-P2002 error', () => {
    expect(isNumberFieldConflict(new Error('boom'), 'debitNoteId')).toBe(false);
  });

  it('does not match null/undefined/non-object values', () => {
    expect(isNumberFieldConflict(null, 'debitNoteId')).toBe(false);
    expect(isNumberFieldConflict(undefined, 'debitNoteId')).toBe(false);
    expect(isNumberFieldConflict('nope', 'debitNoteId')).toBe(false);
  });

  it('conservatively matches a P2002 whose target it cannot inspect', () => {
    expect(isNumberFieldConflict({ code: 'P2002' }, 'debitNoteId')).toBe(true);
  });
});

describe('withDocumentNumberRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const attempt = vi.fn().mockResolvedValue('DN-000001');
    const result = await withDocumentNumberRetry('debitNoteId', attempt);
    expect(result).toBe('DN-000001');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries the whole attempt on a matching P2002 and returns the eventual success', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(p2002('debitNoteId'))
      .mockResolvedValueOnce('DN-000002');

    const result = await withDocumentNumberRetry('debitNoteId', attempt);

    expect(result).toBe('DN-000002');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('gives up after MAX_NUMBER_RETRIES attempts and rethrows the last error', async () => {
    const err = p2002('debitNoteId');
    const attempt = vi.fn().mockRejectedValue(err);

    await expect(withDocumentNumberRetry('debitNoteId', attempt)).rejects.toBe(err);
    expect(attempt).toHaveBeenCalledTimes(MAX_NUMBER_RETRIES);
  });

  it('does not retry — and rethrows immediately — on an unrelated error', async () => {
    const err = new Error('Purchase Order not found');
    const attempt = vi.fn().mockRejectedValue(err);

    await expect(withDocumentNumberRetry('purchaseId', attempt)).rejects.toBe(err);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry — and rethrows immediately — on a P2002 for a different field', async () => {
    const err = p2002('email');
    const attempt = vi.fn().mockRejectedValue(err);

    await expect(withDocumentNumberRetry('debitNoteId', attempt)).rejects.toBe(err);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe('handleNumberConflict', () => {
  function fakeRes() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  }

  it('sends a 409 and returns true for a matching P2002', () => {
    const res = fakeRes();
    const handled = handleNumberConflict(res as never, p2002('paymentId'), 'paymentId');

    expect(handled).toBe(true);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining('unique document number') }),
    );
  });

  it('returns false and sends nothing for an unrelated error', () => {
    const res = fakeRes();
    const handled = handleNumberConflict(res as never, new Error('boom'), 'paymentId');

    expect(handled).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
