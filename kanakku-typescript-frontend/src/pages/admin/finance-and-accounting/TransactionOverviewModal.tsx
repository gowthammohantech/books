import React from "react";
import Modal from "@components/admin/Modal";
import { FileText, CreditCard, Building2, Wallet, InfoIcon } from "lucide-react";
import type { BankTransaction, TransactionOverview } from "@models/bank-transaction";
import useDateFormatter from "@hooks/useDateFormatter";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    transaction: BankTransaction;
    overviewData: TransactionOverview | null;
}

const TransactionOverviewModal: React.FC<Props> = ({
    isOpen,
    onClose,
    transaction,
    overviewData,
}) => {
    if (!overviewData) return null;
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { formatDate } = useDateFormatter();
    const { format } = useCurrencyFormatter();
    const { relatedData } = overviewData;

    const SectionCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
        title,
        icon,
        children,
    }) => (
        <div className="bg-white/70 backdrop-blur-md border border-border rounded-card shadow-card p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 border-b pb-2 mb-3">
                <span className="text-blue-600">{icon}</span>
                <h3 className="font-semibold text-gray-800 text-base">{title}</h3>
            </div>
            {children}
        </div>
    );

    const renderExpenseDetails = () => {
        if (!("expenseId" in relatedData)) return null;

        return (
            <SectionCard title="Expense Details" icon={<Wallet size={18} />}>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <Info label="Expense ID" value={relatedData.expenseId} />
                    <Info label="Date" value={formatDate(relatedData.expenseDate, systemSettings?.dateFormat.format ?? 'DD-MM-YYYY')} />
                    <Info label="Payment Mode" value={relatedData.paymentMode} />
                    <Info label="Category" value={relatedData.category} />
                </div>

                {relatedData.description && (
                    <Info label="Description" value={relatedData.description} className="mt-3" />
                )}

                {relatedData.attachment && (
                    <div className="mt-3">
                        <p className="text-sm text-gray-500">Attachment</p>
                        <a
                            href={relatedData.attachment}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-sm"
                        >
                            View Attachment
                        </a>
                    </div>
                )}

                <div className="border-t pt-3 mt-3">
                    <h4 className="font-medium text-gray-700 mb-2">Created By</h4>
                    <div className="flex items-center gap-3">
                        {relatedData.user.profileImage ? (
                            <img
                                src={relatedData.user.profileImage}
                                alt={relatedData.user.name}
                                className="w-10 h-10 rounded-full object-cover"
                            />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                                {relatedData.user.name?.[0] ?? "?"}
                            </div>
                        )}
                        <div>
                            <p className="font-medium text-gray-800">{relatedData.user.name}</p>
                            <p className="text-xs text-gray-500">{relatedData.user.email}</p>
                            <p className="text-xs text-gray-500">{relatedData.user.phone}</p>
                        </div>
                    </div>
                </div>
            </SectionCard>
        );
    };

    const renderInvoicePaymentDetails = () => {
        if (!("invoiceNumber" in relatedData)) return null;

        return (
            <SectionCard title="Invoice Payment Details" icon={<FileText size={18} />}>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <Info label="Invoice Number" value={relatedData.invoiceNumber} />
                    <Info label="Payment Method" value={relatedData.payment_method} />
                    <Info
                        label="Received On"
                        value={formatDate(relatedData.received_on, systemSettings?.dateFormat.format ?? 'DD-MM-YYYY')}
                    />
                    <Info label="Notes" value={relatedData.notes || "—"} />
                </div>
            </SectionCard>
        );
    };

    const renderSupplierPaymentDetails = () => {
        if (!("purchaseNumber" in relatedData)) return null;

        const { purchaseNumber, paymentMode, notes, attachment, supplier } = relatedData;

        return (
            <SectionCard title="Supplier Payment Details" icon={<Building2 size={18} />}>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <Info label="Purchase Number" value={purchaseNumber} />
                    <Info label="Payment Mode" value={paymentMode} />
                    <Info label="Notes" value={notes} />
                    {attachment && (
                        <div className="col-span-2">
                            <p className="text-sm text-gray-500">Attachment</p>
                            <a
                                href={attachment}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline font-medium"
                            >
                                View Attachment
                            </a>
                        </div>
                    )}
                </div>

                <div className="border-t pt-3 mt-3">
                    <h4 className="font-medium text-gray-700 mb-2">Supplier Info</h4>
                    <div className="flex items-center gap-3">
                        {supplier?.profileImage ? (
                            <img
                                src={supplier.profileImage}
                                alt={supplier.name}
                                className="w-10 h-10 rounded-full object-cover"
                            />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                                {supplier?.name?.charAt(0).toUpperCase() ?? "S"}
                            </div>
                        )}
                        <div>
                            <p className="font-medium text-gray-800">{supplier?.name || "—"}</p>
                            <p className="text-xs text-gray-500">{supplier?.email || "—"}</p>
                            <p className="text-xs text-gray-500">{supplier?.phone || "—"}</p>
                        </div>
                    </div>
                </div>
            </SectionCard>
        );
    };

    const renderManualOrPettyCashDetails = () => {
        if (!("remarks" in relatedData)) return null;
        return (
            <SectionCard title="Remarks" icon={<InfoIcon size={18} />}>
                <Info label="Remarks" value={relatedData.remarks || "—"} />
            </SectionCard>
        );
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Transaction Overview" size="2xl">
            <div className="p-6 space-y-6 bg-gradient-to-b from-gray-50 to-white rounded-2xl">
                {/* Related Section */}
                {transaction.relatedType === "EXPENSE"
                    ? renderExpenseDetails()
                    : transaction.relatedType === "INVOICE_PAYMENT"
                        ? renderInvoicePaymentDetails()
                        : transaction.relatedType === "SUPPLIER_PAYMENT"
                            ? renderSupplierPaymentDetails()
                            : renderManualOrPettyCashDetails()}

                {/* Transaction Info */}
                <SectionCard title="Transaction Details" icon={<CreditCard size={18} />}>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <Info label="Transaction ID" value={transaction.id} />
                        <Info label="Date" value={formatDate(transaction.transactionDate, systemSettings?.dateFormat.format ?? 'DD-MM-YYYY')} />
                        <Info label="Type" value={transaction.type} />
                        <Info label="Amount" value={format(transaction.amount ?? 0)} />
                        <Info label="Balance Before" value={format(transaction.balanceBefore ?? 0)} />
                        <Info label="Balance After" value={format(transaction.balanceAfter ?? 0)} />
                        <Info label="Payment Mode" value={transaction.paymentMode.name} />
                        <Info label="Reference No" value={transaction.referenceNo || "—"} />
                    </div>
                </SectionCard>

                {/* Bank Info */}
                <SectionCard title="Bank Account Details" icon={<Building2 size={18} />}>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <Info label="Account Holder" value={transaction.bankAccount.accountHoldername} />
                        <Info label="Bank Name" value={transaction.bankAccount.bankName} />
                        <Info label="Account Number" value={transaction.bankAccount.accountNumber} />
                    </div>
                </SectionCard>
            </div>
        </Modal>
    );
};

export default TransactionOverviewModal;

interface InfoProps {
    label: string;
    value: string | number | null | undefined;
    className?: string;
}

const Info: React.FC<InfoProps> = ({ label, value, className }) => (
    <div className={className}>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-medium text-gray-900 mt-0.5">
            {value || "—"}
        </p>
    </div>
);
