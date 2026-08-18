import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';

export interface PurchaseActivityEntry {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    entityLabel: string | null;
    summary: string | null;
    userName: string | null;
    createdAt: string;
}

export function usePurchaseActivity(purchaseId: string) {
    const { token } = useSelector((s: RootState) => s.auth);

    const [entries, setEntries] = useState<PurchaseActivityEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const doFetch = useCallback(() => {
        if (!token || !purchaseId) return;

        setLoading(true);
        axios
            .get(`${Constants.PURCHASE_ACTIVITY_URL}/${purchaseId}/activity`, {
                headers: { Authorization: `Bearer ${token}` },
            })
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
