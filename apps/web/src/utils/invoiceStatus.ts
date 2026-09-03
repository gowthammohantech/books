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
 * business knowing about the UI. It names an Indicator hue rather than class
 * strings now, so the pill's geometry lives in one place.
 */
import type { DisplayStatus } from '@elixirbooks/money';
import type { IndicatorHue } from '@components/ui';

export {
  deriveInvoiceDisplayStatus,
  isInvoiceEditable,
} from '@elixirbooks/money';
export type { DisplayStatus, InvoiceDisplayInput } from '@elixirbooks/money';

export const DISPLAY_STATUS_META: Record<
    DisplayStatus,
    { label: string; hue: IndicatorHue }
> = {
    DRAFT: { label: "Draft", hue: "yellow" },
    SENT: { label: "Sent", hue: "blue" },
    PARTIALLY_PAID: { label: "Partially Paid", hue: "blue" },
    PAID: { label: "Fully Paid", hue: "green" },
    DELAYED: { label: "Delayed Payment", hue: "red" },
    CANCELLED: { label: "Cancelled", hue: "gray" },
};
