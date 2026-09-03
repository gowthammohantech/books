/**
 * A purchase's audit feed. The invoice counterpart is `useInvoiceActivity`.
 *
 * Same React Query treatment, same `{ entries, loading, refetch }` contract, so
 * `OverviewPurchase` is untouched — which matters here because that screen calls
 * this hook for both its rows and its refresh, and the two used to be separate
 * hook instances over the same endpoint.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSelector } from 'react-redux';

import api from '@lib/apiClient';
import Constants from '@constants/api';
import { qk } from '@api/core/queryKeys';
import type { ActivityEntry } from '@models/activity';
import type { RootState } from '@store/index';

/** @see ActivityEntry — the invoice feed carries the identical shape. */
export type PurchaseActivityEntry = ActivityEntry;

export function usePurchaseActivity(purchaseId: string) {
  const { token } = useSelector((s: RootState) => s.auth);
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: qk.purchaseActivity(purchaseId),
    queryFn: async (): Promise<PurchaseActivityEntry[]> => {
      const res = await api.get(`${Constants.PURCHASE_ACTIVITY_URL}/${purchaseId}/activity`);
      return res.data?.data?.items ?? [];
    },
    enabled: Boolean(token && purchaseId),
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.purchaseActivity(purchaseId) });
  }, [queryClient, purchaseId]);

  return { entries: data ?? [], loading: isFetching, refetch };
}
