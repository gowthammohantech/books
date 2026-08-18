import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { TransactionCategory, CategoryAppliesTo } from '../types/moneyFlow';

export function useTransactionCategories(appliesTo?: CategoryAppliesTo) {
    const { token } = useSelector((s: RootState) => s.auth);

    const [categories, setCategories] = useState<TransactionCategory[]>([]);
    const [loading, setLoading] = useState(true);

    const doFetch = useCallback((): Promise<TransactionCategory[]> => {
        const params: Record<string, string | number> = {
            limit: 500,
            page: 1,
        };
        if (appliesTo) params.appliesTo = appliesTo;

        return axios
            .get(Constants.TRANSACTION_CATEGORIES_URL, {
                headers: { Authorization: `Bearer ${token}` },
                params,
            })
            .then((res) => {
                const data = res.data?.data ?? {};
                return (data.categories ?? []) as TransactionCategory[];
            })
            .catch(() => []);
    }, [token, appliesTo]);

    const refetch = useCallback(() => {
        if (!token) return;
        setLoading(true);
        doFetch().then((data) => {
            setCategories(data);
            setLoading(false);
        });
    }, [token, doFetch]);

    useEffect(() => {
        if (!token) return;
        setLoading(true);
        doFetch().then((data) => {
            setCategories(data);
            setLoading(false);
        });
    }, [token, doFetch]);

    return { categories, loading, refetch };
}
