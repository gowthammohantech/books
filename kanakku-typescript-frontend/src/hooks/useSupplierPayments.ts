import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { InvoicePaymentSummary } from '@models/invoice-payment';

export interface SupplierPaymentRow {
    id: string;
    paidAmount: string;
    paymentDate: string | null;
    referenceNumber: string | null;
    notes: string | null;
    isVoided: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    paymentMode: { name: string } | null;
    bank: { bankName: string } | null;
    createdByUser: { firstName: string; lastName: string } | null;
    voidedBy: { firstName: string; lastName: string } | null;
}

const EMPTY_SUMMARY: InvoicePaymentSummary = {
    total: 0,
    paid: 0,
    remaining: 0,
    status: '',
};

export function useSupplierPayments(purchaseId: string) {
    const { token } = useSelector((s: RootState) => s.auth);

    const [payments, setPayments] = useState<SupplierPaymentRow[]>([]);
    const [summary, setSummary] = useState<InvoicePaymentSummary>(EMPTY_SUMMARY);
    const [loading, setLoading] = useState(false);

    const doFetch = useCallback(() => {
        if (!token || !purchaseId) return;

        setLoading(true);
        axios
            .get(`${Constants.PURCHASE_PAYMENTS_URL}/${purchaseId}/payments`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                const inner = res.data?.data ?? {};
                setPayments(inner.payments ?? []);
                setSummary(inner.summary ?? EMPTY_SUMMARY);
            })
            .catch(() => {
                setPayments([]);
                setSummary(EMPTY_SUMMARY);
            })
            .finally(() => {
                setLoading(false);
            });
    }, [token, purchaseId]);

    useEffect(() => {
        doFetch();
    }, [doFetch]);

    return { payments, summary, loading, refetch: doFetch };
}
