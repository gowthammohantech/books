// Maps an aging bucket (relative to the report's `asOf` date) to a dueDate
// window, so a clicked bucket drills to exactly the invoices/purchases whose due
// date falls in that range. Mirrors the backend bucket math in
// lib/reports/aging.ts: daysOverdue = floor((asOf - dueDate)/day);
//   current = days<=0, d1_30 = 1..30, d31_60 = 31..60, d61_90 = 61..90, d90plus = >90.

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';

function shiftDays(asOf: string, days: number): string {
    const d = new Date(`${asOf}T00:00:00`);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

export interface DueWindow {
    dueStartDate?: string;
    dueEndDate?: string;
}

export function bucketDueWindow(asOf: string, bucket: AgingBucketKey): DueWindow {
    switch (bucket) {
        case 'current':
            return { dueStartDate: asOf };
        case 'd1_30':
            return { dueStartDate: shiftDays(asOf, 30), dueEndDate: shiftDays(asOf, 1) };
        case 'd31_60':
            return { dueStartDate: shiftDays(asOf, 60), dueEndDate: shiftDays(asOf, 31) };
        case 'd61_90':
            return { dueStartDate: shiftDays(asOf, 90), dueEndDate: shiftDays(asOf, 61) };
        case 'd90plus':
            return { dueEndDate: shiftDays(asOf, 91) };
    }
}

/** The unpaid status sets the aging reports aggregate over (see agingController). */
export const AR_UNPAID_STATUSES = 'UNPAID,PARTIALLY_PAID,OVERDUE,SENT';
export const AP_UNPAID_STATUSES = 'new,pending,partially_paid';
