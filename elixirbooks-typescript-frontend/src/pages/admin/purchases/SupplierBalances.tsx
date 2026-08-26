import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { useCurrencies } from '@hooks/useCurrencies';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Card } from '@components/ui';
import NoRecords from '@components/admin/NoRecords';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { downloadExport } from '@utils/downloadExport';

/**
 * Supplier Balances — a supplier-wise view of Accounts Payable activity.
 *
 * AP is a credit-balance liability, so the columns are labelled to keep the
 * convention unambiguous:
 *   - Credit (Bills)            = Σ Purchase.totalAmount       (increases payable)
 *   - Debit  (Payments&Returns) = Σ SupplierPayment.amount + Σ DebitNote.totalAmount
 *   - Balance Due               = Credit − Debit               (outstanding payable)
 *
 * Only suppliers with any AP activity are returned. A TOTALS row is shown at the
 * bottom. Clicking a supplier row drills into the contact view.
 */

interface SupplierBalanceRow {
  contactId: string;
  name: string;
  bills: string;
  paymentsAndReturns: string;
  balance: string;
}

interface SupplierBalancesData {
  rows: SupplierBalanceRow[];
  totals: { bills: string; paymentsAndReturns: string; balance: string };
}

export default function SupplierBalances() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatMoney, defaultCurrencyCode } = useCurrencies();
  const navigate = useNavigate();

  const [data, setData] = useState<SupplierBalancesData | null>(null);
  const [loading, setLoading] = useState(false);

  const money = useCallback(
    (v: string | number) => formatMoney(Number(v ?? 0), defaultCurrencyCode),
    [formatMoney, defaultCurrencyCode],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(Constants.GET_SUPPLIER_BALANCES_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data?.data ?? null);
    } catch {
      toast.error('Failed to load supplier balances');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportCsv() {
    try {
      await downloadExport(`${Constants.GET_SUPPLIER_BALANCES_URL}.csv`, 'supplier-balances.csv');
    } catch {
      toast.error('Failed to export CSV');
    }
  }

  const rows = data?.rows ?? [];
  const hasRows = rows.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Supplier Balances">
        <Button variant="primary" size="sm" onClick={exportCsv} disabled={!hasRows}>
          Export CSV
        </Button>
      </PageHeader>

      <p className="text-xs text-gray-500 mb-4">
        Accounts Payable per supplier. Credit increases what you owe (bills); debit reduces it
        (payments &amp; purchase returns). Balance Due = Credit − Debit.
      </p>

      <Card title="Supplier Balances">
        {loading ? (
          <div className="py-10">
            <LoaderSpinner />
          </div>
        ) : (
          <div className="overflow-x-auto border border-border rounded-control">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 text-xs uppercase text-body">
                <tr>
                  <th className="px-4 py-3 text-left border-b border-border">Supplier</th>
                  <th className="px-4 py-3 text-right border-b border-border">Credit (Bills)</th>
                  <th className="px-4 py-3 text-right border-b border-border">Debit (Payments &amp; Returns)</th>
                  <th className="px-4 py-3 text-right border-b border-border">Balance Due</th>
                </tr>
              </thead>
              <tbody>
                {!hasRows ? (
                  <NoRecords colSpan={4} message="No suppliers with payable activity found." />
                ) : (
                  <>
                    {rows.map((row) => (
                      <tr
                        key={row.contactId}
                        className="border-b border-border cursor-pointer hover:bg-gray-50"
                        onClick={() => navigate(`/admin/contacts/${row.contactId}`)}
                      >
                        <td className="px-4 py-3 text-purple-600 hover:underline">
                          {row.name || '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-danger">{money(row.bills)}</td>
                        <td className="px-4 py-3 text-right text-success">{money(row.paymentsAndReturns)}</td>
                        <td className="px-4 py-3 text-right">{money(row.balance)}</td>
                      </tr>
                    ))}
                    {data && (
                      <tr className="font-semibold border-t-2 border-border">
                        <td className="px-4 py-3">TOTAL</td>
                        <td className="px-4 py-3 text-right text-danger">{money(data.totals.bills)}</td>
                        <td className="px-4 py-3 text-right text-success">{money(data.totals.paymentsAndReturns)}</td>
                        <td className="px-4 py-3 text-right">{money(data.totals.balance)}</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
