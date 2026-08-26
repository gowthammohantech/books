import { describe, it, expect } from 'vitest';
import { explainedBankFields } from './explainedBankFields';

describe('explainedBankFields', () => {
  it('always returns explainStatus EXPLAINED', () => {
    const out = explainedBankFields({ posted: true });
    expect(out.explainStatus).toBe('EXPLAINED');
    expect(out.isPaymentBorn).toBe(true);
  });

  it('mirrors isReconciled from posted=true', () => {
    const out = explainedBankFields({ posted: true });
    expect(out.isReconciled).toBe(true);
  });

  it('mirrors isReconciled from posted=false', () => {
    const out = explainedBankFields({ posted: false });
    expect(out.isReconciled).toBe(false);
  });

  it('passes the posted-source pointer through', () => {
    const out = explainedBankFields({
      posted: true,
      postedSourceType: 'INVOICE_PAYMENT',
      postedSourceId: 'pmt-123',
    });
    expect(out.postedSourceType).toBe('INVOICE_PAYMENT');
    expect(out.postedSourceId).toBe('pmt-123');
  });

  it('passes the approver through', () => {
    const when = new Date('2026-06-25T10:00:00.000Z');
    const out = explainedBankFields({
      posted: true,
      approvedById: 'user-9',
      approvedAt: when,
    });
    expect(out.approvedById).toBe('user-9');
    expect(out.approvedAt).toBe(when);
  });

  it('defaults missing pointers/approver to null', () => {
    const out = explainedBankFields({ posted: true });
    expect(out.postedSourceType).toBeNull();
    expect(out.postedSourceId).toBeNull();
    expect(out.approvedById).toBeNull();
    expect(out.approvedAt).toBeNull();
  });
});
