export interface SummaryRow { date: Date; received: number; paid: number }
export interface ContactSummary {
  months: { label: string; received: number; paid: number }[];
  totalReceived: number;
  totalPaid: number;
  balance: number;
  theyOwe: number;
  youOwe: number;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 12 trailing month buckets ending at `now`'s month; totals + owe split computed
 *  over the same window. Pure — no I/O. */
export function buildContactSummary(rows: SummaryRow[], now: Date): ContactSummary {
  const months: { label: string; received: number; paid: number }[] = [];
  const index = new Map<string, number>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const label = monthKey(d);
    index.set(label, months.length);
    months.push({ label, received: 0, paid: 0 });
  }
  let totalReceived = 0;
  let totalPaid = 0;
  for (const r of rows) {
    // Totals reflect the contact's FULL history — theyOwe/youOwe (computed by
    // the caller from all-time invoice/purchase data) must agree with these,
    // or the summary tiles silently disagree with each other and with the
    // (all-time) Statement of Account. Only the "12-Month Activity" chart
    // buckets are scoped to the trailing 12 months.
    totalReceived += r.received;
    totalPaid += r.paid;
    const k = monthKey(r.date);
    const idx = index.get(k);
    if (idx === undefined) continue; // outside the 12-month CHART window only
    months[idx].received += r.received;
    months[idx].paid += r.paid;
  }
  const balance = totalReceived - totalPaid;
  return { months, totalReceived, totalPaid, balance, theyOwe: Math.max(balance, 0), youOwe: Math.max(-balance, 0) };
}
