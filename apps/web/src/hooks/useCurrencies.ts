/**
 * The tenant's currencies, plus the helpers every money field uses.
 *
 * WHY THIS ONE MATTERS: it held a hand-rolled cache — two module-level globals,
 * `_cached` and `_inflight`, deduplicating the request across hook instances and
 * never expiring. That is React Query's job, done by hand, and it had the
 * failure modes you would expect: nothing invalidated `_cached`, so a currency
 * added in Settings was invisible until a full page reload, and a failed fetch
 * cleared `_inflight` but left every mounted consumer showing an empty list.
 *
 * Same `{ currencies, loading, resolveCurrency, formatMoney, defaultCurrencyCode }`
 * contract as before — the 64 files importing it are untouched.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSelector } from 'react-redux';

import api from '@lib/apiClient';
import Constants from '@constants/api';
import { qk } from '@api/core/queryKeys';
import type { RootState } from '@store/index';
import { formatCurrency } from '@utils/converters';

export interface CurrencyOption {
  id: string;
  code: string;
  symbol: string;
  name: string;
  status: boolean;
  isDefault: boolean;
}

const USD: CurrencyOption = {
  id: 'usd',
  code: 'USD',
  symbol: '$',
  name: 'US Dollar',
  status: true,
  isDefault: false,
};

export function useCurrencies() {
  const { token } = useSelector((s: RootState) => s.auth);
  const systemSettings = useSelector((s: RootState) => s.systemSettings.data);

  const { data, isFetching } = useQuery({
    queryKey: qk.currencies.all,
    queryFn: async (): Promise<CurrencyOption[]> => {
      const res = await api.get(Constants.GET_CURRENCIES_URL, {
        // high limit so we get every active currency, not just page 1
        params: { limit: 1000 },
      });
      // The endpoint returns { data: { currencies: [...], pagination } };
      // tolerate a plain array too. Exclude only explicitly-inactive rows.
      const raw = res.data?.data;
      const arr: CurrencyOption[] = Array.isArray(raw) ? raw : (raw?.currencies ?? raw?.data ?? []);
      return arr.filter((c: CurrencyOption) => c.status !== false);
    },
    enabled: Boolean(token),
    // Currencies change about never, and every money field on every screen reads
    // them. This is the row the old module-level cache was approximating.
    staleTime: 60 * 60 * 1000,
  });

  const currencies = data ?? [];

  /** Resolve a currency code → CurrencyOption, falling back to company default then USD */
  const resolveCurrency = useCallback(
    (code: string | undefined | null): CurrencyOption => {
      if (code) {
        const found = currencies.find((c) => c.code === code);
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
      return USD;
    },
    [currencies, systemSettings],
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
    [resolveCurrency],
  );

  /** The company default currency code from systemSettings */
  const defaultCurrencyCode = systemSettings?.currency?.code ?? 'USD';

  return { currencies, loading: isFetching, resolveCurrency, formatMoney, defaultCurrencyCode };
}
