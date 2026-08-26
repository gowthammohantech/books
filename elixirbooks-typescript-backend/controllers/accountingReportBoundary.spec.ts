// controllers/accountingReportBoundary.spec.ts
//
// Regression for P2 bug 3: month-end boundary truncation. `new Date(y, m, 0)`
// resolves to MIDNIGHT at the start of the last day, so a payment recorded later
// that day (e.g. 23:00) falls out of the month total. The boundary must be an
// inclusive end-of-day instant, matching transactionReportController.
//
// Regression for P2 review finding 2: the boundary must also be UTC-safe. Building
// it from local getFullYear()/getMonth()/setHours() shifts the cutoff by the
// server's UTC offset on non-UTC hosts (see lib/reports/asOf.ts header) — the same
// wall-clock payment can land inside or outside the month depending on where the
// process runs. The tests below assert the boundary via UTC getters/epoch math so
// they hold regardless of host timezone.
//
// IMPORTANT: this test is only a meaningful regression guard if the local/UTC
// offset in play is actually nonzero. Freezing "now" at a date where the host's
// zone happens to be at UTC+0 (e.g. Europe/London in March, before the last
// Sunday DST switch) makes the old buggy local-time formula and the new
// Date.UTC() formula compute bit-identical epochs — the test would pass even
// with the fix reverted. To make this deterministic regardless of which
// timezone the CI/dev host is configured with, we force process.env.TZ to a
// zone with a fixed, always-nonzero UTC offset (Asia/Kolkata, UTC+5:30, no DST)
// for the duration of this suite, then restore the original value. Node reads
// TZ per Date computation (not cached at module load), so this is safe to
// toggle in beforeAll/afterAll.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Asia/Kolkata';
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

const findMany = vi.fn(async (_args?: unknown) => [] as unknown[]);
const count = vi.fn(async (_args?: unknown) => 0);

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoicePayment: {
      findMany: (args: unknown) => findMany(args),
      count: (args: unknown) => count(args),
    },
    purchase: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
  },
}));

import { getIncomeStats } from './accountingReportController';

function fakeReq(): Request {
  return { query: {}, tenantId: 'tenant-1', user: 'tenant-1' } as unknown as Request;
}
function fakeRes(): Response & { body: unknown; statusCode: number } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { body: unknown; statusCode: number };
}

describe('getIncomeStats — previous-month boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mid-March: previous month is February 2026 (28 days). This string has no
    // UTC offset, so it's parsed as 09:00 local time — under the forced
    // Asia/Kolkata TZ (UTC+5:30, set in beforeAll above) that's 03:30 UTC,
    // a genuinely nonzero offset from UTC in both directions of the boundary.
    vi.setSystemTime(new Date('2026-03-15T09:00:00'));
    findMany.mockClear();
    count.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('includes a payment at 23:00 on the last day of the previous month (UTC-safe boundary)', async () => {
    await getIncomeStats(fakeReq(), fakeRes());

    // The previous-month query is the findMany carrying both gte AND lte.
    const prevCall = findMany.mock.calls
      .map((c) => c[0] as { where?: { received_on?: { gte?: Date; lte?: Date } } } | undefined)
      .find((a) => a?.where?.received_on?.lte != null);
    expect(prevCall).toBeTruthy();

    const lte = prevCall!.where!.received_on!.lte!;
    // Last day of Feb 2026 is the 28th; boundary must be inclusive end-of-day,
    // anchored in UTC so the assertion is independent of host timezone.
    expect(lte.getUTCFullYear()).toBe(2026);
    expect(lte.getUTCMonth()).toBe(1); // February (0-based)
    expect(lte.getUTCDate()).toBe(28);
    expect(lte.getUTCHours()).toBe(23);
    expect(lte.getUTCMinutes()).toBe(59);
    expect(lte.getUTCSeconds()).toBe(59);
    expect(lte.getTime()).toBe(Date.UTC(2026, 1, 28, 23, 59, 59, 999));

    // A payment at 23:00 UTC on the 28th must fall within [gte, lte] — this is the
    // exact case a local-time boundary gets wrong on a non-UTC host. Under the
    // forced Asia/Kolkata TZ (UTC+5:30) in this suite, local 23:59:59.999 on the
    // 28th is only 18:29:59.999 UTC, so a 23:00 UTC payment would have been
    // excluded by the old `setHours`/local-getters formula (this is also true,
    // in the other direction, on a UTC+1 host such as BST).
    const lastDay2300Utc = new Date(Date.UTC(2026, 1, 28, 23, 0, 0));
    expect(lastDay2300Utc.getTime()).toBeGreaterThanOrEqual(prevCall!.where!.received_on!.gte!.getTime());
    expect(lastDay2300Utc.getTime()).toBeLessThanOrEqual(lte.getTime());
  });

  it('anchors the previous-month start boundary in UTC too (consistent with the end)', async () => {
    await getIncomeStats(fakeReq(), fakeRes());

    const prevCall = findMany.mock.calls
      .map((c) => c[0] as { where?: { received_on?: { gte?: Date; lte?: Date } } } | undefined)
      .find((a) => a?.where?.received_on?.lte != null);
    const gte = prevCall!.where!.received_on!.gte!;

    expect(gte.getTime()).toBe(Date.UTC(2026, 1, 1, 0, 0, 0, 0));
  });
});
