import type { ActivityEntry } from '@models/activity';
import api from '@lib/apiClient';
import { useState, useEffect, useCallback } from 'react';

import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';

/** @see ActivityEntry — the invoice feed carries the identical shape. */
export type PurchaseActivityEntry = ActivityEntry;

export function usePurchaseActivity(purchaseId: string) {
    const { token } = useSelector((s: RootState) => s.auth);

    const [entries, setEntries] = useState<PurchaseActivityEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const doFetch = useCallback(() => {
        if (!token || !purchaseId) return;

        setLoading(true);
        api
            .get(`${Constants.PURCHASE_ACTIVITY_URL}/${purchaseId}/activity`)
            .then((res) => {
                const inner = res.data?.data ?? {};
                setEntries(inner.items ?? []);
            })
            .catch(() => {
                setEntries([]);
            })
            .finally(() => {
                setLoading(false);
            });
    }, [token, purchaseId]);

    useEffect(() => {
        doFetch();
    }, [doFetch]);

    return { entries, loading, refetch: doFetch };
}
