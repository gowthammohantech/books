import api from '@lib/apiClient';
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { toast } from 'sonner';
import { Download, Pencil, Wallet } from 'lucide-react';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { Contact } from '@models/contact';
import { useCurrencies } from '@hooks/useCurrencies';
import useDateFormatter from '@hooks/useDateFormatter';
import MultiLineAreaChart from '@components/admin/MultiLineAreaChart';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';
import GrantCreditModal from './GrantCreditModal';
import { themeColor } from "@lib/designTokens";

// ── Types ─────────────────────────────────────────────────────────────────────

const CONTACTS_URL = `${Constants.API_BASE_URL}/admin/contacts`;

interface MonthBucket {
  label: string;
  received: number;
  paid: number;
}

interface SummaryData {
  contact: Contact;
  months: MonthBucket[];
  totalReceived: number;
  totalPaid: number;
  balance: number;
  theyOwe: number;
  youOwe: number;
  accountCreditBalance: number;
}

interface StatementLine {
  date: string;
  kind: 'INVOICE' | 'PAYMENT' | 'BILL' | 'SUPPLIER_PAYMENT' | 'DEBIT_NOTE';
  reference: string;
  description: string;
  debit: number;
  credit: number;
}

interface CurrencyStatement {
  currencyCode: string;
  openingBalance: number;
  lines: StatementLine[];
  totals: { debit: number; credit: number };
  closingBalance: number;
}

interface StatementData {
  byCurrency: CurrencyStatement[];
}

interface HistoryItem {
  id: string;
  date: string;
  type: string;
  reference: string;
  description: string;
  amount?: number | null;
  currencyCode?: string | null;
  status?: string | null;
}

type TabId =
  | 'summary'
  | 'invoices'
  | 'recurring-invoices'
  | 'bills'
  | 'estimates'
  | 'statement'
  | 'history'
  | 'notes';

const TABS: { id: TabId; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'recurring-invoices', label: 'Recurring Invoices' },
  { id: 'bills', label: 'Bills' },
  { id: 'estimates', label: 'Estimates' },
  { id: 'statement', label: 'Statement of Account' },
  { id: 'history', label: 'Account History' },
  { id: 'notes', label: 'Notes' },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-xl font-bold ${color ?? 'text-gray-800'}`}>{value}</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-40 text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-gray-800">{String(value)}</span>
    </div>
  );
}

// ── Tab: Summary ──────────────────────────────────────────────────────────────

function SummaryTab({
  contactId,
  token,
  refreshKey,
}: {
  contactId: string;
  token: string;
  /** Bumped by the host after a mutation (e.g. granting credit) to trigger a re-fetch. */
  refreshKey?: number;
}) {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { formatMoney } = useCurrencies();

  const handleVCardDownload = async () => {
    try {
      const res = await api.get(`${Constants.API_BASE_URL}/admin/contacts/${contactId}/vcard`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${summary?.contact?.displayName || summary?.contact?.organisation || 'contact'}.vcf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download vCard.');
    }
  };

  useEffect(() => {
    setLoading(true);
    api
      .get(`${CONTACTS_URL}/${contactId}/summary`)
      .then((res) => {
        setSummary(res.data?.data ?? null);
      })
      .catch(() => setError('Failed to load summary'))
      .finally(() => setLoading(false));
  }, [contactId, token, refreshKey]);

  if (loading) return <p className="text-gray-500 py-4">Loading summary…</p>;
  if (error) return <p className="text-destructive py-4">{error}</p>;
  if (!summary) return <p className="text-gray-400 py-4">No summary data.</p>;

  const contact = summary.contact;
  const currency = contact.currencyCode ?? null;

  const fmt = (n: number) => formatMoney(n, currency);

  const chartLabels = summary.months.map((m) => m.label);
  const receivedData = summary.months.map((m) => m.received);
  const paidData = summary.months.map((m) => m.paid);

  const addressParts = [
    contact.addressLine1,
    contact.addressLine2,
    contact.addressLine3,
    contact.town,
    contact.region,
    contact.postcode,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* 12-month chart */}
      <div className="border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">12-Month Activity</h3>
        {summary.months.length > 0 ? (
          <MultiLineAreaChart
            data={[receivedData, paidData]}
            categories={chartLabels}
            color={[themeColor("primary"), themeColor("warning")]}
            seriesNames={['Received', 'Paid']}
          />
        ) : (
          <p className="text-gray-400 text-sm">No monthly data available.</p>
        )}
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="They Owe" value={fmt(summary.theyOwe)} color="text-green-700" />
        <StatCard label="You Owe" value={fmt(summary.youOwe)} color="text-orange-600" />
        <StatCard
          label="Net Balance"
          value={fmt(summary.balance)}
          color={summary.balance >= 0 ? 'text-green-700' : 'text-red-600'}
        />
        <StatCard label="Total Received" value={fmt(summary.totalReceived)} />
        <StatCard label="Total Paid" value={fmt(summary.totalPaid)} />
        {/* Fixed accent (not trend-derived) — a credit balance is neither a "good"
            nor "bad" signal by sign, so it always renders the same info color. */}
        <StatCard label="Account Credit" value={fmt(summary.accountCreditBalance)} color="text-blue-700" />
      </div>

      {/* Details block */}
      <div className="border rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Contact Details</h3>
        <DetailRow label="Organisation" value={contact.organisation} />
        <DetailRow
          label="Person"
          value={[contact.firstName, contact.lastName].filter(Boolean).join(' ') || undefined}
        />
        <DetailRow label="Email" value={contact.email} />
        <DetailRow label="Billing Email" value={contact.billingEmail} />
        <DetailRow label="Telephone" value={contact.telephone} />
        <DetailRow label="Mobile" value={contact.mobile} />
        {addressParts.length > 0 && (
          <div className="flex gap-2 text-sm">
            <span className="w-40 text-gray-500 flex-shrink-0">Address</span>
            <span className="text-gray-800">{addressParts.join(', ')}</span>
          </div>
        )}
        <DetailRow label="Currency" value={contact.currencyCode} />
        <DetailRow label="Default Tax Treatment" value={contact.defaultTaxTreatment} />
        <DetailRow label="VAT Reg. Number" value={contact.vatRegNumber} />
        <DetailRow label="GSTIN" value={contact.gstin} />
        <DetailRow
          label="Payment Terms"
          value={
            contact.defaultPaymentTermDays != null
              ? `${contact.defaultPaymentTermDays} days`
              : undefined
          }
        />
        <DetailRow label="Status" value={contact.status} />
      </div>

      {/* vCard download */}
      <div>
        <button
          type="button"
          onClick={handleVCardDownload}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md text-gray-700"
        >
          <Download size={14} />
          Download vCard
        </button>
      </div>
    </div>
  );
}

// ── Tab: History-grouped document tabs ───────────────────────────────────────

type DocType = 'INVOICE' | 'RECURRING_INVOICE' | 'BILL' | 'ESTIMATE';

const DOC_TYPE_LABELS: Record<DocType, string> = {
  INVOICE: 'Invoice',
  RECURRING_INVOICE: 'Recurring Invoice',
  BILL: 'Bill',
  ESTIMATE: 'Estimate',
};

function DocumentsTab({
  contactId,
  token,
  filterType,
}: {
  contactId: string;
  token: string;
  filterType: DocType;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { formatDate } = useDateFormatter();
  const { formatMoney } = useCurrencies();

  useEffect(() => {
    setLoading(true);
    api
      .get(`${CONTACTS_URL}/${contactId}/history`)
      .then((res) => {
        const raw = res.data?.data?.items;
        const all: HistoryItem[] = Array.isArray(raw) ? raw : [];
        setItems(all.filter((h) => h.type === filterType));
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [contactId, token, filterType]);

  if (loading) return <p className="text-gray-500 py-4">Loading…</p>;
  if (error) return <p className="text-destructive py-4">{error}</p>;

  const label = DOC_TYPE_LABELS[filterType];

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-gray-400 py-4">No {label.toLowerCase()}s found.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <th className="py-2 px-3">Date</th>
              <th className="py-2 px-3">Reference</th>
              <th className="py-2 px-3">Description</th>
              <th className="py-2 px-3 text-right">Amount</th>
              <th className="py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3">{formatDate(item.date)}</td>
                <td className="py-2 px-3">{item.reference || '—'}</td>
                <td className="py-2 px-3">{item.description || '—'}</td>
                <td className="py-2 px-3 text-right">
                  {item.amount != null ? formatMoney(item.amount, item.currencyCode) : '—'}
                </td>
                <td className="py-2 px-3">{item.status || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Tab: Statement of Account ─────────────────────────────────────────────────

function StatementTab({ contactId }: { contactId: string }) {
  const todayIso = isoDate(new Date());
  const ninetyDaysAgoIso = isoDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));

  const [from, setFrom] = useState(ninetyDaysAgoIso);
  const [to, setTo] = useState(todayIso);
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resolveCurrency } = useCurrencies();
  const { formatDate } = useDateFormatter();

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .get(`${CONTACTS_URL}/${contactId}/statement?from=${from}&to=${to}`)
      .then((res) => setData(res.data?.data ?? null))
      .catch(() => setError('Failed to load statement'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const moneyIn = (code: string) => {
    const sym = resolveCurrency(code).symbol;
    return (n: number) => `${sym}${n.toFixed(2)}`;
  };

  return (
    <div className="space-y-4">
      {/* Date range controls */}
      <div className="flex items-end gap-4">
        <DateInput
          value={ymdStringToDate(from)}
          onChange={(d) => setFrom(d ? dateToYmdString(d) : '')}
          label="From"
        />
        <DateInput
          value={ymdStringToDate(to)}
          onChange={(d) => setTo(d ? dateToYmdString(d) : '')}
          label="To"
        />
        <button
          type="button"
          onClick={load}
          className="px-3 py-1 text-sm bg-primary text-white rounded"
        >
          Reload
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-destructive">{error}</p>}

      {data && data.byCurrency.length === 0 && (
        <p className="text-gray-400">No transactions in this period.</p>
      )}

      {data &&
        data.byCurrency.map((section) => {
          const money = moneyIn(section.currencyCode);
          const sym = resolveCurrency(section.currencyCode);
          let running = section.openingBalance;
          return (
            <div key={section.currencyCode} className="mb-8">
              <h3 className="text-base font-semibold mb-2">
                Statement in {sym.code} ({sym.symbol})
              </h3>
              {section.lines.length === 0 && (
                <p className="text-gray-400 text-sm">No transactions in this currency for the period.</p>
              )}
              {section.lines.length > 0 && (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b text-left bg-gray-50">
                      <th className="py-2 px-2">Date</th>
                      <th className="py-2 px-2">Reference</th>
                      <th className="py-2 px-2">Description</th>
                      <th className="py-2 px-2 text-right">Debit</th>
                      <th className="py-2 px-2 text-right">Credit</th>
                      <th className="py-2 px-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b font-medium bg-gray-50">
                      <td className="py-2 px-2" colSpan={5}>
                        Opening Balance
                      </td>
                      <td className="py-2 px-2 text-right">{money(section.openingBalance)}</td>
                    </tr>
                    {section.lines.map((line, idx) => {
                      running = running + line.debit - line.credit;
                      return (
                        <tr key={idx} className="border-b">
                          <td className="py-2 px-2">{formatDate(line.date)}</td>
                          <td className="py-2 px-2">{line.reference}</td>
                          <td className="py-2 px-2">{line.description}</td>
                          <td className="py-2 px-2 text-right">
                            {line.debit > 0 ? money(line.debit) : '—'}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {line.credit > 0 ? money(line.credit) : '—'}
                          </td>
                          <td className="py-2 px-2 text-right">{money(running)}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 font-medium bg-gray-50">
                      <td className="py-2 px-2" colSpan={3}>
                        Totals
                      </td>
                      <td className="py-2 px-2 text-right">{money(section.totals.debit)}</td>
                      <td className="py-2 px-2 text-right">{money(section.totals.credit)}</td>
                      <td className="py-2 px-2 text-right">{money(section.closingBalance)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ── Tab: Account History ──────────────────────────────────────────────────────

function AccountHistoryTab({ contactId, token }: { contactId: string; token: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { formatDate } = useDateFormatter();
  const { formatMoney } = useCurrencies();

  useEffect(() => {
    api
      .get(`${CONTACTS_URL}/${contactId}/history`)
      .then((res) =>
        setItems(Array.isArray(res.data?.data?.items) ? res.data.data.items : [])
      )
      .catch(() => setError('Failed to load history'))
      .finally(() => setLoading(false));
  }, [contactId, token]);

  if (loading) return <p className="text-gray-500 py-4">Loading…</p>;
  if (error) return <p className="text-destructive py-4">{error}</p>;
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) return <p className="text-gray-400 py-4">No history found.</p>;

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b text-left bg-gray-50">
          <th className="py-2 px-3">Date</th>
          <th className="py-2 px-3">Type</th>
          <th className="py-2 px-3">Reference</th>
          <th className="py-2 px-3">Description</th>
          <th className="py-2 px-3 text-right">Amount</th>
          <th className="py-2 px-3">Status</th>
        </tr>
      </thead>
      <tbody>
        {safeItems.map((item) => (
          <tr key={item.id} className="border-b hover:bg-gray-50">
            <td className="py-2 px-3">{formatDate(item.date)}</td>
            <td className="py-2 px-3 capitalize">{(item.type ?? '').toLowerCase().replace(/_/g, ' ')}</td>
            <td className="py-2 px-3">{item.reference || '—'}</td>
            <td className="py-2 px-3">{item.description || '—'}</td>
            <td className="py-2 px-3 text-right">
              {item.amount != null ? formatMoney(item.amount, item.currencyCode) : '—'}
            </td>
            <td className="py-2 px-3">{item.status || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Tab: Notes ────────────────────────────────────────────────────────────────

function NotesTab({ contact }: { contact: Contact | null }) {
  if (!contact) return null;
  return (
    <div className="py-4">
      {contact.notes ? (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{contact.notes}</p>
      ) : (
        <p className="text-gray-400 text-sm">No notes.</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const ContactCard: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useSelector((state: RootState) => state.auth);

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [isGrantCreditOpen, setIsGrantCreditOpen] = useState(false);
  const [creditRefreshKey, setCreditRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get(`${CONTACTS_URL}/${id}`)
      .then((res) => setContact(res.data?.data ?? null))
      .catch(() => toast.error('Failed to load contact.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  if (!id) return null;

  if (loading) {
    return <p className="text-gray-500 p-6">Loading contact…</p>;
  }

  const displayName = contact?.displayName || contact?.organisation || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Unknown Contact';

  return (
    <div className="space-y-4">
      <PageHeader title={displayName}>
        <button
          type="button"
          onClick={() => setIsGrantCreditOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-700"
        >
          <Wallet size={14} />
          Grant Credit
        </button>
        <button
          type="button"
          onClick={() => navigate(`/admin/contacts/edit/${id}`)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-700"
        >
          <Pencil size={14} />
          Edit
        </button>
      </PageHeader>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        {activeTab === 'summary' && (
          <SummaryTab contactId={id} token={token ?? ''} refreshKey={creditRefreshKey} />
        )}
        {activeTab === 'invoices' && (
          <DocumentsTab contactId={id} token={token ?? ''} filterType="INVOICE" />
        )}
        {activeTab === 'recurring-invoices' && (
          <DocumentsTab contactId={id} token={token ?? ''} filterType="RECURRING_INVOICE" />
        )}
        {activeTab === 'bills' && (
          <DocumentsTab contactId={id} token={token ?? ''} filterType="BILL" />
        )}
        {activeTab === 'estimates' && (
          <DocumentsTab contactId={id} token={token ?? ''} filterType="ESTIMATE" />
        )}
        {activeTab === 'statement' && (
          <StatementTab contactId={id} />
        )}
        {activeTab === 'history' && (
          <AccountHistoryTab contactId={id} token={token ?? ''} />
        )}
        {activeTab === 'notes' && <NotesTab contact={contact} />}
      </div>

      <GrantCreditModal
        isOpen={isGrantCreditOpen}
        onClose={() => setIsGrantCreditOpen(false)}
        contactId={id}
        onSuccess={() => {
          setIsGrantCreditOpen(false);
          setCreditRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
};

export default ContactCard;
