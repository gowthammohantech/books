/**
 * tests/quotationReminderCron.test.ts
 *
 * Covers the Prisma rewrite of quotationReminderCron. The job it replaced was
 * inert (Mongoose + an early return whenever MONGO_URI was unset), so these are
 * the first tests this schedule has ever had. The three properties that matter:
 *
 *  1. It claims ONLY `automatic_quotation` rules. The invoice cron claims
 *     'automatic' / 'automatic_Purchase'; any overlap would mail every matching
 *     document twice a day, and sweeping in `manual_quotation` would start
 *     auto-sending one-off reminders nobody scheduled.
 *  2. The once-per-day guard holds, so a second tick on the same day is silent.
 *  3. `lastSent` is bumped ONLY after a genuinely accepted send — a failed send
 *     must stay due for the next tick rather than being silently swallowed.
 *
 * node-cron is mocked so importing the module registers no real interval, and
 * so the registration itself can be inspected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReminderFindMany,
  mockReminderUpdate,
  mockQuotationFindMany,
  mockCronSchedule,
  mockSendQuotationReminderEmail,
} = vi.hoisted(() => ({
  mockReminderFindMany: vi.fn(),
  mockReminderUpdate: vi.fn(),
  mockQuotationFindMany: vi.fn(),
  mockCronSchedule: vi.fn(),
  mockSendQuotationReminderEmail: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: mockCronSchedule },
  schedule: mockCronSchedule,
}));

vi.mock('../lib/prisma', () => {
  const client = {
    reminder: { findMany: mockReminderFindMany, update: mockReminderUpdate },
    quotation: { findMany: mockQuotationFindMany },
  };
  return { prisma: client, prismaUnscoped: client };
});

vi.mock('../lib/tenantContext', () => ({
  runAsTenant: (_tenantId: string, fn: () => unknown) => fn(),
}));

vi.mock('../lib/reminderMailer', () => ({
  sendQuotationReminderEmail: mockSendQuotationReminderEmail,
}));

import { runQuotationReminderCron } from '../quotationReminderCron';

// Registration happens once at module load, before any beforeEach; capture it
// now or `clearMocks` wipes it. Same reasoning as reminderCron.scope.test.ts.
const scheduleCallAtLoad = mockCronSchedule.mock.calls[0] as unknown[] | undefined;

const TODAY = new Date();

/** A quotation whose expiry is `days` in the future. */
function quotationExpiringIn(days: number, id = 'quo-1') {
  const expiryDate = new Date(TODAY);
  expiryDate.setDate(expiryDate.getDate() + days);
  return { id, quotationDate: new Date(TODAY), expiryDate };
}

function reminder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rem-1',
    name: 'Expiry chaser',
    tenantId: 'tenant-a',
    type: 'automatic_quotation',
    remindDays: 3,
    remindTiming: 'before',
    remindEvent: 'expiry_date',
    isEnabled: true,
    status: 'active',
    lastSent: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReminderFindMany.mockResolvedValue([]);
  mockQuotationFindMany.mockResolvedValue([]);
  mockSendQuotationReminderEmail.mockResolvedValue({ sent: true });
});

describe('runQuotationReminderCron — reminder selection', () => {
  it('claims only automatic_quotation rules, never the invoice cron\'s types', async () => {
    await runQuotationReminderCron();

    expect(mockReminderFindMany).toHaveBeenCalledTimes(1);
    const { where } = mockReminderFindMany.mock.calls[0][0];
    expect(where.type).toEqual({ in: ['automatic_quotation'] });
    // A rule the invoice cron already owns must not be picked up here.
    expect(where.type.in).not.toContain('automatic');
    expect(where.type.in).not.toContain('automatic_Purchase');
    // Manual reminders are sent on demand, never on a schedule.
    expect(where.type.in).not.toContain('manual_quotation');
    expect(where).toMatchObject({ isEnabled: true, status: 'active' });
  });

  it('scopes to one workspace when triggered with a scope, and to all when scheduled', async () => {
    await runQuotationReminderCron('tenant-a');
    expect(mockReminderFindMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant-a' });

    vi.clearAllMocks();
    mockReminderFindMany.mockResolvedValue([]);

    await runQuotationReminderCron();
    expect(mockReminderFindMany.mock.calls[0][0].where).not.toHaveProperty('tenantId');
  });

  it('considers only open, unconverted quotations', async () => {
    mockReminderFindMany.mockResolvedValue([reminder()]);

    await runQuotationReminderCron();

    const { where } = mockQuotationFindMany.mock.calls[0][0];
    expect(where).toMatchObject({
      tenantId: 'tenant-a',
      isDeleted: false,
      // Chasing a quotation already converted to an invoice is wrong.
      convert_type: 'quotation',
    });
    expect(where.status).toEqual({ in: ['draft', 'sent', 'accepted', 'declined'] });
  });
});

describe('runQuotationReminderCron — matching and sending', () => {
  it('sends for a quotation whose expiry is exactly remindDays away', async () => {
    mockReminderFindMany.mockResolvedValue([reminder({ remindDays: 3, remindTiming: 'before' })]);
    mockQuotationFindMany.mockResolvedValue([quotationExpiringIn(3)]);

    const summary = await runQuotationReminderCron();

    expect(summary).toMatchObject({ matched: 1, sent: 1, failed: 0 });
    expect(mockSendQuotationReminderEmail).toHaveBeenCalledWith({
      reminderId: 'rem-1',
      quotationId: 'quo-1',
    });
  });

  it('ignores a quotation whose expiry is not the target date', async () => {
    mockReminderFindMany.mockResolvedValue([reminder({ remindDays: 3, remindTiming: 'before' })]);
    mockQuotationFindMany.mockResolvedValue([quotationExpiringIn(9)]);

    const summary = await runQuotationReminderCron();

    expect(summary.matched).toBe(0);
    expect(mockSendQuotationReminderEmail).not.toHaveBeenCalled();
  });

  it('ignores an invoice-shaped remindEvent — a quotation has no due date', async () => {
    mockReminderFindMany.mockResolvedValue([reminder({ remindEvent: 'due_date' })]);
    mockQuotationFindMany.mockResolvedValue([quotationExpiringIn(3)]);

    const summary = await runQuotationReminderCron();

    expect(summary.matched).toBe(0);
    expect(mockSendQuotationReminderEmail).not.toHaveBeenCalled();
  });

  it('skips a rule already fired today', async () => {
    mockReminderFindMany.mockResolvedValue([reminder({ lastSent: new Date() })]);
    mockQuotationFindMany.mockResolvedValue([quotationExpiringIn(3)]);

    const summary = await runQuotationReminderCron();

    expect(summary.sent).toBe(0);
    expect(mockQuotationFindMany).not.toHaveBeenCalled();
    expect(mockSendQuotationReminderEmail).not.toHaveBeenCalled();
  });

  it('bumps lastSent after a successful send', async () => {
    mockReminderFindMany.mockResolvedValue([reminder()]);
    mockQuotationFindMany.mockResolvedValue([quotationExpiringIn(3)]);

    await runQuotationReminderCron();

    expect(mockReminderUpdate).toHaveBeenCalledTimes(1);
    expect(mockReminderUpdate.mock.calls[0][0]).toMatchObject({ where: { id: 'rem-1' } });
  });

  it('does NOT bump lastSent when the send fails, so the reminder stays due', async () => {
    mockReminderFindMany.mockResolvedValue([reminder()]);
    mockQuotationFindMany.mockResolvedValue([quotationExpiringIn(3)]);
    mockSendQuotationReminderEmail.mockResolvedValue({ sent: false, error: 'SMTP down' });

    const summary = await runQuotationReminderCron();

    expect(summary).toMatchObject({ matched: 1, sent: 0, failed: 1 });
    expect(mockReminderUpdate).not.toHaveBeenCalled();
  });
});

describe('runQuotationReminderCron — scheduling', () => {
  it('registers at 09:30, offset from the invoice cron\'s 09:00', () => {
    expect(scheduleCallAtLoad).toBeDefined();
    expect((scheduleCallAtLoad as unknown[])[0]).toBe('30 9 * * *');
  });

  it('wraps the callback so node-cron cannot forward its TaskContext as a tenant scope', async () => {
    const [, scheduledFn] = scheduleCallAtLoad as [string, (...args: unknown[]) => unknown];
    expect(scheduledFn).not.toBe(runQuotationReminderCron);

    await scheduledFn({ date: new Date(), triggeredAt: new Date() });

    const { where } = mockReminderFindMany.mock.calls[0][0];
    expect(where).not.toHaveProperty('tenantId');
  });
});
