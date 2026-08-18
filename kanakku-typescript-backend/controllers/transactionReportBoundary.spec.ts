// controllers/transactionReportBoundary.spec.ts
//
// Regression for the P2-3 follow-up finding: transactionReportController built
// its month-boundary comparisons (current-vs-previous-month stat cards) from
// LOCAL getFullYear()/getMonth()/setHours(), while the sibling
// accountingReportController was hardened to anchor the same boundaries in
// UTC via Date.UTC() (see lib/reports/asOf.ts header). On a non-UTC
// self-hosted host the two report families could bucket a late-in-day
// month-edge document into DIFFERENT months. This test mirrors
// controllers/accountingReportBoundary.spec.ts and must fail if the
// boundaries in transactionReportController regress back to local time.
//
// IMPORTANT: this test is only a meaningful regression guard if the local/UTC
// offset in play is actually nonzero. We force process.env.TZ to a zone with
// a fixed, always-nonzero UTC offset (Asia/Kolkata, UTC+5:30, no DST) for the
// duration of this suite, then restore the original value. Node reads TZ per
// Date computation (not cached at module load), so this is safe to toggle in
// beforeAll/afterAll.
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
    purchaseOrder: {
      findMany: (args: unknown) => findMany(args),
      count: (args: unknown) => count(args),
    },
    product: { findMany: vi.fn(async () => []) },
  },
}));

import { getPurchaseOrderReport } from './transactionReportController';

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

describe('getPurchaseOrderReport — previous-month boundary', () => {
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

  it('includes a purchase order at 23:00 on the last day of the previous month (UTC-safe boundary)', async () => {
    await getPurchaseOrderReport(fakeReq(), fakeRes());

    // Both the current- and previous-month comparison calls carry a `lte`, so
    // disambiguate the previous-month call by its `gte` (pinned to Feb 1,
    // 2026 UTC) rather than mere presence of `lte`.
    const prevCall = findMany.mock.calls
      .map(
        (c) =>
          c[0] as
            | { where?: { purchaseOrderDate?: { gte?: Date; lte?: Date } } }
            | undefined,
      )
      .find(
        (a) =>
          a?.where?.purchaseOrderDate?.gte != null &&
          a.where!.purchaseOrderDate!.gte!.getTime() === Date.UTC(2026, 1, 1, 0, 0, 0, 0),
      );
    expect(prevCall).toBeTruthy();

    const lte = prevCall!.where!.purchaseOrderDate!.lte!;
    // Last day of Feb 2026 is the 28th; boundary must be inclusive end-of-day,
    // anchored in UTC so the assertion is independent of host timezone.
    expect(lte.getUTCFullYear()).toBe(2026);
    expect(lte.getUTCMonth()).toBe(1); // February (0-based)
    expect(lte.getUTCDate()).toBe(28);
    expect(lte.getUTCHours()).toBe(23);
    expect(lte.getUTCMinutes()).toBe(59);
    expect(lte.getUTCSeconds()).toBe(59);
    expect(lte.getTime()).toBe(Date.UTC(2026, 1, 28, 23, 59, 59, 999));

    // A purchase order at 23:00 UTC on the 28th must fall within [gte, lte] —
    // this is the exact case a local-time boundary gets wrong on a non-UTC
    // host. Under the forced Asia/Kolkata TZ (UTC+5:30) in this suite, local
    // 23:59:59.999 on the 28th is only 18:29:59.999 UTC, so a 23:00 UTC
    // purchase order would have been excluded by the old
    // `setHours`/local-getters formula (this is also true, in the other
    // direction, on a UTC+1 host such as BST).
    const lastDay2300Utc = new Date(Date.UTC(2026, 1, 28, 23, 0, 0));
    expect(lastDay2300Utc.getTime()).toBeGreaterThanOrEqual(
      prevCall!.where!.purchaseOrderDate!.gte!.getTime(),
    );
    expect(lastDay2300Utc.getTime()).toBeLessThanOrEqual(lte.getTime());
  });

  it('anchors the previous-month start boundary in UTC too (consistent with the end)', async () => {
    await getPurchaseOrderReport(fakeReq(), fakeRes());

    const prevCall = findMany.mock.calls
      .map(
        (c) =>
          c[0] as
            | { where?: { purchaseOrderDate?: { gte?: Date; lte?: Date } } }
            | undefined,
      )
      .find(
        (a) =>
          a?.where?.purchaseOrderDate?.gte != null &&
          a.where!.purchaseOrderDate!.gte!.getTime() === Date.UTC(2026, 1, 1, 0, 0, 0, 0),
      );
    const gte = prevCall!.where!.purchaseOrderDate!.gte!;

    expect(gte.getTime()).toBe(Date.UTC(2026, 1, 1, 0, 0, 0, 0));
  });

  it('anchors the current-month end boundary in UTC too (inclusive end-of-month)', async () => {
    await getPurchaseOrderReport(fakeReq(), fakeRes());

    // The current-month query is the findMany carrying purchaseOrderDate with
    // gte pinned to the 1st of March 2026 (i.e. NOT the previous-month call).
    const currCall = findMany.mock.calls
      .map(
        (c) =>
          c[0] as
            | { where?: { purchaseOrderDate?: { gte?: Date; lte?: Date } } }
            | undefined,
      )
      .find(
        (a) =>
          a?.where?.purchaseOrderDate?.gte != null &&
          a.where!.purchaseOrderDate!.gte!.getTime() === Date.UTC(2026, 2, 1, 0, 0, 0, 0),
      );
    expect(currCall).toBeTruthy();

    const lte = currCall!.where!.purchaseOrderDate!.lte!;
    expect(lte.getTime()).toBe(Date.UTC(2026, 2, 31, 23, 59, 59, 999));
  });
});
