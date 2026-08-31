import Constants from '@constants/api';
import useDateFormatter from '@hooks/useDateFormatter';
import type { RootState } from '@store/index';
import axios from 'axios';
import { TrendingUp, TrendingDown, Scale, Landmark, ArrowRight, Wallet, Receipt, PiggyBank, CalendarClock, Repeat } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { CardItem } from '@components/admin/dashboard/CardItem';
import { DashboardCard } from '@components/admin/dashboard/DashboardCard';
import Table from '@components/admin/Table';
import TableRow from '@components/admin/TableRow';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import MultiLineAreaChart from '@components/admin/MultiLineAreaChart';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import { PageHeader } from '@/context/PageHeaderContext';
import DashboardSwitcher from '@components/admin/DashboardSwitcher';
import { themeColor } from "@lib/designTokens";

interface MonthPoint { key: string; label: string; sales: number; expenses: number; }
interface PlanItem { id: string; label: string; amount: number; date: string | null; frequency?: string | null; }
interface Planning {
    monthlySeries: MonthPoint[];
    nextMonth: {
        label: string;
        expectedIncome: { recurringInvoices: number; dueInvoices: number; total: number };
        expectedExpenses: { recurringExpenses: number; total: number };
        projectedNet: number;
    };
    upcomingRecurringInvoices: PlanItem[];
    upcomingDueInvoices: PlanItem[];
    upcomingRecurringExpenses: PlanItem[];
}
interface ProfitLoss {
    revenue: { total: number };
    operatingExpenses: { total: number };
    netIncome: number;
    taxes: { netTax: number };
}
interface BalanceSheet {
    assets: { current: { cashAndBank: number; receivables: number }; total: number };
    liabilities: { current: { payables: number }; total: number };
    equity: { total: number };
}

const n = (v: unknown) => Number(v ?? 0);

const AccountsDashboard: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { format } = useCurrencyFormatter();
    const { formatDate } = useDateFormatter();
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [plan, setPlan] = useState<Planning | null>(null);
    const [pl, setPl] = useState<ProfitLoss | null>(null);
    const [bs, setBs] = useState<BalanceSheet | null>(null);
    const dateFmt = systemSettings?.dateFormat.format || 'd-m-Y';

    useEffect(() => {
        (async () => {
            try {
                setIsLoading(true);
                const h = { headers: { Authorization: `Bearer ${token}` } };
                const [planRes, plRes, bsRes] = await Promise.all([
                    axios.get(Constants.GET_ACCOUNTS_PLANNING_URL, h),
                    axios.get(Constants.GET_PROFIT_LOSS_URL, h),
                    axios.get(Constants.GET_BALANCE_SHEET_URL, h),
                ]);
                setPlan(planRes.data?.data ?? null);
                setPl(plRes.data?.data ?? null);
                setBs(bsRes.data?.data ?? null);
            } catch { /* ignore */ } finally { setIsLoading(false); }
        })();
    }, [token]);

    if (isLoading) {
        return <div className='p-6 bg-gray-50 min-h-full flex items-center justify-center'><LoaderSpinner /></div>;
    }

    const series = plan?.monthlySeries || [];
    const areaData: number[][] = series.length > 0 ? [series.map(m => m.sales), series.map(m => m.expenses)] : [];
    const months = series.map(m => m.label);
    const nm = plan?.nextMonth;
    const net = n(nm?.projectedNet);

    return (
        <div className="px-4 py-3 bg-gray-50 min-h-full font-sans border border-gray-200 rounded-md space-y-4">
            <PageHeader title="Accounts & P&L">
                <DashboardSwitcher />
                <button onClick={() => navigate('/admin/accounting/reports/profit-loss')} className="bg-white border border-primary text-primary hover:bg-accent px-2 py-1 rounded-md shadow cursor-pointer flex items-center gap-2">Full P&L <ArrowRight size={14} /></button>
            </PageHeader>

            {/* Monthly Sales vs Expenses */}
            <div className="bg-white border border-border rounded-xl shadow-sm p-4">
                <h2 className="text-md font-semibold text-gray-600 mb-2">Monthly Sales vs Expenses</h2>
                {areaData.length > 0
                    ? <MultiLineAreaChart data={areaData} categories={months} color={[themeColor("success"), themeColor("destructive")]} seriesNames={["Sales", "Expenses"]} />
                    : <p className="text-sm text-gray-400 py-8 text-center">No data</p>}
            </div>

            {/* Next month planning */}
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <CalendarClock className="w-5 h-5 text-primary" />
                    <h2 className="text-md font-semibold text-gray-600">Next Month Planning — {nm?.label || ''}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <DashboardCard title="Expected Income" icon={<TrendingUp className="w-6 h-6" />}>
                        <CardItem icon={<Repeat className="w-5 h-5" />} label="Recurring Invoices" value={format(n(nm?.expectedIncome.recurringInvoices))} color="green" />
                        <CardItem icon={<Receipt className="w-5 h-5" />} label="Invoices Due" value={format(n(nm?.expectedIncome.dueInvoices))} color="blue" />
                        <CardItem icon={<TrendingUp className="w-5 h-5" />} label="Total Expected" value={format(n(nm?.expectedIncome.total))} color="purple" />
                    </DashboardCard>
                    <DashboardCard title="Expected Expenses" icon={<TrendingDown className="w-6 h-6" />}>
                        <CardItem icon={<Repeat className="w-5 h-5" />} label="Recurring Expenses" value={format(n(nm?.expectedExpenses.recurringExpenses))} color="red" />
                        <CardItem icon={<TrendingDown className="w-5 h-5" />} label="Total Expected" value={format(n(nm?.expectedExpenses.total))} color="yellow" />
                    </DashboardCard>
                    <DashboardCard title="Projected Net" icon={net >= 0 ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}>
                        <CardItem icon={net >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />} label={net >= 0 ? 'Projected Surplus' : 'Projected Shortfall'} value={format(net)} color={net >= 0 ? 'green' : 'red'} />
                        <CardItem icon={<Wallet className="w-5 h-5" />} label="Cash & Bank Now" value={format(n(bs?.assets.current.cashAndBank))} color="blue" />
                    </DashboardCard>
                </div>
            </div>

            {/* Upcoming next-month items */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-white border border-border rounded-xl shadow-sm p-4">
                    <h2 className="text-md font-semibold text-gray-600 mb-3">Recurring Invoices (next month)</h2>
                    <Table headers={["#", "Invoice", "Amount", "Date"]}>
                        {plan?.upcomingRecurringInvoices?.length ? plan.upcomingRecurringInvoices.map((it, i) => (
                            <TableRow key={it.id} index={i + 1} row={it} columns={[it.label, format(n(it.amount)), it.date ? formatDate(it.date, dateFmt) : '-']} />
                        )) : <tr><td colSpan={4} className="text-center py-4 text-gray-400">None scheduled</td></tr>}
                    </Table>
                </div>
                <div className="bg-white border border-border rounded-xl shadow-sm p-4">
                    <h2 className="text-md font-semibold text-gray-600 mb-3">Invoices Due (next month)</h2>
                    <Table headers={["#", "Invoice", "Amount", "Due"]}>
                        {plan?.upcomingDueInvoices?.length ? plan.upcomingDueInvoices.map((it, i) => (
                            <TableRow key={it.id} index={i + 1} row={it} columns={[it.label, format(n(it.amount)), it.date ? formatDate(it.date, dateFmt) : '-']} />
                        )) : <tr><td colSpan={4} className="text-center py-4 text-gray-400">None due</td></tr>}
                    </Table>
                </div>
                <div className="bg-white border border-border rounded-xl shadow-sm p-4">
                    <h2 className="text-md font-semibold text-gray-600 mb-3">Recurring Expenses (next month)</h2>
                    <Table headers={["#", "Expense", "Amount", "Date"]}>
                        {plan?.upcomingRecurringExpenses?.length ? plan.upcomingRecurringExpenses.map((it, i) => (
                            <TableRow key={it.id} index={i + 1} row={it} columns={[it.label, format(n(it.amount)), it.date ? formatDate(it.date, dateFmt) : '-']} />
                        )) : <tr><td colSpan={4} className="text-center py-4 text-gray-400">None scheduled</td></tr>}
                    </Table>
                </div>
            </div>

            {/* Secondary: P&L + balance sheet summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <DashboardCard title="P&L (to date)" icon={<Scale className="w-6 h-6" />}>
                    <CardItem icon={<TrendingUp className="w-5 h-5" />} label="Revenue" value={format(n(pl?.revenue.total))} color="green" />
                    <CardItem icon={<TrendingDown className="w-5 h-5" />} label="Operating Exp." value={format(n(pl?.operatingExpenses.total))} color="red" />
                    <CardItem icon={<Scale className="w-5 h-5" />} label="Net Income" value={format(n(pl?.netIncome))} color={n(pl?.netIncome) >= 0 ? 'green' : 'red'} />
                    <CardItem icon={<Receipt className="w-5 h-5" />} label="Net Tax" value={format(n(pl?.taxes.netTax))} color="purple" />
                </DashboardCard>
                <DashboardCard title="Balance Sheet" icon={<Landmark className="w-6 h-6" />}>
                    <CardItem icon={<Wallet className="w-5 h-5" />} label="Total Assets" value={format(n(bs?.assets.total))} color="green" />
                    <CardItem icon={<Landmark className="w-5 h-5" />} label="Liabilities" value={format(n(bs?.liabilities.total))} color="red" />
                    <CardItem icon={<PiggyBank className="w-5 h-5" />} label="Equity" value={format(n(bs?.equity.total))} color="purple" />
                    <CardItem icon={<TrendingUp className="w-5 h-5" />} label="Receivables" value={format(n(bs?.assets.current.receivables))} color="blue" />
                </DashboardCard>
                <DashboardCard title="Quick Links" icon={<ArrowRight className="w-6 h-6" />}>
                    <CardItem icon={<Wallet className="w-5 h-5" />} label="Payables" value={format(n(bs?.liabilities.current.payables))} color="red" />
                    <CardItem icon={<Receipt className="w-5 h-5" />} label="Cash & Bank" value={format(n(bs?.assets.current.cashAndBank))} color="green" />
                </DashboardCard>
            </div>
        </div>
    );
};

export default AccountsDashboard;
