/**
 * tests/reminderMailer.test.ts
 *
 * Wave-1 Task 3: reminders must actually send an email, not just flip a
 * status flag. `lib/reminderMailer.ts` is the shared "pure send" helper used
 * by both the manual "send reminder" endpoint and the automatic cron.
 *
 * Mocking note: unlike `controllers/Admin/Invoice/invoiceController.ts` (which
 * pulls in `utils/mailer` via a top-level CJS `require()` that `vi.mock`
 * cannot intercept — see tests/sendInvoiceEmail.guards.test.ts), this new lib
 * uses an ESM `import { sendMail } from '../utils/mailer'`. Vitest's
 * import-graph mocking DOES intercept static ESM imports, so a plain
 * `vi.mock('../utils/mailer', ...)` works here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReminderFindUnique, mockInvoiceFindUnique, mockInvoiceUpdate, mockSendMail } = vi.hoisted(() => ({
  mockReminderFindUnique: vi.fn(),
  mockInvoiceFindUnique: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockSendMail: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    reminder: { findUnique: mockReminderFindUnique },
    invoice: { findUnique: mockInvoiceFindUnique, update: mockInvoiceUpdate },
  },
}));

vi.mock('../utils/mailer', () => ({ sendMail: mockSendMail }));

import { sendReminderEmail } from '../lib/reminderMailer';

const BASE_INVOICE = {
  id: 'inv-1',
  invoiceNumber: 'INV-000123',
  invoiceDate: new Date('2026-06-01'),
  dueDate: new Date('2026-06-15'),
  TotalAmount: 500,
  publicViewToken: 'existing-token-abc',
  publicViewEnabled: true,
  customer: null,
  contact: { id: 'c1', firstName: 'Jane', lastName: 'Doe', organisation: null, email: 'jane@example.com' },
  billToContact: null,
  billToCustomer: null,
  payments: [],
};

const BASE_REMINDER = {
  id: 'rem-1',
  type: 'manual',
  targetInvoice: 'inv-1',
  targetInvoiceRel: BASE_INVOICE,
  targetCustomerRel: null,
  targetContactRel: null,
  company: { publicBaseUrl: null },
  emailConfig: {
    subject: 'Payment reminder for %InvoiceNumber%',
    body: '<p>Dear %CustomerName%, please pay %Total%. View: %InvoiceUrl%</p>',
    fromEmail: undefined,
    cc: [],
    bcc: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendReminderEmail — happy path', () => {
  it('calls the transport once with the customer email and does not touch the reminder/invoice status itself', async () => {
    mockReminderFindUnique.mockResolvedValue(BASE_REMINDER);
    mockSendMail.mockResolvedValue(undefined);

    const result = await sendReminderEmail({ reminderId: 'rem-1' });

    expect(result).toEqual({ sent: true });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const opts = mockSendMail.mock.calls[0][0];
    expect(opts.to).toBe('jane@example.com');
    expect(opts.subject).toContain('INV-000123');
    expect(opts.html).toContain('Jane Doe');
    // Placeholder substitution must resolve to a PUBLIC invoice link, never /admin/...
    expect(opts.html).toMatch(/\/invoice\/existing-token-abc/);
    expect(opts.html).not.toMatch(/\/admin\//);

    // Pure send helper: it must not mark anything sent itself.
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });
});

describe('sendReminderEmail — missing SMTP configuration', () => {
  it('returns { sent: false, error } without throwing', async () => {
    mockReminderFindUnique.mockResolvedValue(BASE_REMINDER);
    const err = new Error('Email is not configured. Set up an email provider in Settings → Email.');
    (err as NodeJS.ErrnoException).code = 'EMAIL_NOT_CONFIGURED';
    mockSendMail.mockRejectedValue(err);

    const result = await sendReminderEmail({ reminderId: 'rem-1' });

    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });
});

describe('sendReminderEmail — no recipient email on file', () => {
  it('returns { sent: false, error } without calling the transport', async () => {
    mockReminderFindUnique.mockResolvedValue({
      ...BASE_REMINDER,
      targetInvoiceRel: { ...BASE_INVOICE, contact: null, customer: null, billToContact: null, billToCustomer: null },
    });

    const result = await sendReminderEmail({ reminderId: 'rem-1' });

    expect(result.sent).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('sendReminderEmail — automatic cron path (invoiceId override)', () => {
  it('sends against the passed invoiceId, generating a public token when the invoice has none', async () => {
    mockReminderFindUnique.mockResolvedValue({
      ...BASE_REMINDER,
      type: 'automatic',
      targetInvoice: null,
      targetInvoiceRel: null,
    });
    mockInvoiceFindUnique.mockResolvedValue({
      ...BASE_INVOICE,
      id: 'inv-2',
      invoiceNumber: 'INV-000999',
      publicViewToken: null,
      publicViewEnabled: false,
    });
    mockInvoiceUpdate.mockResolvedValue({});
    mockSendMail.mockResolvedValue(undefined);

    const result = await sendReminderEmail({ reminderId: 'rem-1', invoiceId: 'inv-2' });

    expect(result).toEqual({ sent: true });
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-2' },
        data: expect.objectContaining({ publicViewEnabled: true }),
      }),
    );
    const opts = mockSendMail.mock.calls[0][0];
    expect(opts.subject).toContain('INV-000999');
  });
});
