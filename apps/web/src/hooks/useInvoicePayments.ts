import api from '@lib/apiClient';
import { useState, useEffect, useCallback } from 'react';

import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { InvoicePaymentRow, InvoicePaymentSummary } from '@models/invoice-payment';

const EMPTY_SUMMARY: InvoicePaymentSummary = {
    total: 0,
    paid: 0,
    remaining: 0,
    status: '',
};

export function useInvoicePayments(invoiceId: string) {
    const { token } = useSelector((s: RootState) => s.auth);

    const [payments, setPayments] = useState<InvoicePaymentRow[]>([]);
    const [summary, setSummary] = useState<InvoicePaymentSummary>(EMPTY_SUMMARY);
    const [loading, setLoading] = useState(false);

    const doFetch = useCallback(() => {
        if (!token || !invoiceId) return;

        setLoading(true);
        api
            .get(`${Constants.INVOICE_PAYMENTS_URL}/${invoiceId}/payments`)
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
    }, [token, invoiceId]);

    useEffect(() => {
        doFetch();
    }, [doFetch]);

    return { payments, summary, loading, refetch: doFetch };
}
