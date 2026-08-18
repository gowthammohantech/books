// Single source of truth for how an invoice's stored status maps to what the
// user sees. The stored lifecycle is DRAFT → SENT → PARTIALLY_PAID → PAID
// (+ CANCELLED). "Delayed Payment" is NOT stored — it's derived on the fly when
// an open invoice's due date has passed and a balance remains. Legacy UNPAID
// rows are treated as SENT.

export type DisplayStatus =
    | "DRAFT"
    | "SENT"
    | "PARTIALLY_PAID"
    | "PAID"
    | "DELAYED"
    | "CANCELLED";

export interface InvoiceStatusInput {
    status?: string | null;
    dueDate?: string | Date | null;
    totalAmount?: number | null;
    totalPaid?: number | null;
}

const startOfToday = (): number => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

/**
 * Derive the user-facing status. Overdue ("DELAYED") overlays SENT/PARTIALLY_PAID
 * when the due date has passed and a balance remains.
 */
export const deriveInvoiceDisplayStatus = (input: InvoiceStatusInput): DisplayStatus => {
    const stored = (input.status || "").toUpperCase();

    if (stored === "CANCELLED") return "CANCELLED";
    if (stored === "DRAFT") return "DRAFT";

    const total = Number(input.totalAmount ?? 0);
    const paid = Number(input.totalPaid ?? 0);
    const balance = total - paid;

    // Fully settled regardless of stored value.
    if (stored === "PAID" || (total > 0 && balance <= 0)) return "PAID";

    // Open invoice (SENT / PARTIALLY_PAID / legacy UNPAID / OVERDUE).
    const due = input.dueDate ? new Date(input.dueDate) : null;
    const isPastDue =
        !!due && !Number.isNaN(due.getTime()) && due.getTime() < startOfToday() && balance > 0;
    if (isPastDue) return "DELAYED";

    if (paid > 0 || stored === "PARTIALLY_PAID") return "PARTIALLY_PAID";

    // SENT, UNPAID (legacy), OVERDUE-but-not-actually-past-due → Sent.
    return "SENT";
};

export const DISPLAY_STATUS_META: Record<
    DisplayStatus,
    { label: string; classes: string }
> = {
    DRAFT: { label: "Draft", classes: "bg-warning-soft text-warning" },
    SENT: { label: "Sent", classes: "bg-info-soft text-info" },
    PARTIALLY_PAID: { label: "Partially Paid", classes: "bg-info-soft text-info" },
    PAID: { label: "Fully Paid", classes: "bg-success-soft text-success" },
    DELAYED: { label: "Delayed Payment", classes: "bg-danger-soft text-danger" },
    CANCELLED: { label: "Cancelled", classes: "bg-surface text-body" },
};

/** Only draft invoices can be edited. */
export const isInvoiceEditable = (status?: string | null): boolean =>
    (status || "").toUpperCase() === "DRAFT";
