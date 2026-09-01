import { describe, expect, it } from 'vitest';

import {
  OUTSTANDING_TOLERANCE,
  deriveInvoiceDisplayStatus,
  deriveInvoiceStatus,
  isInvoiceEditable,
  netInvoiceOutstanding,
} from './invoiceStatus.js';

describe('netInvoiceOutstanding', () => {
  it('nets both payments and credit notes', () => {
    expect(netInvoiceOutstanding(100, 30, 20).toNumber()).toBe(50);
  });

  it('goes negative on over-credit rather than clamping', () => {
    expect(netInvoiceOutstanding(100, 0, 150).toNumber()).toBe(-50);
  });
});

describe('deriveInvoiceStatus', () => {
  it('PAID when cash settles it', () => {
    expect(deriveInvoiceStatus(100, 100, 0).status).toBe('PAID');
  });

  it('PAID when CREDIT NOTES settle it, with no cash at all', () => {
    // The case the frontend could not see: it had no creditNoted term.
    expect(deriveInvoiceStatus(100, 0, 100).status).toBe('PAID');
  });

  it('PAID when cash and credit notes settle it between them', () => {
    expect(deriveInvoiceStatus(100, 40, 60).status).toBe('PAID');
  });

  it('PAID when over-credited (outstanding negative)', () => {
    expect(deriveInvoiceStatus(100, 0, 150).status).toBe('PAID');
  });

  it('treats a balance within half a cent as settled', () => {
    expect(deriveInvoiceStatus(100, 99.996, 0).status).toBe('PAID');
    expect(OUTSTANDING_TOLERANCE.toNumber()).toBe(0.005);
  });

  it('PARTIALLY_PAID when a credit note settles some of it', () => {
    expect(deriveInvoiceStatus(100, 0, 40).status).toBe('PARTIALLY_PAID');
  });

  it('preserves a non-settled prior status when nothing is settled', () => {
    expect(deriveInvoiceStatus(100, 0, 0, 'OVERDUE').status).toBe('OVERDUE');
    expect(deriveInvoiceStatus(100, 0, 0, 'SENT').status).toBe('SENT');
  });

  it('corrects a stale PAID/PARTIALLY_PAID when nothing is actually settled', () => {
    expect(deriveInvoiceStatus(100, 0, 0, 'PAID').status).toBe('UNPAID');
    expect(deriveInvoiceStatus(100, 0, 0, 'PARTIALLY_PAID').status).toBe('UNPAID');
  });

  it('defaults to UNPAID with no prior status', () => {
    expect(deriveInvoiceStatus(100, 0, 0).status).toBe('UNPAID');
  });
});

describe('deriveInvoiceDisplayStatus', () => {
  const PAST = '2020-01-01';
  const now = new Date('2026-01-01T12:00:00Z');

  it('CANCELLED and DRAFT short-circuit', () => {
    expect(deriveInvoiceDisplayStatus({ status: 'CANCELLED' })).toBe('CANCELLED');
    expect(deriveInvoiceDisplayStatus({ status: 'DRAFT' })).toBe('DRAFT');
  });

  it('a credit-noted PAST-DUE invoice reads PAID, not "Delayed Payment"', () => {
    // The bug this fixes. The old frontend derivation had no creditNoted term,
    // so balance was totalAmount - totalPaid = 100, it saw a past due date, and
    // rendered DELAYED — while the aging report treated the invoice as settled.
    expect(
      deriveInvoiceDisplayStatus({
        status: 'SENT',
        dueDate: PAST,
        totalAmount: 100,
        totalPaid: 0,
        creditNoted: 100,
        now,
      }),
    ).toBe('PAID');
  });

  it('still reads DELAYED when past due and genuinely unsettled', () => {
    expect(
      deriveInvoiceDisplayStatus({
        status: 'SENT',
        dueDate: PAST,
        totalAmount: 100,
        totalPaid: 0,
        creditNoted: 0,
        now,
      }),
    ).toBe('DELAYED');
  });

  it('a PARTIALLY credit-noted past-due invoice is still DELAYED on the remainder', () => {
    expect(
      deriveInvoiceDisplayStatus({
        status: 'SENT',
        dueDate: PAST,
        totalAmount: 100,
        totalPaid: 0,
        creditNoted: 40,
        now,
      }),
    ).toBe('DELAYED');
  });

  it('PARTIALLY_PAID when something is settled and it is not yet due', () => {
    expect(
      deriveInvoiceDisplayStatus({
        status: 'SENT',
        dueDate: '2030-01-01',
        totalAmount: 100,
        totalPaid: 40,
        now,
      }),
    ).toBe('PARTIALLY_PAID');
  });

  it('legacy UNPAID with no balance settled reads SENT', () => {
    expect(
      deriveInvoiceDisplayStatus({
        status: 'UNPAID',
        dueDate: '2030-01-01',
        totalAmount: 100,
        totalPaid: 0,
        now,
      }),
    ).toBe('SENT');
  });

  it('a stored PAID wins regardless of the numbers', () => {
    expect(deriveInvoiceDisplayStatus({ status: 'PAID', totalAmount: 100, totalPaid: 0 })).toBe(
      'PAID',
    );
  });

  it('omitting creditNoted preserves the old behaviour for callers that lack it', () => {
    // Not a silent default we are happy with — it is why the API now exposes the
    // field — but it must not crash or change meaning for callers mid-migration.
    expect(
      deriveInvoiceDisplayStatus({
        status: 'SENT',
        dueDate: PAST,
        totalAmount: 100,
        totalPaid: 0,
        now,
      }),
    ).toBe('DELAYED');
  });

  it('ignores an unparseable due date instead of throwing', () => {
    expect(
      deriveInvoiceDisplayStatus({
        status: 'SENT',
        dueDate: 'not-a-date',
        totalAmount: 100,
        totalPaid: 0,
        now,
      }),
    ).toBe('SENT');
  });
});

describe('isInvoiceEditable', () => {
  it('only drafts', () => {
    expect(isInvoiceEditable('DRAFT')).toBe(true);
    expect(isInvoiceEditable('draft')).toBe(true);
    expect(isInvoiceEditable('SENT')).toBe(false);
    expect(isInvoiceEditable(null)).toBe(false);
  });
});
