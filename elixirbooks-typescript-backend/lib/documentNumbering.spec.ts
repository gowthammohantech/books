// lib/documentNumbering.spec.ts
//
// Task 3 review fix round 1: the tenant-scoped candidate → global clash check
// → global max+1 fallback used to be duplicated byte-for-byte in 5 places
// (creditNote/debitNote/purchase/supplierPayment controllers +
// lib/ledger/applyBillPayment.ts). This is the primary coverage for the now-
// shared lib/documentNumbering.ts: nextDocumentNumber() itself (candidate
// free / candidate clashes / fallback also clashes), isNumberFieldConflict(),
// withDocumentNumberRetry() (success, retry-then-succeed, retries exhausted),
// and handleNumberConflict().
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
  it('returns the tenant-scoped candidate when it is free install-wide', async () => {
    const findFirst = vi.fn();
    findFirst
      .mockResolvedValueOnce({ debitNoteId: 'DN-000004' }) // tenant-scoped last
      .mockResolvedValueOnce(null); // clash check → free
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'debitNoteId',
      prefix: 'DN-',
      tenantWhere: { userId: 'tenant-1' },
    });

    expect(result).toBe('DN-000005');
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { debitNoteId: { not: null }, userId: 'tenant-1' },
      orderBy: { createdAt: 'desc' },
      select: { debitNoteId: true },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: { debitNoteId: 'DN-000005' },
      select: { id: true },
    });
  });

  it('starts a fresh tenant at 000001 when it has no prior rows', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'paymentId',
      prefix: 'PAY-',
      tenantWhere: { purchase: { userId: 'tenant-1' } },
    });

    expect(result).toBe('PAY-000001');
  });

  it('falls back to the install-wide highest + 1 when the tenant candidate clashes', async () => {
    const findFirst = vi.fn();
    findFirst
      .mockResolvedValueOnce(null) // fresh tenant → candidate 000001
      .mockResolvedValueOnce({ id: 'other-tenant-row' }) // clash: another tenant holds it
      .mockResolvedValueOnce({ purchaseId: 'PUR-000042' }); // install-wide highest
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'purchaseId',
      prefix: 'PUR-',
      tenantWhere: { userId: 'tenant-1' },
    });

    expect(result).toBe('PUR-000043');
    expect(findFirst).toHaveBeenNthCalledWith(3, {
      where: { purchaseId: { not: null } },
      orderBy: { purchaseId: 'desc' },
      select: { purchaseId: true },
    });
  });

  it('respects a custom width and prefix', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ creditNoteNumber: 'CN-7' }).mockResolvedValueOnce(null);
    const model: NumberingModel = { findFirst };

    const result = await nextDocumentNumber({
      model,
      field: 'creditNoteNumber',
      prefix: 'CN-',
      width: 3,
      tenantWhere: { userId: 'tenant-1' },
    });

    expect(result).toBe('CN-008');
  });
});

describe('isNumberFieldConflict', () => {
  it('matches a P2002 whose meta.target names the field', () => {
    expect(isNumberFieldConflict(p2002('debitNoteId'), 'debitNoteId')).toBe(true);
  });

  it('matches case-insensitively and against a string target', () => {
    const err = { code: 'P2002', meta: { target: 'DebitNote_debitNoteId_key' } };
    expect(isNumberFieldConflict(err, 'debitNoteId')).toBe(true);
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
