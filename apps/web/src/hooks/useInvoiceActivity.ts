import api from '@lib/apiClient';
import { useState, useEffect, useCallback } from 'react';

import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { InvoiceActivityEntry } from '@models/invoice-payment';

export function useInvoiceActivity(invoiceId: string) {
    const { token } = useSelector((s: RootState) => s.auth);

    const [entries, setEntries] = useState<InvoiceActivityEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const doFetch = useCallback(() => {
        if (!token || !invoiceId) return;

        setLoading(true);
        api
            .get(`${Constants.INVOICE_ACTIVITY_URL}/${invoiceId}/activity`)
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
    }, [token, invoiceId]);

    useEffect(() => {
        doFetch();
    }, [doFetch]);

    return { entries, loading, refetch: doFetch };
}
