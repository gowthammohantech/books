import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import useDateFormatter from '@hooks/useDateFormatter';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import { PageHeader } from '@/context/PageHeaderContext';

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserOption { id: string; name: string; }
interface TaxYearOption { label: string; value: string; }

interface SalaryEntry { date: string; description: string; paid: number; }
interface RunEntry { date: string; description: string; owed: number; paid: number; }
interface DividendEntry { date: string; description: string; paid: number; }
interface DLEntry { date: string; description: string; in: number; out: number; }
interface SCEntry { date: string; description: string; in: number; }
interface ExpenseEntry { date: string; description: string; owed: number; reimbursed: number; }

interface MyMoneyData {
  user: { id: string; name: string };
  taxYear: { label: string; start: string; end: string };
  salary: {
    entries: SalaryEntry[];
    directPaid: number;
    owed: number;
    paid: number;
    outstanding: number;
    totalPaid: number;
    runEntries: RunEntry[];
  };
  dividends: { entries: DividendEntry[]; totalPaid: number };
  directorLoan: { entries: DLEntry[]; broughtForward: number; balance: number };
  shareCapital: { entries: SCEntry[]; totalIn: number };
  expensesOwed: { entries: ExpenseEntry[]; owed: number; reimbursed: number; outstanding: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Generate tax year options. UK tax year runs 6 Apr – 5 Apr.
 *  Label format: "2026/27" means 6 Apr 2026 – 5 Apr 2027. */
function generateTaxYears(count = 5): TaxYearOption[] {
  const today = new Date();
  // Current UK tax year start: if today >= Apr 6, it's this calendar year; else previous
  const currentTaxYearStart =
    today >= new Date(today.getFullYear(), 3, 6) // month 3 = April (0-indexed)
      ? today.getFullYear()
      : today.getFullYear() - 1;

  const years: TaxYearOption[] = [];
  for (let i = 0; i < count; i++) {
    const startYear = currentTaxYearStart - i;
    const endYear = startYear + 1;
    const label = `${startYear}/${String(endYear).slice(2)}`;
    years.push({ label, value: label });
  }
  return years;
}

const TAX_YEARS = generateTaxYears(5);

// ── Sub-components ─────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  summary: React.ReactNode;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, summary }) => (
  <div className="flex items-center justify-between mb-2">
    <h2 className="text-lg font-semibold text-gray-700">{title}</h2>
    <div className="text-sm text-gray-500">{summary}</div>
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────────

const MyMoney: React.FC = () => {
  const { token, user: authUser } = useSelector((s: RootState) => s.auth);
  const { format } = useCurrencyFormatter(true);
  const { formatDate } = useDateFormatter();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedTaxYear, setSelectedTaxYear] = useState<string>(TAX_YEARS[0].value);
  const [data, setData] = useState<MyMoneyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'salary' | 'dividends' | 'directorLoan' | 'shareCapital' | 'expensesOwed'>('salary');

  // Load users on mount
  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${Constants.FETCH_USERS_URL}/1`, {
        params: { limit: 200, page: 1 },
        headers: { Authorization: `Bearer ${token}` },
      });
      const raw = (res.data?.data ?? []) as Array<{ id: string; firstName: string; lastName: string }>;
      const list = raw.map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() }));
      setUsers(list);
      // Default to current auth user if present in list, else first
      const defaultId = authUser?.id && list.find((u) => u.id === authUser.id)
        ? authUser.id
        : list[0]?.id ?? '';
      setSelectedUserId(defaultId);
    } catch {
      // ignore
    }
  }, [token, authUser?.id]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Fetch data when user or tax year changes
  const fetchData = useCallback(async () => {
    if (!token || !selectedUserId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(
        `${Constants.GET_MY_MONEY_URL}/${selectedUserId}`,
        {
          params: { taxYear: selectedTaxYear },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.data?.success) {
        setData(res.data.data as MyMoneyData);
      } else {
        setError(res.data?.message ?? 'Failed to load data');
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? (err.response?.data?.message ?? err.message) : 'Failed to load data';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [token, selectedUserId, selectedTaxYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—';
    return formatDate(new Date(d));
  };

  const tabs = [
    { key: 'salary' as const, label: 'Salary' },
    { key: 'dividends' as const, label: 'Dividends' },
    { key: 'directorLoan' as const, label: 'Director Loan' },
    { key: 'shareCapital' as const, label: 'Share Capital' },
    { key: 'expensesOwed' as const, label: 'Expenses Owed' },
  ];

  const tabBase = 'px-4 py-2 text-sm font-medium border-b-2 transition-colors duration-150 cursor-pointer';
  const tabActive = 'border-purple-600 text-purple-600';
  const tabInactive = 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';

  const theadClass = 'bg-gray-100 text-xs uppercase text-body';
  const thClass = 'px-4 py-3 text-left border-b border-border';
  const thRClass = 'px-4 py-3 text-right border-b border-border';
  const tdClass = 'px-4 py-3 text-sm text-gray-700 whitespace-nowrap';
  const tdRClass = 'px-4 py-3 text-sm text-gray-700 text-right whitespace-nowrap';
  const trClass = 'border-b border-border hover:bg-gray-50';

  return (
    <div className="space-y-6">
      <PageHeader title="My Money" />

      {/* Scope summary (descriptive, follows the selected person + tax year) */}
      {data && (
        <div className="flex items-center justify-end">
          <span className="text-sm text-gray-500">
            {data.user.name} &bull; Tax year {data.taxYear.label} ({fmtDate(data.taxYear.start)} – {fmtDate(data.taxYear.end)})
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Person</label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-600 bg-white min-w-[180px]"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.id}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Tax Year</label>
          <select
            value={selectedTaxYear}
            onChange={(e) => setSelectedTaxYear(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-600 bg-white"
          >
            {TAX_YEARS.map((ty) => (
              <option key={ty.value} value={ty.value}>{ty.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading / error */}
      {loading && <div className="flex justify-center py-12"><LoaderSpinner /></div>}
      {!loading && error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <div className="bg-white rounded-card shadow-card border border-border">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`${tabBase} ${activeTab === t.key ? tabActive : tabInactive}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* Salary */}
            {activeTab === 'salary' && (
              <>
                <SectionHeader
                  title="Salary"
                  summary={
                    <span className="flex gap-4">
                      <span>Owed: <strong className="text-gray-700">{format(data.salary.owed)}</strong></span>
                      <span>Paid: <strong className="text-gray-700">{format(data.salary.paid)}</strong></span>
                      <span>Outstanding: <strong className={data.salary.outstanding > 0 ? 'text-warning' : 'text-success'}>{format(data.salary.outstanding)}</strong></span>
                    </span>
                  }
                />

                {/* Payroll run entries */}
                <h3 className="text-sm font-semibold text-gray-600 mt-2 mb-1">Payroll runs</h3>
                <div className="overflow-x-auto border border-border rounded-control">
                  <table className="w-full border-collapse">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Date</th>
                        <th className={thClass}>Description</th>
                        <th className={thRClass}>Owed</th>
                        <th className={thRClass}>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.salary.runEntries.length === 0
                        ? <NoRecords colSpan={4} message={`No payroll runs for ${data.taxYear.label}`} />
                        : data.salary.runEntries.map((e, i) => (
                          <tr key={i} className={trClass}>
                            <td className={tdClass}>{fmtDate(e.date)}</td>
                            <td className={tdClass}>{e.description || '—'}</td>
                            <td className={tdRClass}>{e.owed > 0 ? format(e.owed) : '—'}</td>
                            <td className={tdRClass}>{e.paid > 0 ? format(e.paid) : '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                    {data.salary.runEntries.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50 border-t border-border">
                          <td className={`${tdClass} font-semibold`} colSpan={2}>Totals</td>
                          <td className={`${tdRClass} font-semibold`}>{format(data.salary.owed)}</td>
                          <td className={`${tdRClass} font-semibold`}>{format(data.salary.paid)}</td>
                        </tr>
                        <tr className="bg-gray-50">
                          <td className={`${tdClass} font-semibold`} colSpan={2}>Outstanding</td>
                          <td colSpan={2} className={`${tdRClass} font-semibold ${data.salary.outstanding > 0 ? 'text-warning' : 'text-success'}`}>
                            {format(data.salary.outstanding)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Direct salary payments (legacy) */}
                <h3 className="text-sm font-semibold text-gray-600 mt-6 mb-1">Direct salary payments</h3>
                <div className="overflow-x-auto border border-border rounded-control">
                  <table className="w-full border-collapse">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Date</th>
                        <th className={thClass}>Description</th>
                        <th className={thRClass}>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.salary.entries.length === 0
                        ? <NoRecords colSpan={3} message={`No direct salary payments for ${data.taxYear.label}`} />
                        : data.salary.entries.map((e, i) => (
                          <tr key={i} className={trClass}>
                            <td className={tdClass}>{fmtDate(e.date)}</td>
                            <td className={tdClass}>{e.description || '—'}</td>
                            <td className={tdRClass}>{format(e.paid)}</td>
                          </tr>
                        ))}
                    </tbody>
                    {data.salary.entries.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50">
                          <td className={`${tdClass} font-semibold`} colSpan={2}>Total</td>
                          <td className={`${tdRClass} font-semibold`}>{format(data.salary.directPaid)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}

            {/* Dividends */}
            {activeTab === 'dividends' && (
              <>
                <SectionHeader
                  title="Dividends"
                  summary={<>Total paid: <strong className="text-gray-700">{format(data.dividends.totalPaid)}</strong></>}
                />
                <div className="overflow-x-auto border border-border rounded-control">
                  <table className="w-full border-collapse">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Date</th>
                        <th className={thClass}>Description</th>
                        <th className={thRClass}>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dividends.entries.length === 0
                        ? <NoRecords colSpan={3} message={`No dividends recorded for ${data.taxYear.label}`} />
                        : data.dividends.entries.map((e, i) => (
                          <tr key={i} className={trClass}>
                            <td className={tdClass}>{fmtDate(e.date)}</td>
                            <td className={tdClass}>{e.description || '—'}</td>
                            <td className={tdRClass}>{format(e.paid)}</td>
                          </tr>
                        ))}
                    </tbody>
                    {data.dividends.entries.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50">
                          <td className={`${tdClass} font-semibold`} colSpan={2}>Total</td>
                          <td className={`${tdRClass} font-semibold`}>{format(data.dividends.totalPaid)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}

            {/* Director Loan */}
            {activeTab === 'directorLoan' && (
              <>
                <SectionHeader
                  title="Director Loan"
                  summary={
                    <span className="flex gap-4">
                      <span>Brought forward: <strong className="text-gray-700">{format(data.directorLoan.broughtForward)}</strong></span>
                      <span>Balance: <strong className={data.directorLoan.balance >= 0 ? 'text-success' : 'text-danger'}>{format(data.directorLoan.balance)}</strong></span>
                    </span>
                  }
                />
                <div className="overflow-x-auto border border-border rounded-control">
                  <table className="w-full border-collapse">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Date</th>
                        <th className={thClass}>Description</th>
                        <th className={thRClass}>In (received)</th>
                        <th className={thRClass}>Out (repaid)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.directorLoan.entries.length === 0
                        ? <NoRecords colSpan={4} message={`No director loan transactions for ${data.taxYear.label}`} />
                        : data.directorLoan.entries.map((e, i) => (
                          <tr key={i} className={trClass}>
                            <td className={tdClass}>{fmtDate(e.date)}</td>
                            <td className={tdClass}>{e.description || '—'}</td>
                            <td className={tdRClass}>{e.in > 0 ? format(e.in) : '—'}</td>
                            <td className={tdRClass}>{e.out > 0 ? format(e.out) : '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                    {data.directorLoan.entries.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50">
                          <td className={`${tdClass} font-semibold`} colSpan={2}>Closing balance</td>
                          <td colSpan={2} className={`${tdRClass} font-semibold ${data.directorLoan.balance >= 0 ? 'text-success' : 'text-danger'}`}>
                            {format(data.directorLoan.balance)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}

            {/* Share Capital */}
            {activeTab === 'shareCapital' && (
              <>
                <SectionHeader
                  title="Share Capital"
                  summary={<>Total introduced: <strong className="text-gray-700">{format(data.shareCapital.totalIn)}</strong></>}
                />
                <div className="overflow-x-auto border border-border rounded-control">
                  <table className="w-full border-collapse">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Date</th>
                        <th className={thClass}>Description</th>
                        <th className={thRClass}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.shareCapital.entries.length === 0
                        ? <NoRecords colSpan={3} message={`No share capital entries for ${data.taxYear.label}`} />
                        : data.shareCapital.entries.map((e, i) => (
                          <tr key={i} className={trClass}>
                            <td className={tdClass}>{fmtDate(e.date)}</td>
                            <td className={tdClass}>{e.description || '—'}</td>
                            <td className={tdRClass}>{format(e.in)}</td>
                          </tr>
                        ))}
                    </tbody>
                    {data.shareCapital.entries.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50">
                          <td className={`${tdClass} font-semibold`} colSpan={2}>Total</td>
                          <td className={`${tdRClass} font-semibold`}>{format(data.shareCapital.totalIn)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}

            {/* Expenses Owed */}
            {activeTab === 'expensesOwed' && (
              <>
                <SectionHeader
                  title="Expenses Owed"
                  summary={
                    <span className="flex gap-4">
                      <span>Owed: <strong className="text-gray-700">{format(data.expensesOwed.owed)}</strong></span>
                      <span>Reimbursed: <strong className="text-gray-700">{format(data.expensesOwed.reimbursed)}</strong></span>
                      <span>Outstanding: <strong className={data.expensesOwed.outstanding > 0 ? 'text-warning' : 'text-success'}>{format(data.expensesOwed.outstanding)}</strong></span>
                    </span>
                  }
                />
                <div className="overflow-x-auto border border-border rounded-control">
                  <table className="w-full border-collapse">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Date</th>
                        <th className={thClass}>Description</th>
                        <th className={thRClass}>Owed</th>
                        <th className={thRClass}>Reimbursed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.expensesOwed.entries.length === 0
                        ? <NoRecords colSpan={4} message={`No expense entries for ${data.taxYear.label}`} />
                        : data.expensesOwed.entries.map((e, i) => (
                          <tr key={i} className={trClass}>
                            <td className={tdClass}>{fmtDate(e.date)}</td>
                            <td className={tdClass}>{e.description || '—'}</td>
                            <td className={tdRClass}>{e.owed > 0 ? format(e.owed) : '—'}</td>
                            <td className={tdRClass}>{e.reimbursed > 0 ? format(e.reimbursed) : '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                    {data.expensesOwed.entries.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50">
                          <td className={`${tdClass} font-semibold`} colSpan={2}>Outstanding</td>
                          <td className={`${tdRClass} font-semibold`}>{format(data.expensesOwed.owed)}</td>
                          <td className={`${tdRClass} font-semibold ${data.expensesOwed.outstanding > 0 ? 'text-warning' : 'text-success'}`}>
                            {format(data.expensesOwed.reimbursed)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MyMoney;
