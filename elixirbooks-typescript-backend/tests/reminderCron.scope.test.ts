/**
 * tests/reminderCron.scope.test.ts
 *
 * Wave-1 final review (Important finding): POST /api/reminders/trigger-cron
 * was gated by `protect` only and called runReminderCron() with no
 * tenant/user filter — any authenticated user could trigger a GLOBAL
 * reminder run (real emails to customers, publicViewEnabled flipped on
 * invoices, lastSent bumps that suppress the day's scheduled 9am run).
 *
 * Fix: runReminderCron(scopeUserId?) adds a `createdBy` filter to the
 * reminder query when a scope is passed. The HTTP-triggered path
 * (reminderController.triggerReminderCron) now passes the caller's id
 * (mirroring the `reminder.createdBy !== requireUserId(req)` ownership
 * check used by sendManualReminder). The scheduled 9am tick must keep
 * calling this with NO argument so the daily run stays global.
 *
 * node-cron is mocked so importing invoiceReminderCron.ts here doesn't
 * register a real interval, and so we can capture exactly what the
 * scheduler registration passes as its callback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReminderFindMany, mockInvoiceFindMany, mockReminderUpdate, mockCronSchedule } = vi.hoisted(() => ({
  mockReminderFindMany: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockReminderUpdate: vi.fn(),
  mockCronSchedule: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: mockCronSchedule },
  schedule: mockCronSchedule,
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    reminder: { findMany: mockReminderFindMany, update: mockReminderUpdate },
    invoice: { findMany: mockInvoiceFindMany },
  },
}));

vi.mock('../lib/reminderMailer', () => ({ sendReminderEmail: vi.fn() }));

import { runReminderCron } from '../invoiceReminderCron';

// The node-cron registration (`cron.schedule(...)`) happens exactly once, at
// module-load time, synchronously as part of the `import` above — before any
// test's beforeEach runs. vitest.config.ts sets `clearMocks: true`, which
// wipes recorded mock calls before every test (including the first), so the
// registration call must be captured right here or it's lost before any
// `it()` body can inspect it.
const scheduleCallAtLoad = mockCronSchedule.mock.calls[0] as unknown[] | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mockReminderFindMany.mockResolvedValue([]);
  mockInvoiceFindMany.mockResolvedValue([]);
});

describe('runReminderCron — tenant scoping (Wave-1 final review fix)', () => {
  it('with a scopeUserId, queries reminders WITH a createdBy filter', async () => {
    await runReminderCron('user-a');

    expect(mockReminderFindMany).toHaveBeenCalledTimes(1);
    const { where } = mockReminderFindMany.mock.calls[0][0];
    expect(where).toMatchObject({ createdBy: 'user-a' });
  });

  it('with NO scopeUserId (the scheduled 9am path), queries reminders WITHOUT a createdBy filter', async () => {
    await runReminderCron();

    expect(mockReminderFindMany).toHaveBeenCalledTimes(1);
    const { where } = mockReminderFindMany.mock.calls[0][0];
    expect(where).not.toHaveProperty('createdBy');
  });

  it('two reminders from different createdBy owners: scoped run only matches one of them', async () => {
    mockReminderFindMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const all = [
        { id: 'rem-a', createdBy: 'user-a' },
        { id: 'rem-b', createdBy: 'user-b' },
      ];
      if (where.createdBy) return all.filter((r) => r.createdBy === where.createdBy);
      return all;
    });

    const scoped = await runReminderCron('user-a');
    expect(scoped.reminders).toBe(1);

    const global = await runReminderCron();
    expect(global.reminders).toBe(2);
  });

  it('the scheduled registration wraps runReminderCron so node-cron cannot forward its TaskContext as a scope', async () => {
    expect(scheduleCallAtLoad).toBeDefined();
    const [, scheduledFn] = scheduleCallAtLoad as [string, (...args: unknown[]) => unknown];

    // The registered callback must NOT be a direct reference to
    // runReminderCron — node-cron invokes its callback with a truthy
    // TaskContext object (`{ date, dateLocalIso, triggeredAt }`), which
    // would otherwise be mistaken for a scopeUserId and wrongly scope the
    // daily global run.
    expect(scheduledFn).not.toBe(runReminderCron);

    await scheduledFn({ date: new Date(), dateLocalIso: '2026-07-10T09:00:00', triggeredAt: new Date() });
    const { where } = mockReminderFindMany.mock.calls[0][0];
    expect(where).not.toHaveProperty('createdBy');
  });
});
