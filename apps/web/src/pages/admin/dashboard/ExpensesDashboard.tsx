import api from '@lib/apiClient';
import Constants from '@constants/api';
import useDateFormatter from '@hooks/useDateFormatter';
import type { RootState } from '@store/index';

import { TrendingDown, Receipt, Layers, FileText, ArrowRight, ShoppingCart, Wallet } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { CardItem } from '@components/admin/dashboard/CardItem';
import { DashboardCard } from '@components/admin/dashboard/DashboardCard';
import Table from '@components/admin/Table';
import TableRow from '@components/admin/TableRow';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import { PageHeader } from '@/context/PageHeaderContext';
import DashboardSwitcher from '@components/admin/DashboardSwitcher';

import { EmptyStateRow } from "@components/ui";

interface ByCategory { name: string; total: number; }
interface ProfitLoss {
    costOfGoodsSold: { total: number };
    operatingExpenses: { total: number; byCategory: ByCategory[] };
    taxes: { inputTax: number };
}
interface ExpenseRow {
    id: string;
    expenseId?: string;
    amount: number | string;
    currencyCode?: string | null;
    expenseDate: string | null;
    expenseCategory?: { id: string; name: string } | null;
    paymentMode?: { id: string; name: string } | null;
    paymentStatus?: string | null;
    description?: string | null;
}

const n = (v: unknown) => Number(v ?? 0);

const ExpensesDashboard: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { format } = useCurrencyFormatter();
    const { formatDate } = useDateFormatter();
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [pl, setPl] = useState<ProfitLoss | null>(null);
    const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const dateFmt = systemSettings?.dateFormat.format || 'd-m-Y';

    useEffect(() => {
        (async () => {
            try {
                setIsLoading(true);
                const [plRes, exRes] = await Promise.all([
                    api.get(Constants.GET_PROFIT_LOSS_URL),
                    api.get(Constants.FETCH_EXPENSES_FOR_LIST_URL, {
                        params: { page: 1, limit: 8 }
}),
                ]);
                setPl(plRes.data?.data ?? null);
                setExpenses(exRes.data?.data?.expenses ?? []);
                setTotalCount(exRes.data?.data?.pagination?.total ?? 0);
            } catch { /* ignore */ } finally { setIsLoading(false); }
        })();
    }, [token]);

    if (isLoading) {
        return <div className='p-6 bg-gray-50 min-h-full flex items-center justify-center'><LoaderSpinner /></div>;
    }

    const opex = n(pl?.operatingExpenses?.total);
    const cogs = n(pl?.costOfGoodsSold?.total);
    const totalExpenses = opex + cogs;
    const cats = (pl?.operatingExpenses?.byCategory || []).slice(0, 8);

    return (
        <div className="px-4 py-3 bg-gray-50 min-h-full font-sans border border-gray-200 rounded-md space-y-4">
            <PageHeader title="Expenses">
                <DashboardSwitcher />
                <button onClick={() => navigate('/expenses')} className="bg-white border border-primary text-primary hover:bg-accent px-2 py-1 rounded-md shadow cursor-pointer flex items-center gap-2">All Expenses <ArrowRight size={14} /></button>
            </PageHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <DashboardCard title="Expense Summary" icon={<TrendingDown className="w-6 h-6" />}>
                    <CardItem icon={<TrendingDown className="w-5 h-5" />} label="Total Expenses" value={format(totalExpenses)} color="red" />
                    <CardItem icon={<Wallet className="w-5 h-5" />} label="Operating Exp." value={format(opex)} color="yellow" />
                    <CardItem icon={<ShoppingCart className="w-5 h-5" />} label="COGS" value={format(cogs)} color="purple" />
                    <CardItem icon={<FileText className="w-5 h-5" />} label="Expense Records" value={totalCount} color="blue" />
                </DashboardCard>
                <DashboardCard title="Tax" icon={<Receipt className="w-6 h-6" />}>
                    <CardItem icon={<Receipt className="w-5 h-5" />} label="Input Tax (ITC)" value={format(n(pl?.taxes?.inputTax))} color="green" />
                    <CardItem icon={<Layers className="w-5 h-5" />} label="Categories" value={cats.length} color="indigo" />
                </DashboardCard>
                <DashboardCard title="Quick Links" icon={<Layers className="w-6 h-6" />}>
                    <CardItem icon={<FileText className="w-5 h-5" />} label="Expense Report" value="Open" color="purple" />
                    <CardItem icon={<Layers className="w-5 h-5" />} label="Categories" value="Manage" color="blue" />
                </DashboardCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white border border-border rounded-xl shadow-sm p-4">
                    <h2 className="text-md font-semibold text-gray-600 mb-3">Expenses by Category</h2>
                    <Table headers={["#", "Category", "Amount"]}>
                        {cats.length > 0 ? cats.map((c, i) => (
                            <TableRow key={c.name + i} index={i + 1} row={c} columns={[c.name, format(n(c.total))]} />
                        )) : <EmptyStateRow colSpan={3} art="cash-payment" title="No category data" />}
                    </Table>
                </div>
                <div className="bg-white border border-border rounded-xl shadow-sm p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-md font-semibold text-gray-600">Recent Expenses</h2>
                        <button onClick={() => navigate('/reports/expense')} className="text-sm text-primary font-semibold flex items-center gap-1 cursor-pointer">Report <ArrowRight size={14} /></button>
                    </div>
                    <Table headers={["#", "Category", "Amount", "Mode", "Date"]}>
                        {expenses.length > 0 ? expenses.map((e, i) => (
                            <TableRow key={e.id} index={i + 1} row={e} columns={[
                                e.expenseCategory?.name || e.description || '-',
                                format(n(e.amount)),
                                e.paymentMode?.name || '-',
                                e.expenseDate ? formatDate(e.expenseDate, dateFmt) : '-',
                            ]} />
                        )) : <EmptyStateRow colSpan={5} art="cash-payment" title="No expenses" />}
                    </Table>
                </div>
            </div>
        </div>
    );
};

export default ExpensesDashboard;
