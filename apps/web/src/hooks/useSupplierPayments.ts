/**
 * Payments recorded against a purchase, with their summary.
 *
 * React Query behind the same `{ payments, summary, loading, refetch }` contract the
 * hand-rolled version returned, so its callers are untouched. Deduplicated
 * across mounts, cached, and abandoned on unmount — none of which the
 * useState/useEffect version did.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSelector } from 'react-redux';

import api from '@lib/apiClient';
import Constants from '@constants/api';
import { qk } from '@api/core/queryKeys';
import type { RootState } from '@store/index';
import type { InvoicePaymentSummary } from '@models/invoice-payment';

/**
 * A supplier payment row.
 *
 * Declared here rather than in types/: PurchasePaymentHistoryPanel imports it
 * from this module, so it is part of the hook's published surface.
 */
export interface SupplierPaymentRow {
    id: string;
    paidAmount: string;
    paymentDate: string | null;
    referenceNumber: string | null;
    notes: string | null;
    isVoided: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    paymentMode: { name: string } | null;
    bank: { bankName: string } | null;
    createdByUser: { firstName: string; lastName: string } | null;
    voidedBy: { firstName: string; lastName: string } | null;
}

const EMPTY_SUMMARY: InvoicePaymentSummary = {
    total: 0,
    paid: 0,
    remaining: 0,
    status: '',
};

interface Result {
  payments: SupplierPaymentRow[];
  summary: InvoicePaymentSummary;
}

export function useSupplierPayments(purchaseId: string) {
  const { token } = useSelector((s: RootState) => s.auth);
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: qk.supplierPayments(purchaseId),
    queryFn: async (): Promise<Result> => {
      const res = await api.get(`${Constants.PURCHASE_PAYMENTS_URL}/${purchaseId}/payments`);
      const inner = res.data?.data ?? {};
      return { payments: inner.payments ?? [], summary: inner.summary ?? EMPTY_SUMMARY };
    },
    enabled: Boolean(token && purchaseId),
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.supplierPayments(purchaseId) });
  }, [queryClient, purchaseId]);

  return {
    payments: data?.payments ?? [],
    summary: data?.summary ?? EMPTY_SUMMARY,
    loading: isFetching,
    refetch,
  };
}
