import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Cookies from 'js-cookie';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { InvoiceActivityEntry } from '@models/invoice-payment';

export function useInvoiceActivity(invoiceId: string) {
    const { token: reduxToken } = useSelector((s: RootState) => s.auth);

    const [entries, setEntries] = useState<InvoiceActivityEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const doFetch = useCallback(() => {
        // Fall back to cookie so the hook fires on page refresh before Redux is hydrated.
        const token = reduxToken || Cookies.get("authToken") || "";
        if (!token || !invoiceId) return;

        setLoading(true);
        axios
            .get(`${Constants.INVOICE_ACTIVITY_URL}/${invoiceId}/activity`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                // Confirmed array key from API: data.items (not logs/activities/data)
                const inner = res.data?.data ?? {};
                setEntries(inner.items ?? []);
            })
            .catch(() => {
                setEntries([]);
            })
            .finally(() => {
                setLoading(false);
            });
    }, [reduxToken, invoiceId]);

    useEffect(() => {
        doFetch();
    }, [doFetch]);

    return { entries, loading, refetch: doFetch };
}
