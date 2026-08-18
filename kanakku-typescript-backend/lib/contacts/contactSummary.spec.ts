import { describe, it, expect } from 'vitest';
import { buildContactSummary } from './contactSummary';

describe('buildContactSummary', () => {
  it('buckets 12 trailing months for the chart, but totals cover the full history', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const res = buildContactSummary([
      { date: new Date('2026-06-01'), received: 1000, paid: 0 },
      { date: new Date('2026-05-01'), received: 0, paid: 300 },
      // Older than 12 months: excluded from the monthly chart buckets, but
      // MUST still count toward totalReceived/totalPaid/balance — those are
      // the contact's full-history figures (must agree with theyOwe/youOwe,
      // which are computed from all-time invoice/purchase data by the
      // caller), not a 12-month rolling window.
      { date: new Date('2025-01-01'), received: 999, paid: 0 },
    ], now);
    expect(res.months).toHaveLength(12);
    expect(res.months[11]).toMatchObject({ label: '2026-06', received: 1000, paid: 0 });
    expect(res.months[10]).toMatchObject({ label: '2026-05', received: 0, paid: 300 });
    // The 2025-01 row must not leak into any bucket (outside the 12-month window).
    const bucketedTotal = res.months.reduce((s, m) => s + m.received + m.paid, 0);
    expect(bucketedTotal).toBe(1300);
    expect(res.totalReceived).toBe(1999);
    expect(res.totalPaid).toBe(300);
    expect(res.balance).toBe(1699);
    expect(res.theyOwe).toBe(1699);
    expect(res.youOwe).toBe(0);
  });

  it('youOwe when paid exceeds received', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const res = buildContactSummary([{ date: new Date('2026-06-01'), received: 0, paid: 500 }], now);
    expect(res.balance).toBe(-500);
    expect(res.theyOwe).toBe(0);
    expect(res.youOwe).toBe(500);
  });
});
