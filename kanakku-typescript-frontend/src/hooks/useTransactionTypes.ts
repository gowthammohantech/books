import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { TransactionTypeDef, UserPaymentReasons } from '../types/moneyFlow';

// Module-level cache so all hook instances share one fetch
let _cached: TransactionTypeDef[] | null = null;
let _cachedReasons: UserPaymentReasons | null = null;
let _inflight: Promise<{ types: TransactionTypeDef[]; userPaymentReasons: UserPaymentReasons | null }> | null = null;

export function useTransactionTypes() {
    const { token } = useSelector((s: RootState) => s.auth);

    const [types, setTypes] = useState<TransactionTypeDef[]>(_cached ?? []);
    const [userPaymentReasons, setUserPaymentReasons] = useState<UserPaymentReasons | null>(_cachedReasons);
    const [loading, setLoading] = useState(!_cached);

    const doFetch = useCallback((): Promise<{ types: TransactionTypeDef[]; userPaymentReasons: UserPaymentReasons | null }> => {
        if (!_inflight) {
            _inflight = axios
                .get(Constants.GET_TRANSACTION_TYPES_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                .then((res) => {
                    const result: TransactionTypeDef[] = res.data?.data ?? [];
                    const reasons: UserPaymentReasons | null = res.data?.userPaymentReasons ?? null;
                    _cached = result;
                    _cachedReasons = reasons;
                    return { types: result, userPaymentReasons: reasons };
                })
                .catch(() => {
                    _inflight = null;
                    return { types: [], userPaymentReasons: null };
                });
        }
        return _inflight;
    }, [token]);

    useEffect(() => {
        if (_cached) {
            setTypes(_cached);
            setUserPaymentReasons(_cachedReasons);
            setLoading(false);
            return;
        }
        if (!token) return;

        setLoading(true);
        doFetch().then((data) => {
            setTypes(data.types);
            setUserPaymentReasons(data.userPaymentReasons);
            setLoading(false);
        });
    }, [token, doFetch]);

    return { types, userPaymentReasons, loading };
}
