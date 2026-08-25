import { describe, it, expect, vi } from 'vitest';
import { validationResult } from 'express-validator';

// The purchaseId/contactId validators run DB .custom() checks — mock prisma so
// they resolve, isolating the referenceNumber/notes optional behavior under test.
vi.mock('../lib/prisma', () => ({
  prisma: {
    purchase: { findFirst: vi.fn().mockResolvedValue({ id: 'purchase-1' }) },
    contact: { findFirst: vi.fn().mockResolvedValue({ id: 'contact-1' }) },
  },
}));

const { supplierPaymentValidator } = await import('../validators/Admin/Purchases/supplierPaymentValidator');

// Regression: the "Record Payment" modal posts JSON with referenceNumber/notes
// = null when left blank. .optional() skips only undefined, so a plain
// .optional().isString() used to reject null and 422 the whole save. The
// validator now uses .optional({ checkFalsy: true }) so null/'' are treated as
// absent. These tests lock that in.
async function runValidator(body: Record<string, unknown>) {
  const req = { body } as never;
  for (const chain of supplierPaymentValidator) {
    // eslint-disable-next-line no-await-in-loop
    await chain.run(req);
  }
  return validationResult(req as never);
}

const base = {
  purchaseId: 'purchase-1',
  paymentDate: '2026-07-05',
  amount: 50,
  paidAmount: 50,
  dueAmount: 0,
  sourceType: 'BANK',
  bankId: 'bank-1',
  paymentMode: 'mode-1',
};

describe('supplierPaymentValidator optional string fields', () => {
  it('passes when referenceNumber and notes are null (blank in the modal)', async () => {
    const errors = await runValidator({ ...base, referenceNumber: null, notes: null });
    expect(errors.isEmpty()).toBe(true);
  });

  it('passes when referenceNumber and notes are empty strings', async () => {
    const errors = await runValidator({ ...base, referenceNumber: '', notes: '' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('passes when a real reference is provided', async () => {
    const errors = await runValidator({ ...base, referenceNumber: 'CHQ-00123', notes: 'partial' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('still fails when a required field (purchaseId) is missing', async () => {
    const { purchaseId, ...noPurchase } = base;
    void purchaseId;
    const errors = await runValidator({ ...noPurchase, referenceNumber: null });
    expect(errors.isEmpty()).toBe(false);
  });
});
