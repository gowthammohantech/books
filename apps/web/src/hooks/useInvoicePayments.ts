/**
 * Payments recorded against an invoice, with their summary.
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
import type { InvoicePaymentRow, InvoicePaymentSummary } from '@models/invoice-payment';

const EMPTY_SUMMARY: InvoicePaymentSummary = {
    total: 0,
    paid: 0,
    remaining: 0,
    status: '',
};

interface Result {
  payments: InvoicePaymentRow[];
  summary: InvoicePaymentSummary;
}

export function useInvoicePayments(invoiceId: string) {
  const { token } = useSelector((s: RootState) => s.auth);
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: qk.invoicePayments(invoiceId),
    queryFn: async (): Promise<Result> => {
      const res = await api.get(`${Constants.INVOICE_PAYMENTS_URL}/${invoiceId}/payments`);
      const inner = res.data?.data ?? {};
      return { payments: inner.payments ?? [], summary: inner.summary ?? EMPTY_SUMMARY };
    },
    enabled: Boolean(token && invoiceId),
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.invoicePayments(invoiceId) });
  }, [queryClient, invoiceId]);

  return {
    payments: data?.payments ?? [],
    summary: data?.summary ?? EMPTY_SUMMARY,
    loading: isFetching,
    refetch,
  };
}
