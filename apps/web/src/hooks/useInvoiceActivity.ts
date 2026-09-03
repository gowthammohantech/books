/**
 * An invoice's audit feed.
 *
 * Backed by React Query, behind the SAME `{ entries, loading, refetch }` contract
 * the useState/useEffect version returned — so its consumers are untouched. That
 * is what makes this migration safe to do in bulk: the risk lives in the hook,
 * not in the screens reading it.
 *
 * What it buys beyond tidiness: the request is deduplicated across components
 * mounting the same id, cached for the client's staleTime, and abandoned on
 * unmount. The hand-rolled version had none of those — and, because it had no
 * cleanup, set state on unmounted components.
 *
 * `enabled` replaces the `if (!token || !invoiceId) return` early return. Since
 * the Authorization headers came out, `token` here is only ever a guard; the
 * credential comes from the interceptor.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSelector } from 'react-redux';

import api from '@lib/apiClient';
import Constants from '@constants/api';
import { qk } from '@api/core/queryKeys';
import type { RootState } from '@store/index';
import type { InvoiceActivityEntry } from '@models/invoice-payment';

export function useInvoiceActivity(invoiceId: string) {
  const { token } = useSelector((s: RootState) => s.auth);
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: qk.invoiceActivity(invoiceId),
    queryFn: async (): Promise<InvoiceActivityEntry[]> => {
      const res = await api.get(`${Constants.INVOICE_ACTIVITY_URL}/${invoiceId}/activity`);
      // Confirmed array key from API: data.items (not logs/activities/data)
      return res.data?.data?.items ?? [];
    },
    enabled: Boolean(token && invoiceId),
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.invoiceActivity(invoiceId) });
  }, [queryClient, invoiceId]);

  // The old hook swallowed errors into an empty list; `data ?? []` keeps that,
  // rather than surfacing an error state no caller is written to handle.
  return { entries: data ?? [], loading: isFetching, refetch };
}
