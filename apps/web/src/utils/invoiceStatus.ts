/**
 * How an invoice's stored status maps to what the user sees.
 *
 * The derivation itself lives in @elixirbooks/money, shared with the server, so
 * the badge and the aging report answer the same question. The frontend's own
 * copy had no credit-note term at all — it computed `totalAmount - totalPaid` —
 * so a credit-noted, past-due invoice rendered "Delayed Payment" while the
 * backend considered it settled. Callers should now pass `creditNoted`.
 *
 * The label/colour map stays here: it is presentation, and the package has no
 * business knowing about Tailwind classes.
 */
import type { DisplayStatus } from '@elixirbooks/money';

export {
  deriveInvoiceDisplayStatus,
  isInvoiceEditable,
} from '@elixirbooks/money';
export type { DisplayStatus, InvoiceDisplayInput } from '@elixirbooks/money';

export const DISPLAY_STATUS_META: Record<
    DisplayStatus,
    { label: string; classes: string }
> = {
    DRAFT: { label: "Draft", classes: "bg-warning-soft text-warning-strong" },
    SENT: { label: "Sent", classes: "bg-info-soft text-info-strong" },
    PARTIALLY_PAID: { label: "Partially Paid", classes: "bg-info-soft text-info-strong" },
    PAID: { label: "Fully Paid", classes: "bg-success-soft text-success-strong" },
    DELAYED: { label: "Delayed Payment", classes: "bg-destructive-soft text-destructive-strong" },
    CANCELLED: { label: "Cancelled", classes: "bg-muted text-muted-foreground" },
};
