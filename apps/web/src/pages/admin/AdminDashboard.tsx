import api from '@lib/apiClient';
import Constants from '@constants/api';
import useDateFormatter from '@hooks/useDateFormatter';
import type { RootState } from '@store/index';

import { Users, ShoppingCart, Truck, Receipt, ArrowRight, BarChart2, BadgeDollarSign, CreditCard, CheckCircle2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import Table from '@components/admin/Table';
import type { CustomersShape, PirchartShape, PurchaseStats, RecentInvoices, RecentPayments, RecentPurchase, SaleStats, SuppliersShape } from '@models/dashboard';
import TableRow from '@components/admin/TableRow';
import InvoiceStatusBadge from '@components/admin/InvoiceStatusBadge';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import PaymentModeBadge from '@components/admin/PaymentModeBadge';
import { useNavigate } from 'react-router-dom';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import ProfileCard from '@components/admin/ProfileImage';
import ApexGradientPie from '@components/admin/dashboard/ApexGradientPie';
import MultiLineAreaChart from '@components/admin/MultiLineAreaChart';
import { PageHeader } from '@/context/PageHeaderContext';
import DashboardSwitcher from '@components/admin/DashboardSwitcher';
import StatsCard from '@components/admin/StatsCard';
import { WORK_QUEUES } from '@lib/workQueues';
import { useWorkQueues } from '@hooks/useWorkQueues';
import { useAgentPanel } from '@context/AgentPanelContext';
import { themeColor } from "@lib/designTokens";
import { EmptyStateRow } from "@components/ui";

interface AgingBuckets {
    current: number;
    days30: number;
    days60: number;
    days90: number;
    beyond90: number;
}
interface TopDebtor {
    customerId: string;
    customerName: string;
    outstanding: number;
    oldestInvoiceDays: number;
}
interface DashboardData {
    totalInvoiceCount: number;
    totalProductCount: number;
    totalCustomerCount: number;
    totalSupplierCount: number;
    lastFiveCustomers: CustomersShape[];
    lastFiveSuppliers: SuppliersShape[];
    lastFiveInvoices: RecentInvoices[];
    lastFivePayments: RecentPayments[];
    lastFivePurchases: RecentPurchase[];
    sales: SaleStats;
    purchases: PurchaseStats;
    graph1: PirchartShape[];
    graph2: GraphItem[];
    agingBuckets?: AgingBuckets;
    topDebtors?: TopDebtor[];
}
interface DashboardDataResponse {
    data: DashboardData
}
interface GraphItem {
    month: string;
    purchases: number;
    sales: number;
}

const DashboardPage: React.FC = () => {

    const { token, activeTenant } = useSelector((state: RootState) => state.auth);
    const [time, setTime] = useState<Date>(new Date());
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { formatDate, timeFormat } = useDateFormatter();
    const { format } = useCurrencyFormatter();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    // Same module-level cache the sidebar badges read, so a tile and the badge
    // beside it can never show different numbers.
    const { counts: queueCounts } = useWorkQueues();
    const { isAvailable: isAgentAvailable, open: openAgent } = useAgentPanel();
    const [dashboardData, setDashboardData] = useState<DashboardData>({
        totalInvoiceCount: 0,
        totalProductCount: 0,
        totalCustomerCount: 0,
        totalSupplierCount: 0,
        lastFiveCustomers: [],
        lastFiveSuppliers: [],
        lastFiveInvoices: [],
        lastFivePayments: [],
        lastFivePurchases: [],
        sales: {
            totalSalesAmount: 0,
            totalDueAmount: 0,
            receivedAmount: 0,
            quotationCount: 0
        },
        purchases: {
            totalPurchasesAmount: 0,
            totalPaidPurchases: 0,
            totalDuePurchases: 0,
            debitNoteCount: 0
        },
        graph1: [],
        graph2: []
    });
    let pieChartData: any = [];
    if (dashboardData.graph1.length > 0) {
        pieChartData = dashboardData.graph1.map((item) => ({
            id: item.name,
            value: item.totalQty,
            label: item.name
                .split(" ")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(" "),
        }));
    }

    const purchaseAndSaleChartData: any = [];
    if (dashboardData.graph2.length > 0) {
        //2 data set purchase and sale
        purchaseAndSaleChartData[0] = dashboardData.graph2.map((item) => item.purchases);
        purchaseAndSaleChartData[1] = dashboardData.graph2.map((item) => item.sales);
    }
    useEffect(() => {
        // Set up an interval to update the time every minute
        const timer = setInterval(() => setTime(new Date()), 60000);

        // Cleanup function to clear the interval when the component unmounts
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const getGreeting = (): string => {
        const hour = new Date().getHours();

        if (hour < 12) return "Good Morning";
        if (hour < 18) return "Good Afternoon";
        return "Good Evening";
    };
    // Only queues with something in them. A grid of zeroes is a grid nobody
    // needs to read, which teaches people to stop reading it on the days it
    // does have something.
    const activeQueues = WORK_QUEUES.filter((queue) => (queueCounts?.[queue.key] ?? 0) > 0);
    const pendingTotal = activeQueues.reduce(
        (total, queue) => total + (queueCounts?.[queue.key] ?? 0),
        0,
    );
    // "3 invoices overdue, 2 bank lines to explain" — the tiles, read out. Built
    // from the same list so it can never name a queue the grid does not show.
    const digestSentence = activeQueues
        .map((queue) => `${queueCounts?.[queue.key]} ${queue.label.toLowerCase()}`)
        .join(', ')
        .concat('.');

    const fetchDashboardData = async () => {
        try {
            setIsLoading(true);
            const response = await api.get<DashboardDataResponse>(Constants.GET_DASHBOARD_DATA_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data) {
                setDashboardData(prev => ({ ...prev, ...response.data.data }));
            }
        } catch (error) {
            /* non-fatal: leave prior state in place */
        } finally {
            setIsLoading(false);
        }
    }

    const formattedTime: string = formatDate(time, timeFormat);

    if (isLoading) {
        return (
            <div className='p-4 md:p-6 bg-gray-50 min-h-full font-sans flex items-center justify-center'>
                <LoaderSpinner />
            </div>
        );
    }
    return (
        <div className="px-4 py-2 bg-gray-50 min-h-full font-sans border border-gray-200 rounded-md">
            <PageHeader title="Dashboard">
                <DashboardSwitcher />
            </PageHeader>

            {/* The state of the business, in one line. The illustrated banner
                this replaces said "Welcome back!" and nothing else — a hero's
                worth of screen carrying no information. */}
            <div className="mt-2">
                <h2 className="text-2xl font-bold text-foreground">
                    {getGreeting()}. Here&apos;s the state of the business.
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    {[
                        formatDate(time, systemSettings?.dateFormat.format || 'd-m-Y'),
                        formattedTime,
                        activeTenant?.name,
                        activeTenant?.roleName && `Signed in as ${activeTenant.roleName}`,
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
            </div>

            {/* Money first: what is owed to us, what we owe, and the two halves
                of sales. Amounts, not document counts — counts live in the
                queue tiles below, where each one comes with somewhere to go. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 w-full">
                <StatsCard
                    title="Receivables"
                    period="Outstanding"
                    value={format(dashboardData.sales.totalDueAmount || 0)}
                    icon={<BadgeDollarSign className="w-5 h-5" />}
                    accent="warning"
                    color=""
                />
                <StatsCard
                    title="Payables"
                    period="Outstanding"
                    value={format(dashboardData.purchases.totalDuePurchases || 0)}
                    icon={<CreditCard className="w-5 h-5" />}
                    accent="danger"
                    color=""
                />
                <StatsCard
                    title="Sales"
                    period="All time"
                    value={format(dashboardData.sales.totalSalesAmount || 0)}
                    icon={<BarChart2 className="w-5 h-5" />}
                    accent="primary"
                    color=""
                />
                <StatsCard
                    title="Collected"
                    period="All time"
                    value={format(dashboardData.sales.receivedAmount || 0)}
                    icon={<CheckCircle2 className="w-5 h-5" />}
                    accent="success"
                    color=""
                />
            </div>

            {/* Agent digest. Shown only when there is both an agent and
                something for it to talk about — a banner announcing an empty
                queue is noise on the one day the books are clean. */}
            {isAgentAvailable && pendingTotal > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent px-4 py-3 text-accent-foreground">
                    <p className="flex items-start gap-3 text-sm">
                        <span
                            aria-hidden="true"
                            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold"
                        >
                            A
                        </span>
                        <span>
                            Agent digest — {digestSentence} I can work through these with
                            your approval.
                        </span>
                    </p>
                    <button
                        type="button"
                        onClick={openAgent}
                        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
                    >
                        Ask the agent
                    </button>
                </div>
            )}

            {/* What is waiting for someone. */}
            {activeQueues.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 w-full">
                    {activeQueues.map((queue) => (
                        <button
                            key={queue.key}
                            type="button"
                            onClick={() => navigate(queue.to)}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary cursor-pointer"
                        >
                            <span>
                                <span className="block font-medium text-card-foreground">{queue.label}</span>
                                <span className="block text-sm text-muted-foreground">{queue.module}</span>
                            </span>
                            <span className="font-mono tabular-nums text-2xl font-bold text-destructive-strong">
                                {queueCounts?.[queue.key]}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Outstanding dues — Aging buckets + Top debtors (slice E.4) */}
            {dashboardData?.agingBuckets && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                        <h3 className="text-lg font-semibold text-gray-600 mb-3">Outstanding Dues by Age</h3>
                        <div className="space-y-2">
                            {(() => {
                                const buckets = dashboardData.agingBuckets!;
                                const rows = [
                                    { label: 'Current', value: buckets.current, color: 'bg-green-500' },
                                    { label: '1-30 days', value: buckets.days30, color: 'bg-amber-500' },
                                    { label: '31-60 days', value: buckets.days60, color: 'bg-orange-500' },
                                    { label: '61-90 days', value: buckets.days90, color: 'bg-red-400' },
                                    { label: '90+ days', value: buckets.beyond90, color: 'bg-red-600' },
                                ];
                                const total = rows.reduce((s, r) => s + r.value, 0);
                                return rows.map((b) => {
                                    const pct = total > 0 ? (b.value / total) * 100 : 0;
                                    return (
                                        <div key={b.label}>
                                            <div className="flex justify-between text-xs text-gray-700">
                                                <span>{b.label}</span>
                                                <span>{format(b.value)}</span>
                                            </div>
                                            <div className="h-2 bg-gray-100 rounded">
                                                <div className={`h-2 rounded ${b.color}`} style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                        <h3 className="text-lg font-semibold text-gray-600 mb-3">Top Debtors</h3>
                        {dashboardData.topDebtors && dashboardData.topDebtors.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left border-b text-gray-700">
                                            <th className="py-2">Customer</th>
                                            <th className="text-right">Outstanding</th>
                                            <th className="text-right">Oldest (days)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {dashboardData.topDebtors.map((d) => (
                                            <tr key={d.customerId} className="border-b">
                                                <td className="py-2 text-gray-800">{d.customerName}</td>
                                                <td className="text-right text-gray-700">{format(d.outstanding)}</td>
                                                <td className="text-right text-gray-700">{d.oldestInvoiceDays}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 py-4 text-center">No outstanding debtors</p>
                        )}
                    </div>
                </div>
            )}

            {/* Chart */}
            <div className="grid grid-cols-10 gap-4 mt-4">
                <div className="col-span-7 bg-white p-4 rounded-xl border border-gray-200">
                    <h2 className='text-lg font-semibold text-gray-600'>
                        Sales by Month
                    </h2>
                    <MultiLineAreaChart
                        data={purchaseAndSaleChartData}
                        seriesNames={["Purchase", "Sales"]}
                        categories={dashboardData.graph2.map((item) => item.month)}
                        color={[themeColor("primary"), themeColor("info")]}
                    />

                </div>
                <div className="col-span-3 bg-white p-4 rounded-xl border border-gray-200">
                    <div className="flex flex-col items-center">
                        <h2 className="text-lg font-semibold mb-2 text-gray-600">
                            Top 5 Products by Sales
                        </h2>
                        <ApexGradientPie
                            data={pieChartData.length ? pieChartData : [{ id: "No Data", label: "No Data", value: 1 }]}
                            height={300}
                            width={300}
                            colors={pieChartData.length ? [themeColor("primary"), themeColor("info"), themeColor("success"), themeColor("warning"), themeColor("indigo")] : [themeColor("border")]}
                        />
                    </div>
                </div>
            </div>
            {/* Customers & suppliers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {/* Customers */}
                <div className="customers bg-white p-4 rounded-xl border border-gray-200">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-gray-600 flex items-center gap-3">
                            <span className="p-2 rounded-full bg-accent border border-accent shadow-sm flex items-center justify-center transition-all duration-300 hover:shadow-md">
                                <Users className="w-4 h-4 text-primary" />
                            </span>
                            Recent Customers
                        </h4>
                        <button
                            onClick={() => navigate("/customers")}
                            className="text-sm text-primary hover:text-white hover:bg-primary px-3 py-1 rounded-md flex items-center gap-1 transition-all duration-300">
                            View all <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>


                    {/* Table */}
                    <Table headers={["#", "Name", "Phone", "Created On"]}>
                        {dashboardData.lastFiveCustomers && dashboardData.lastFiveCustomers.map((customer, index) => (
                            <TableRow
                                key={customer.id}
                                row={customer}
                                index={index + 1}
                                columns={[
                                    <ProfileCard
                                        imageUrl={customer.imageUrl}
                                        name={customer.name}
                                        email={customer.email}
                                    />,
                                    customer.phone,
                                    formatDate(customer.createdAt, systemSettings?.dateFormat.format || 'd-m-Y'),
                                ]}
                            />
                        ))}
                        {!dashboardData.lastFiveCustomers.length && (
                            <EmptyStateRow colSpan={6} art="people-search" title="No customers found" />
                        )}
                    </Table>
                </div>

                {/* Suppliers */}
                <div className="suppliers bg-white p-4 rounded-xl border border-gray-200">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-gray-600 flex items-center gap-3">
                            <span className="p-2 rounded-full bg-green-100 border border-green-200 shadow-sm flex items-center justify-center transition-all duration-300 hover:shadow-md">
                                <Truck className="w-4 h-4 text-green-600" />
                            </span>
                            Recent Suppliers
                        </h4>
                        <button
                            onClick={() => navigate("/suppliers")}
                            className="text-sm text-green-600 hover:text-white hover:bg-green-600 px-3 py-1 rounded-md flex items-center gap-1 transition-all duration-300">
                            View all <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>


                    {/* Table */}
                    <Table headers={["#", "Name", "Phone", "Created On"]}>
                        {dashboardData.lastFiveSuppliers && dashboardData.lastFiveSuppliers.map((supplier, index) => (
                            <TableRow
                                key={supplier.id}
                                row={supplier}
                                index={index + 1}
                                columns={[
                                    <ProfileCard
                                        imageUrl={supplier.profileImageUrl}
                                        name={supplier.name}
                                        email={supplier.email}
                                    />,
                                    supplier.phone,
                                    formatDate(supplier.createdAt, systemSettings?.dateFormat.format || 'd-m-Y'),
                                ]}
                            />
                        ))}
                        {!dashboardData.lastFiveSuppliers.length && (
                            <EmptyStateRow colSpan={6} art="people-search" title="No suppliers found" />
                        )}
                    </Table>
                </div>
            </div>
            <div className="invoices bg-white rounded-xl bg-white p-4 rounded-xl border border-gray-200 mt-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-semibold text-gray-600 flex items-center gap-3">
                        <span className="p-2 rounded-full bg-blue-100 border border-blue-200 shadow-sm flex items-center justify-center transition-all duration-300 hover:shadow-md">
                            <Receipt className="w-4 h-4 text-blue-600" />
                        </span>
                        Recent Invoices
                    </h4>
                    <button
                        onClick={() => navigate("/invoices")}
                        className="text-sm text-blue-600 hover:text-white hover:bg-blue-600 px-3 py-1 rounded-md flex items-center gap-1 transition-all duration-300">
                        View all <ArrowRight className="w-4 h-4" />
                    </button>
                </div>


                {/* Table */}
                <Table headers={["#", "Invoice No", "Customer", "Amount", "Status", "Created On",]}>
                    {dashboardData.lastFiveInvoices &&
                        dashboardData.lastFiveInvoices.map((invoice, index) => (
                            <TableRow
                                key={invoice.id}
                                index={index + 1}
                                row={invoice}
                                columns={[
                                    invoice.invoiceNumber,
                                    <ProfileCard
                                        imageUrl={invoice.customer?.imageUrl}
                                        name={invoice.customer?.name ?? "—"}
                                        email={invoice.customer?.email ?? ""}
                                    />,
                                    format(invoice.totalAmount),
                                    <InvoiceStatusBadge status={invoice.status} />,
                                    formatDate(
                                        invoice.createdAt,
                                        systemSettings?.dateFormat.format || "d-m-Y"
                                    ),
                                ]}
                            />
                        ))}

                    {/* Empty State */}
                    {!dashboardData.lastFiveInvoices?.length && (
                        <EmptyStateRow colSpan={6} art="invoice" title="No invoices found" />
                    )}
                </Table>
            </div>
            {/* Recent Transactions & Recent Purchases */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="recent-transactions bg-white p-4 rounded-xl border border-gray-200">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-gray-600 flex items-center gap-3">
                            <span className="p-2 rounded-full bg-accent border border-accent shadow-sm flex items-center justify-center transition-all duration-300 hover:shadow-md">
                                <Receipt className="w-4 h-4 text-primary" />
                            </span>
                            Recent Invoice Payments
                        </h4>
                    </div>


                    {/* Table */}
                    <Table headers={["#", "Invoice No", "Amount", "Payment Method"]}>
                        {dashboardData.lastFivePayments && dashboardData.lastFivePayments.map((payment, index) => (
                            <TableRow
                                key={payment.id}
                                row={payment}
                                index={index + 1}
                                columns={[
                                    payment.invoice.invoiceNumber,
                                    format(payment.invoice.totalAmount),
                                    <PaymentModeBadge mode={payment.payment_method.name} />
                                ]}
                            />
                        ))}
                        {!dashboardData.lastFivePayments.length && (
                            <EmptyStateRow colSpan={6} art="cash-payment" title="No payments found" />
                        )}
                    </Table>
                </div>

                {/* Purchases */}
                <div className="purchases bg-white p-4 rounded-xl border border-gray-200 ">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-gray-600 flex items-center gap-3">
                            <span className="p-2 rounded-full bg-green-100 border border-green-300 flex items-center justify-center transition-all duration-300 hover:shadow-md">
                                <ShoppingCart className="w-4 h-4 text-green-600" />
                            </span>
                            Recent Purchases
                        </h4>
                        <button
                            onClick={() => navigate("/purchases")}
                            className="text-sm text-green-600 hover:text-white hover:bg-green-600 px-3 py-1 rounded-md flex items-center gap-1 transition-all duration-300">
                            View all <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>


                    {/* Table */}
                    <Table headers={["#", "Purchase No", "Supplier", "Amount"]}>
                        {dashboardData.lastFivePurchases && dashboardData.lastFivePurchases.map((purchase, index) => (
                            <TableRow
                                key={purchase.id}
                                row={purchase}
                                index={index + 1}
                                columns={[
                                    purchase.purchaseId,
                                    <ProfileCard
                                        imageUrl={purchase.vendor?.profileImage ?? ""}
                                        name={purchase.vendor?.name ?? ""}
                                        email={purchase.vendor?.email ?? ""}
                                    />,
                                    format(purchase.totalAmount)
                                ]}
                            />
                        ))}
                        {!dashboardData.lastFivePurchases.length && (
                            <EmptyStateRow colSpan={6} art="invoice" title="No purchases found" />
                        )}
                    </Table>
                </div>
            </div>
        </div>
    );
};

export default DashboardPage;
