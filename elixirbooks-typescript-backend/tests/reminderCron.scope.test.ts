/**
 * tests/reminderCron.scope.test.ts
 *
 * Wave-1 final review (Important finding): POST /api/reminders/trigger-cron
 * was gated by `protect` only and called runReminderCron() with no
 * tenant/user filter — any authenticated user could trigger a GLOBAL
 * reminder run (real emails to customers, publicViewEnabled flipped on
 * invoices, lastSent bumps that suppress the day's scheduled 9am run).
 *
 * Fix: runReminderCron(scopeTenantId?) filters the reminder query when a scope
 * is passed. The HTTP-triggered path (reminderController.triggerReminderCron)
 * passes the caller's WORKSPACE; the scheduled 9am tick must keep calling this
 * with NO argument so the daily run covers every workspace.
 *
 * P7 changed the filter column from `createdBy` to `tenantId`. `createdBy` is
 * an ACTOR column, so a scoped run only fired the reminders the triggering
 * admin had personally created and silently skipped their colleagues' — and on
 * a multi-tenant install it would have matched nothing at all. The due-reminder
 * SELECT also moved to prismaUnscoped, because "everything due tonight" spans
 * the whole install and belongs to no single workspace; each reminder is then
 * processed inside runAsTenant.
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

vi.mock('../lib/prisma', () => {
  const client = {
    reminder: { findMany: mockReminderFindMany, update: mockReminderUpdate },
    invoice: { findMany: mockInvoiceFindMany },
  };
  return { prisma: client, prismaUnscoped: client };
});

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
  it('with a scope, filters reminders by TENANT — not by who created them', async () => {
    await runReminderCron('tenant-a');

    expect(mockReminderFindMany).toHaveBeenCalledTimes(1);
    const { where } = mockReminderFindMany.mock.calls[0][0];
    expect(where).toMatchObject({ tenantId: 'tenant-a' });
    expect(where).not.toHaveProperty('createdBy');
  });

  it('with NO scope (the scheduled 9am path), covers every workspace', async () => {
    await runReminderCron();

    expect(mockReminderFindMany).toHaveBeenCalledTimes(1);
    const { where } = mockReminderFindMany.mock.calls[0][0];
    expect(where).not.toHaveProperty('tenantId');
  });

  it('a scoped run picks up a COLLEAGUE\'s reminder in the same workspace', async () => {
    // The behaviour the createdBy filter got wrong: two reminders in one
    // company, created by two different people. A scoped run must fire both.
    mockReminderFindMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const all = [
        { id: 'rem-a', tenantId: 'tenant-a', createdBy: 'user-a' },
        { id: 'rem-b', tenantId: 'tenant-a', createdBy: 'user-b' },
        { id: 'rem-c', tenantId: 'tenant-b', createdBy: 'user-c' },
      ];
      if (where.tenantId) return all.filter((r) => r.tenantId === where.tenantId);
      return all;
    });

    const scoped = await runReminderCron('tenant-a');
    expect(scoped.reminders).toBe(2);

    const everyWorkspace = await runReminderCron();
    expect(everyWorkspace.reminders).toBe(3);
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
    expect(where).not.toHaveProperty('tenantId');
  });
});
