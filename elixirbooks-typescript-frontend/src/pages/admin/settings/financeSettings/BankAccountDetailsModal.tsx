import React from "react";
import Modal from "@components/admin/Modal";
import type { BankAccount } from "@models/bank-account";
import useDateFormatter from "@hooks/useDateFormatter";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import { useCurrencies } from "@hooks/useCurrencies";
import { getBankCodeType } from "@constants/bankCodeTypes";
import { CreditCard } from "lucide-react";
import { Badge, Button } from "@components/ui";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    bankAccount: BankAccount & { asOnDate?: string };
}

const BankAccountDetailsModal: React.FC<Props> = ({ isOpen, onClose, bankAccount }) => {
    if (!bankAccount) return null;

    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { formatMoney, defaultCurrencyCode } = useCurrencies();
    const { formatDate } = useDateFormatter();
    const dateFormat = systemSettings?.dateFormat.format || "DD-MM-YYYY";
    const accountCurrency = bankAccount.currencyCode || defaultCurrencyCode;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Bank Account Overview">
            <div className="bg-muted border border-border rounded-xl">
                {/* --- Header --- */}
                <div className="px-6 py-4 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">
                                {bankAccount.accountHoldername}
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1 font-medium">
                                {bankAccount.bankName}
                            </p>
                        </div>
                        <Badge color={bankAccount.status ? "success" : "danger"} variant="solid">
                            {bankAccount.status ? "Active" : "Inactive"}
                        </Badge>
                    </div>
                </div>

                {/* --- Balance Card --- */}
                <div className="p-6">
                    <div className="relative p-5 bg-muted border border-border rounded-xl shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">
                                    Current Balance
                                </p>
                                <p className={`text-3xl font-bold tracking-tight mt-1 ${bankAccount.currentBalance >= 0
                                    ? "text-foreground"
                                    : "text-destructive"
                                    }`}
                                >
                                    {formatMoney(bankAccount.currentBalance || 0, accountCurrency)}
                                </p>
                            </div>
                            <div className="p-3 rounded-full bg-primary text-white">
                                <CreditCard size={24} />
                            </div>
                        </div>
                        {bankAccount.asOnDate && (
                            <p className="text-xs text-muted-foreground mt-3">
                                As on {formatDate(bankAccount.asOnDate, dateFormat)}
                            </p>
                        )}
                    </div>
                </div>

                {/* --- Account Info Section --- */}
                <div className="px-6 pb-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Account Details</h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                        <div className="col-span-1">
                            <dt className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Account No.</dt>
                            <dd className="text-sm font-mono text-foreground mt-1">{bankAccount.accountNumber}</dd>
                        </div>
                        <div className="col-span-1">
                            <dt className="text-xs uppercase tracking-wider font-medium text-muted-foreground">{getBankCodeType(bankAccount.bankCodeType).label}</dt>
                            <dd className="text-sm font-mono text-foreground mt-1">{bankAccount.IFSCCode}</dd>
                        </div>
                        <div className="col-span-1">
                            <dt className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Account Type</dt>
                            <dd className="text-sm capitalize text-foreground mt-1">{bankAccount.accountType}</dd>
                        </div>
                        <div className="col-span-1">
                            <dt className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Branch</dt>
                            <dd className="text-sm text-foreground mt-1">{bankAccount.branchName}</dd>
                        </div>
                        <div className="col-span-2 border-t border-border my-2"></div>
                        <div className="col-span-1">
                            <dt className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Currency</dt>
                            <dd className="text-sm text-foreground mt-1">{accountCurrency}</dd>
                        </div>
                        <div className="col-span-1">
                            <dt className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Opening Balance</dt>
                            <dd className="text-sm text-foreground mt-1">{formatMoney(bankAccount.openingBalance || 0, accountCurrency)}</dd>
                        </div>
                        <div className="col-span-1">
                            <dt className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Created On</dt>
                            <dd className="text-sm text-foreground mt-1">{formatDate(bankAccount.createdAt, dateFormat)}</dd>
                        </div>
                    </dl>
                </div>

                {/* --- Footer --- */}
                <div className="px-6 py-4 flex justify-end">
                    <Button variant="primary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default BankAccountDetailsModal;