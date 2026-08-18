import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import { formatCurrency } from '@utils/converters';

export interface CurrencyOption {
    id: string;
    code: string;
    symbol: string;
    name: string;
    status: boolean;
    isDefault: boolean;
}

// Module-level cache so all hook instances share one fetch
let _cached: CurrencyOption[] | null = null;
let _inflight: Promise<CurrencyOption[]> | null = null;

export function useCurrencies() {
    const { token } = useSelector((s: RootState) => s.auth);
    const systemSettings = useSelector((s: RootState) => s.systemSettings.data);

    const [currencies, setCurrencies] = useState<CurrencyOption[]>(_cached ?? []);
    const [loading, setLoading] = useState(!_cached);

    useEffect(() => {
        if (_cached) {
            setCurrencies(_cached);
            setLoading(false);
            return;
        }
        if (!token) return;

        if (!_inflight) {
            _inflight = axios
                .get(Constants.GET_CURRENCIES_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                    // high limit so we get every active currency, not just page 1
                    params: { limit: 1000 },
                })
                .then((res) => {
                    // The endpoint returns { data: { currencies: [...], pagination } };
                    // tolerate a plain array too. Exclude only explicitly-inactive rows.
                    const raw = res.data?.data;
                    const arr: CurrencyOption[] = Array.isArray(raw)
                        ? raw
                        : (raw?.currencies ?? raw?.data ?? []);
                    const list: CurrencyOption[] = arr.filter(
                        (c: CurrencyOption) => c.status !== false
                    );
                    _cached = list;
                    return list;
                })
                .catch(() => {
                    _inflight = null;
                    return [];
                });
        }

        setLoading(true);
        _inflight.then((list) => {
            setCurrencies(list);
            setLoading(false);
        });
    }, [token]);

    /** Resolve a currency code → CurrencyOption, falling back to company default then USD */
    const resolveCurrency = useCallback(
        (code: string | undefined | null): CurrencyOption => {
            if (code) {
                const found = (currencies.length ? currencies : _cached ?? []).find(
                    (c) => c.code === code
                );
                if (found) return found;
            }
            // fallback: company default
            const defaultCurrency = systemSettings?.currency;
            if (defaultCurrency) {
                return {
                    id: defaultCurrency.id,
                    code: defaultCurrency.code,
                    symbol: defaultCurrency.symbol,
                    name: defaultCurrency.name,
                    status: true,
                    isDefault: true,
                };
            }
            // last resort
            return { id: 'usd', code: 'USD', symbol: '$', name: 'US Dollar', status: true, isDefault: false };
        },
        [currencies, systemSettings]
    );

    /** Format amount with the given currency code's symbol */
    const formatMoney = useCallback(
        (amount: number | string | null | undefined, code: string | undefined | null): string => {
            // API amounts often arrive as Decimal strings — coerce so neither
            // formatCurrency nor the toFixed fallback crashes on a string.
            const n = Number(amount) || 0;
            const resolved = resolveCurrency(code);
            try {
                return formatCurrency(n, resolved.code);
            } catch {
                return `${resolved.symbol}${n.toFixed(2)}`;
            }
        },
        [resolveCurrency]
    );

    /** The company default currency code from systemSettings */
    const defaultCurrencyCode = systemSettings?.currency?.code ?? 'USD';

    return { currencies, loading, resolveCurrency, formatMoney, defaultCurrencyCode };
}
