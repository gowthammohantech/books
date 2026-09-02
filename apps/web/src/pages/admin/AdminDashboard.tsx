import api from '@lib/apiClient';
import Constants from '@constants/api';
import useDateFormatter from '@hooks/useDateFormatter';
import type { RootState } from '@store/index';

import {
    ArrowRight,
    BadgeDollarSign,
    BarChart2,
    CheckCircle2,
    CreditCard,
    Plus,
    Search,
} from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import Chart from 'react-apexcharts';
import { ChartFrame } from '../../components/ui';
import Table from '@components/admin/Table';
import type {
    PurchaseStats,
    RecentPurchase,
    SaleStats,
} from '@models/dashboard';
import TableRow from '@components/admin/TableRow';
import StatusBadge from '@components/admin/StatusBadge';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import { useNavigate } from 'react-router-dom';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import MultiLineAreaChart from '@components/admin/MultiLineAreaChart';
import { PageHeader } from '@/context/PageHeaderContext';
import StatsCard from '@components/admin/StatsCard';
import { WORK_QUEUES } from '@lib/workQueues';
import { useWorkQueues } from '@hooks/useWorkQueues';
import { useAgentPanel } from '@context/AgentPanelContext';
import { themeColor } from '@lib/designTokens';
import { EmptyState, EmptyStateRow } from '@components/ui';

interface GraphItem {
    month: string;
    purchases: number;
    sales: number;
}
interface DashboardData {
    totalInvoiceCount: number;
    lastFivePurchases: RecentPurchase[];
    sales: SaleStats;
    purchases: PurchaseStats;
    graph2: GraphItem[];
}
interface DashboardDataResponse {
    data: DashboardData;
}

/** One row of the audit trail, as the Recent Activity feed needs it. */
interface ActivityItem {
    id: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    entityType: string;
    entityLabel: string | null;
    summary: string;
    userName: string;
    createdAt: string;
}

/**
 * One account's spend against its budget. Numeric fields arrive as strings
 * (Prisma Decimal), so every read of them goes through Number().
 */
interface VarianceRow {
    accountId: string;
    accountName: string;
    budget: string;
    actual: string;
    variance: string;
    favorable: boolean;
}

const EMPTY_DASHBOARD: DashboardData = {
    totalInvoiceCount: 0,
    lastFivePurchases: [],
    sales: {
        totalSalesAmount: 0,
        totalDueAmount: 0,
        receivedAmount: 0,
        quotationCount: 0,
    },
    purchases: {
        totalPurchasesAmount: 0,
        totalPaidPurchases: 0,
        totalDuePurchases: 0,
        debitNoteCount: 0,
    },
    graph2: [],
};

/** The series the Business Analytics chart can draw, all derived from graph2. */
const ANALYTICS_SERIES = ['Revenue', 'Expenses', 'Profit'] as const;
type AnalyticsSeries = (typeof ANALYTICS_SERIES)[number];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** CREATE / UPDATE / DELETE, as the feed's leading dot. */
const ACTION_DOT: Record<ActivityItem['action'], string> = {
    CREATE: 'bg-success',
    UPDATE: 'bg-info',
    DELETE: 'bg-destructive',
};

/** "2 min ago" — precise enough for a feed, and needs no locale data. */
const relativeTime = (iso: string): string => {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.floor(hours / 24)} d ago`;
};

const DashboardPage: React.FC = () => {
    const { activeTenant } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings
    );
    const [time, setTime] = useState<Date>(new Date());
    const { formatDate, timeFormat } = useDateFormatter();
    const { format } = useCurrencyFormatter();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    // Same module-level cache the sidebar badges read, so a tile and the badge
    // beside it can never show different numbers.
    const { counts: queueCounts } = useWorkQueues();
    const { isAvailable: isAgentAvailable, open: openAgent } = useAgentPanel();

    const [dashboardData, setDashboardData] =
        useState<DashboardData>(EMPTY_DASHBOARD);
    const [activity, setActivity] = useState<ActivityItem[]>([]);
    const [variance, setVariance] = useState<VarianceRow[]>([]);
    const [series, setSeries] = useState<AnalyticsSeries>('Revenue');
    const [purchaseSearch, setPurchaseSearch] = useState('');

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

        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    // Only queues with something in them. A grid of zeroes is a grid nobody
    // needs to read, which teaches people to stop reading it on the days it
    // does have something.
    const activeQueues = WORK_QUEUES.filter(
        (queue) => (queueCounts?.[queue.key] ?? 0) > 0
    );
    const pendingTotal = activeQueues.reduce(
        (total, queue) => total + (queueCounts?.[queue.key] ?? 0),
        0
    );
    // "3 invoices overdue, 2 bank lines to explain" — the tiles, read out. Built
    // from the same list so it can never name a queue the grid does not show.
    const digestSentence = activeQueues
        .map((queue) => `${queueCounts?.[queue.key]} ${queue.label.toLowerCase()}`)
        .join(', ')
        .concat('.');

    /**
     * Three independent sources, settled rather than raced: a tenant with no
     * budgets set, or a role without the audit trail, should cost the page its
     * one affected panel and nothing else.
     */
    const fetchDashboardData = async () => {
        setIsLoading(true);
        const yearStart = isoDate(new Date(new Date().getFullYear(), 0, 1));
        const today = isoDate(new Date());

        const [core, logs, budgets] = await Promise.allSettled([
            api.get<DashboardDataResponse>(Constants.GET_DASHBOARD_DATA_URL),
            api.get(Constants.GET_ACTIVITY_LOGS_URL, {
                params: { page: 1, limit: 5 },
            }),
            api.get(
                `${Constants.FETCH_BUDGET_VARIANCE_URL}?from=${yearStart}&to=${today}`
            ),
        ]);

        if (core.status === 'fulfilled' && core.value.data?.data) {
            setDashboardData((prev) => ({ ...prev, ...core.value.data.data }));
        }
        if (logs.status === 'fulfilled') {
            setActivity(logs.value.data?.data?.items ?? []);
        }
        if (budgets.status === 'fulfilled') {
            setVariance(budgets.value.data?.data?.rows ?? []);
        }
        setIsLoading(false);
    };

    const months = dashboardData.graph2.map((item) => item.month);

    /** Revenue / Expenses / Profit, all read off the same monthly rollup. */
    const analyticsData = useMemo(() => {
        const rows = dashboardData.graph2;
        if (series === 'Expenses') return rows.map((r) => r.purchases);
        if (series === 'Profit') return rows.map((r) => r.sales - r.purchases);
        return rows.map((r) => r.sales);
    }, [dashboardData.graph2, series]);

    const spendings = dashboardData.graph2.map((item) => item.purchases);
    const currentSpend = spendings.length ? spendings[spendings.length - 1] : 0;
    const peakSpend = spendings.length ? Math.max(...spendings) : 0;

    // Of everything invoiced, how much has actually landed. The one ratio that
    // says whether the month was good, so it gets the gauge.
    const collectionRate = dashboardData.sales.totalSalesAmount
        ? Math.round(
            (dashboardData.sales.receivedAmount /
                dashboardData.sales.totalSalesAmount) *
            100
        )
        : 0;

    const visiblePurchases = useMemo(() => {
        const term = purchaseSearch.trim().toLowerCase();
        if (!term) return dashboardData.lastFivePurchases;
        return dashboardData.lastFivePurchases.filter((p) =>
            [p.purchaseId, p.vendor?.name, p.status]
                .filter(Boolean)
                .some((field) => String(field).toLowerCase().includes(term))
        );
    }, [dashboardData.lastFivePurchases, purchaseSearch]);

    // Biggest spenders first — a cost panel nobody scrolls should lead with the
    // lines large enough to be worth acting on.
    const costRows = useMemo(
        () =>
            [...variance]
                .sort((a, b) => num(b.actual) - num(a.actual))
                .slice(0, 5),
        [variance]
    );
    const costCeiling = costRows.reduce(
        (max, row) => Math.max(max, num(row.actual), num(row.budget)),
        0
    );

    const dateFormat = systemSettings?.dateFormat.format || 'd-m-Y';
    const formattedTime: string = formatDate(time, timeFormat);

    if (isLoading) {
        return (
            <div className="p-4 md:p-6 bg-background min-h-full font-sans flex items-center justify-center">
                <LoaderSpinner />
            </div>
        );
    }

    return (
        <div className="px-4 py-2 bg-background min-h-full font-sans border border-border rounded-md">
            <PageHeader title="Dashboard">
                <button
                    type="button"
                    onClick={() => navigate('/invoices/create-invoice')}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
                >
                    <Plus className="w-4 h-4" /> Add
                </button>
            </PageHeader>

            {/* One line: the greeting anchors to the left edge like every other
                page title, the timestamp is a footnote pushed out to the right.
                It wraps under the greeting only when the row is too narrow to
                hold both. */}
            <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-2xl font-semibold text-foreground">
                    {getGreeting()},{' '}
                    <span className="text-primary">{activeTenant?.name ?? 'there'}</span>
                </h2>
                <p className="text-xs text-muted-foreground">
                    {[
                        formatDate(time, dateFormat),
                        formattedTime,
                        activeTenant?.roleName && `Signed in as ${activeTenant.roleName}`,
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
            </div>

            {/* Money first: what is owed to us, what we collected, what we spent,
                and how many documents it took. Amounts, not document counts —
                counts live in the queue tiles below, where each one comes with
                somewhere to go. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4 mt-6 w-full">
                <StatsCard
                    title="Total Amount"
                    period="Outstanding"
                    value={format(dashboardData.sales.totalDueAmount || 0)}
                    icon={<BadgeDollarSign className="w-5 h-5" />}
                    accent="primary"
                    tinted
                    color=""
                />
                <StatsCard
                    title="Income"
                    period="All time"
                    value={format(dashboardData.sales.receivedAmount || 0)}
                    icon={<CheckCircle2 className="w-5 h-5" />}
                    accent="success"
                    tinted
                    color=""
                />
                <StatsCard
                    title="Expense"
                    period="All time"
                    value={format(dashboardData.purchases.totalPurchasesAmount || 0)}
                    icon={<CreditCard className="w-5 h-5" />}
                    accent="danger"
                    tinted
                    color=""
                />
                <StatsCard
                    title="Total orders"
                    period="All time"
                    value={dashboardData.totalInvoiceCount || 0}
                    icon={<BarChart2 className="w-5 h-5" />}
                    accent="teal"
                    tinted
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
                <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4 mt-4 w-full">
                    {activeQueues.map((queue) => (
                        <button
                            key={queue.key}
                            type="button"
                            onClick={() => navigate(queue.to)}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary cursor-pointer"
                        >
                            <span>
                                <span className="block font-medium text-card-foreground">
                                    {queue.label}
                                </span>
                                <span className="block text-sm text-muted-foreground">
                                    {queue.module}
                                </span>
                            </span>
                            <span className="font-mono tabular-nums text-2xl font-bold text-destructive-strong">
                                {queueCounts?.[queue.key]}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Spendings, and the same months read as a trend line. */}
            <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 mt-4">
                <div className="lg:col-span-4 bg-card p-4 rounded-xl border border-border">
                    <h3 className="text-lg font-semibold text-foreground">Spendings</h3>
                    <p className="text-xs text-muted-foreground">Purchases per month</p>
                    {spendings.length > 0 ? (
                        <>
                            <ChartFrame minH="10rem" vh="22vh" maxH="16.25rem">
                                {({ height }) => (
                                <Chart
                                    type="bar"
                                    height={height}
                                    width="100%"
                                    series={[{ name: 'Spendings', data: spendings }]}
                                    options={{
                                        chart: {
                                            toolbar: { show: false },
                                            foreColor: themeColor('muted-foreground'),
                                        },
                                        colors: [themeColor('primary')],
                                        plotOptions: {
                                            bar: { columnWidth: '45%', borderRadius: 6 },
                                        },
                                        dataLabels: { enabled: false },
                                        grid: {
                                            borderColor: themeColor('border'),
                                            strokeDashArray: 4,
                                        },
                                        xaxis: { categories: months, axisTicks: { show: false } },
                                        yaxis: { labels: { formatter: (v: number) => format(v) } },
                                        tooltip: { y: { formatter: (v: number) => format(v) } },
                                    }}
                                />
                                )}
                            </ChartFrame>
                            <p className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">
                                Current spend:{' '}
                                <span className="font-mono tabular-nums font-semibold text-foreground">
                                    {format(currentSpend)}
                                </span>{' '}
                                / {format(peakSpend)} peak
                            </p>
                        </>
                    ) : (
                        <EmptyState
                            art="no-data"
                            size="compact"
                            title="No spending recorded yet"
                        />
                    )}
                </div>

                <div className="lg:col-span-6 bg-card p-4 rounded-xl border border-border">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">
                                Business Analytics
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                {months.length
                                    ? `${months[0]} – ${months[months.length - 1]}`
                                    : 'No period'}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-1">
                            {ANALYTICS_SERIES.map((name) => (
                                <button
                                    key={name}
                                    type="button"
                                    onClick={() => setSeries(name)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${series === name
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-card hover:text-foreground'
                                        }`}
                                >
                                    {name}
                                </button>
                            ))}
                        </div>
                    </div>
                    <MultiLineAreaChart
                        data={analyticsData}
                        seriesNames={[series]}
                        categories={months}
                        color={themeColor('primary')}
                    />
                </div>
            </div>

            {/* Latest Purchase */}
            <div className="bg-card p-4 rounded-xl border border-border mt-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h3 className="text-lg font-semibold text-foreground">
                        Latest Purchase
                    </h3>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 w-4 h-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="search"
                                value={purchaseSearch}
                                onChange={(e) => setPurchaseSearch(e.target.value)}
                                placeholder="Search"
                                aria-label="Search the latest purchases"
                                className="rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/purchases')}
                            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary hover:text-primary-foreground cursor-pointer"
                        >
                            View all <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <Table
                    headers={[
                        '#',
                        'Document No',
                        'Date',
                        'Party',
                        'Taxable',
                        'GST',
                        'Amount',
                        'Status',
                    ]}
                >
                    {visiblePurchases.map((purchase, index) => (
                        <TableRow
                            key={purchase.id}
                            row={purchase}
                            index={index + 1}
                            columns={[
                                purchase.purchaseId,
                                formatDate(
                                    purchase.purchaseDate ?? purchase.createdAt,
                                    dateFormat
                                ),
                                purchase.vendor?.name ?? '—',
                                format(num(purchase.taxableAmount)),
                                format(num(purchase.totalTax)),
                                format(purchase.totalAmount),
                                <StatusBadge status={purchase.status} />,
                            ]}
                        />
                    ))}
                    {!visiblePurchases.length && (
                        <EmptyStateRow
                            colSpan={8}
                            art="invoice"
                            title={
                                purchaseSearch
                                    ? 'No purchases match that search'
                                    : 'No purchases found'
                            }
                        />
                    )}
                </Table>
            </div>

            {/* Total Value · Recent Activity · Cost Efficiency */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 mb-4">
                <div className="bg-card p-4 rounded-xl border border-border flex flex-col items-center text-center">
                    <h3 className="self-start text-lg font-semibold text-foreground">
                        Total Value
                    </h3>
                    {/* aspect={1} keeps the gauge circular: its width used to be
                        pinned at 260px, so it neither shrank on a narrow column
                        nor grew on a wide one. */}
                    <ChartFrame aspect={1} minH="9rem" vh="20vh" maxH="16.25rem">
                        {({ height }) => (
                        <Chart
                            type="radialBar"
                            height={height}
                            width={height}
                            series={[collectionRate]}
                            options={{
                                colors: [themeColor('primary')],
                                plotOptions: {
                                    radialBar: {
                                        hollow: { size: '62%' },
                                        track: { background: themeColor('muted') },
                                        dataLabels: {
                                            name: { show: false },
                                            value: {
                                                offsetY: 8,
                                                fontSize: '28px',
                                                fontWeight: 700,
                                                color: themeColor('foreground'),
                                                formatter: (v: number) => `${Math.round(v)}%`,
                                            },
                                        },
                                    },
                                },
                                stroke: { lineCap: 'round' },
                            }}
                        />
                        )}
                    </ChartFrame>
                    <p className="text-sm text-muted-foreground">
                        Of everything invoiced, this much has been collected.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Last checked {formatDate(time, dateFormat)}
                    </p>
                    {isAgentAvailable && (
                        <button
                            type="button"
                            onClick={openAgent}
                            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary cursor-pointer"
                        >
                            What these stats mean?
                        </button>
                    )}
                </div>

                <div className="bg-card p-4 rounded-xl border border-border">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-foreground">
                            Recent Activity
                        </h3>
                        <button
                            type="button"
                            onClick={() => navigate('/activity-log')}
                            className="text-sm text-primary hover:underline cursor-pointer"
                        >
                            View All
                        </button>
                    </div>
                    {activity.length > 0 ? (
                        <ul className="space-y-3">
                            {activity.map((item) => (
                                <li key={item.id} className="flex items-start gap-3">
                                    <span
                                        aria-hidden="true"
                                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTION_DOT[item.action] ?? 'bg-muted-foreground'
                                            }`}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-foreground">
                                            {item.summary}
                                        </span>
                                        <span className="block truncate text-xs text-muted-foreground">
                                            {item.userName}
                                        </span>
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {relativeTime(item.createdAt)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <EmptyState
                            art="no-data"
                            size="compact"
                            title="Nothing has happened yet"
                        />
                    )}
                </div>

                <div className="bg-card p-4 rounded-xl border border-border">
                    <h3 className="text-lg font-semibold text-foreground mb-3">
                        Cost Efficiency
                    </h3>
                    {costRows.length > 0 ? (
                        <div className="space-y-3">
                            {costRows.map((row) => (
                                <div key={row.accountId}>
                                    <div className="flex justify-between gap-2 text-xs">
                                        <span className="truncate text-foreground">
                                            {row.accountName}
                                        </span>
                                        <span
                                            className={`font-mono tabular-nums ${row.favorable ? 'text-success' : 'text-destructive'
                                                }`}
                                        >
                                            {format(num(row.actual))}
                                        </span>
                                    </div>
                                    <div className="mt-1 h-2 rounded bg-muted">
                                        <div
                                            className={`h-2 rounded ${row.favorable ? 'bg-success' : 'bg-destructive'
                                                }`}
                                            style={{
                                                width: `${costCeiling > 0
                                                    ? (num(row.actual) / costCeiling) * 100
                                                    : 0
                                                    }%`,
                                            }}
                                        />
                                    </div>
                                    <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                                        {row.favorable ? 'Under' : 'Over'} budget by{' '}
                                        {format(Math.abs(num(row.variance)))} of{' '}
                                        {format(num(row.budget))}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            art="no-data"
                            size="compact"
                            title="No budgets set"
                            description="Set a budget and this panel shows what each account is spending against it."
                            action={
                                <button
                                    type="button"
                                    onClick={() => navigate('/accounting/budgets')}
                                    className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
                                >
                                    Set a budget
                                </button>
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default DashboardPage;
