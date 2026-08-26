import { useState } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';
import Modal from '@components/admin/Modal';
import { useInvoicePayments } from '@hooks/useInvoicePayments';
import useDateFormatter from '@hooks/useDateFormatter';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { InvoicePaymentRow } from '@models/invoice-payment';
import { Button, Badge, FormField, fieldControlClasses } from '@components/ui';

interface PaymentHistoryPanelProps {
    invoiceId: string;
    onChanged?: () => void;
}

function formatCurrency(value: string | number): string {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n)) return '-';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fullName(user: { firstName: string; lastName: string } | null | undefined): string {
    if (!user) return '-';
    return `${user.firstName} ${user.lastName}`.trim() || '-';
}

// ---- Void confirm dialog ---------------------------------------------------
interface VoidDialogProps {
    payment: InvoicePaymentRow;
    onConfirm: (reason: string) => Promise<void>;
    onClose: () => void;
}

const VoidDialog: React.FC<VoidDialogProps> = ({ payment, onConfirm, onClose }) => {
    const { formatDate } = useDateFormatter();
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async () => {
        const trimmed = reason.trim();
        if (!trimmed) {
            toast.error('Please enter a reason for voiding this payment.');
            return;
        }
        setBusy(true);
        try {
            await onConfirm(trimmed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen title="Void Payment" onClose={onClose} size="sm">
            <div className="space-y-4">
                <p className="text-sm text-gray-700">
                    You are about to void the payment of{' '}
                    <strong>{formatCurrency(payment.amount)}</strong> received on{' '}
                    <strong>{formatDate(payment.received_on)}</strong>.
                    This action cannot be undone.
                </p>
                <FormField id="voidReason" label="Reason" required>
                    {(field) => (
                        <textarea
                            id={field.id}
                            required={field.required}
                            aria-invalid={field['aria-invalid']}
                            aria-describedby={field['aria-describedby']}
                            rows={3}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Enter reason for voiding…"
                            className={fieldControlClasses()}
                        />
                    )}
                </FormField>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="white" size="sm" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={handleSubmit}
                        disabled={busy}
                        isLoading={busy}
                    >
                        {busy ? 'Voiding…' : 'Void Payment'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

// ---- Main panel ------------------------------------------------------------
const PaymentHistoryPanel: React.FC<PaymentHistoryPanelProps> = ({ invoiceId, onChanged }) => {
    const { formatDate } = useDateFormatter();
    const { token } = useSelector((s: RootState) => s.auth);
    const { payments, loading, refetch } = useInvoicePayments(invoiceId);
    const [voidTarget, setVoidTarget] = useState<InvoicePaymentRow | null>(null);

    const handleVoidConfirm = async (reason: string) => {
        if (!voidTarget) return;
        try {
            await axios.post(
                `${Constants.VOID_INVOICE_PAYMENT_URL}/${voidTarget.id}/void`,
                { reason },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success('Payment voided successfully.');
            setVoidTarget(null);
            refetch();
            onChanged?.();
        } catch (err: any) {
            toast.error(err?.response?.data?.error || 'Failed to void payment.');
        }
    };

    return (
        <div className="font-sans max-w-5xl mx-auto mt-8 mb-4 bg-white rounded-card border border-border shadow-card">
            {/* Card header */}
            <div className="px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-heading">Payment History</h2>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                {loading ? (
                    <div className="p-6 text-center text-sm text-gray-500">Loading payments…</div>
                ) : payments.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-400">No payments recorded.</div>
                ) : (
                    <table className="min-w-full text-sm divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                {['Date', 'Amount', 'Method', 'Bank', 'Reference', 'Notes', 'Recorded By', 'Status', ''].map(
                                    (h) => (
                                        <th
                                            key={h}
                                            className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                                        >
                                            {h}
                                        </th>
                                    ),
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {payments.map((p) => (
                                <tr key={p.id} className={p.isVoided ? 'bg-gray-50 text-gray-400' : ''}>
                                    {/* Date */}
                                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.received_on)}</td>

                                    {/* Amount */}
                                    <td className="px-3 py-2 whitespace-nowrap font-medium">
                                        {p.isVoided ? (
                                            <span className="line-through">{formatCurrency(p.amount)}</span>
                                        ) : (
                                            formatCurrency(p.amount)
                                        )}
                                    </td>

                                    {/* Method */}
                                    <td className="px-3 py-2 whitespace-nowrap">{p.paymentMode?.name ?? '-'}</td>

                                    {/* Bank */}
                                    <td className="px-3 py-2 whitespace-nowrap">{p.bank?.bankName ?? '-'}</td>

                                    {/* Reference */}
                                    <td className="px-3 py-2 whitespace-nowrap">{p.reference ?? '-'}</td>

                                    {/* Notes */}
                                    <td className="px-3 py-2 max-w-[180px] truncate" title={p.notes ?? undefined}>
                                        {p.notes || '-'}
                                    </td>

                                    {/* Recorded by */}
                                    <td className="px-3 py-2 whitespace-nowrap">{fullName(p.receivedByUser)}</td>

                                    {/* Status chip */}
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        {p.isVoided ? (
                                            <Badge color="gray">Voided</Badge>
                                        ) : (
                                            <Badge color="success">Active</Badge>
                                        )}
                                    </td>

                                    {/* Action / void detail */}
                                    <td className="px-3 py-2 whitespace-nowrap text-right">
                                        {p.isVoided ? (
                                            <span
                                                className="text-xs text-gray-400 cursor-default"
                                                title={`Voided by ${fullName(p.voidedBy)} on ${formatDate(p.voidedAt)}${p.voidReason ? `: ${p.voidReason}` : ''}`}
                                            >
                                                {p.voidReason ? `"${p.voidReason}"` : 'No reason provided'}
                                            </span>
                                        ) : (
                                            <Button
                                                type="button"
                                                variant="danger"
                                                size="sm"
                                                onClick={() => setVoidTarget(p)}
                                            >
                                                Void
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Void confirm dialog */}
            {voidTarget && (
                <VoidDialog
                    payment={voidTarget}
                    onConfirm={handleVoidConfirm}
                    onClose={() => setVoidTarget(null)}
                />
            )}
        </div>
    );
};

export default PaymentHistoryPanel;
