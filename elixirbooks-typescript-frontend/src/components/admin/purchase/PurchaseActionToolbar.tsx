import { useCurrencies } from "@hooks/useCurrencies";
import { BadgeDollarSignIcon, MailIcon } from "lucide-react";
import { useState } from "react";
import PurchaseEmailModal from "./PurchaseEmailModal";
import SupplierPaymentModal from "./SupplierPaymentModal";
import { Badge, Button } from "@components/ui";
import type { BadgeColor } from "@components/ui";

interface PurchaseActionToolbarProps {
    purchaseId: string;
    purchaseNumber?: string;
    supplierId?: string;
    supplierEmail?: string;
    status: string;
    totalAmount?: number | null;
    totalPaid?: number | null;
    currencyCode?: string | null;
    onChanged?: () => void;
    /**
     * Render mode:
     * - "actions" (default): compact action button row for the top-bar slot
     *   (Record Payment / Send Email). No status badge or summary strip.
     * - "summary": status badge + Total/Paid/Remaining info row, for the page body.
     */
    render?: "actions" | "summary";
}

const STATUS_BADGE_COLOR: Record<string, BadgeColor> = {
    PAID: 'success',
    PARTIALLY_PAID: 'warning',
    PENDING: 'info',
    OVERDUE: 'danger',
};

const PurchaseActionToolbar: React.FC<PurchaseActionToolbarProps> = ({
    purchaseId,
    purchaseNumber,
    supplierId,
    supplierEmail,
    status,
    totalAmount,
    totalPaid,
    currencyCode,
    onChanged,
    render = "actions",
}) => {
    const { formatMoney } = useCurrencies();
    const fmt = (n: number) => formatMoney(n, currencyCode ?? undefined);

    const [isPaymentOpen, setIsPaymentOpen] = useState(false);
    const [isEmailOpen, setIsEmailOpen] = useState(false);

    const total = Number(totalAmount ?? 0);
    const paid = Number(totalPaid ?? 0);
    const remaining = Math.max(0, total - paid);

    const isPaid = status?.toUpperCase() === 'PAID' || (total > 0 && remaining <= 0);
    const canRecordPayment = !isPaid && total > 0;

    const badgeColor: BadgeColor = STATUS_BADGE_COLOR[status?.toUpperCase()] ?? 'gray';

    // Body block: status badge + Total/Paid/Remaining info row.
    if (render === "summary") {
        return (
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <Badge color={badgeColor} variant="soft">{status}</Badge>
                {total > 0 && (
                    <>
                        <span className="text-body">
                            Total:{' '}
                            <span className="font-semibold text-heading">{fmt(total)}</span>
                        </span>
                        <span className="text-body">
                            Paid:{' '}
                            <span className="font-semibold text-success">{fmt(paid)}</span>
                        </span>
                        <span className="text-body">
                            Remaining:{' '}
                            <span className={`font-semibold ${remaining <= 0 ? 'text-success' : 'text-danger'}`}>
                                {fmt(remaining)}
                            </span>
                        </span>
                    </>
                )}
            </div>
        );
    }

    // Slot block: compact action buttons only (Record Payment / Send Email).
    return (
        <div className="flex flex-wrap items-center gap-2">
            {/* Record Payment */}
            {canRecordPayment && (
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => setIsPaymentOpen(true)}
                    leftIcon={<BadgeDollarSignIcon size={15} />}
                >
                    Record Payment
                </Button>
            )}

            {/* Send Email */}
            <Button
                type="button"
                variant="white"
                size="sm"
                onClick={() => setIsEmailOpen(true)}
                leftIcon={<MailIcon size={15} />}
            >
                Send Email
            </Button>

            {/* Supplier Payment Modal */}
            <SupplierPaymentModal
                isOpen={isPaymentOpen}
                onClose={() => setIsPaymentOpen(false)}
                purchaseId={purchaseId}
                supplierId={supplierId ?? ''}
                totalAmount={total}
                remaining={remaining}
                currencyCode={currencyCode}
                onSuccess={() => {
                    setIsPaymentOpen(false);
                    onChanged?.();
                }}
            />

            {/* Purchase Email Modal */}
            <PurchaseEmailModal
                isOpen={isEmailOpen}
                onClose={() => setIsEmailOpen(false)}
                purchaseId={purchaseId}
                purchaseNumber={purchaseNumber}
                supplierEmail={supplierEmail}
                totalAmount={total}
                currencyCode={currencyCode}
            />
        </div>
    );
};

export default PurchaseActionToolbar;
