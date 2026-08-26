import { DateRangePicker } from "@components/admin/DateRangePicker";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import ProfileCard from "@components/admin/ProfileImage";
import StatsCard from "@components/admin/StatsCard";
import StatusBadge from "@components/admin/StatusBadge";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Constants from "@constants/api";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import { useCurrencies } from "@hooks/useCurrencies";
import useDateFormatter from "@hooks/useDateFormatter";
import { useDebounce } from "@hooks/useDebounce";
import type { SalesReportShape } from "@models/transaction-reports";
import type { RootState } from "@store/index";
import { formatLocalDateTime } from "@utils/converters";
import axios from "axios";
import { toast } from "sonner";
import { Box, CheckCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { BiMoneyWithdraw } from "react-icons/bi";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/context/PageHeaderContext";
interface SalesReportResponse {
    success: boolean;
    message: string;
    data: ChartData;
    records: SalesReportShape[];
    pagination: PaginationData;
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface ChartData {
    TotalRevenue: {
        currentMonthAmount: number;
        previousMonthAmount: number;
        change: number;
        trend: 'down' | 'up' | 'equal';
    },
    ActiveInvoices: {
        currentMonthCount: number;
        previousMonthCount: number;
        change: number;
        trend: 'down' | 'up' | 'equal';
    },
    BestSellingProduct: {
        name: string;
        currentMonthQty: number;
        previousMonthQty: number;
        change: number;
        trend: 'down' | 'up' | 'equal';
    },
}
const SalesReport: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [salesReport, setSalesReport] = useState<SalesReportShape[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [chartData, setChartData] = useState<ChartData | null>(null);
    const { format, locale } = useCurrencyFormatter();
    const { resolveCurrency } = useCurrencies();
    const { formatDate } = useDateFormatter();
    // Render each document's amount in ITS OWN currency (not the global default).
    const formatRowAmount = (amount: number, code?: string | null) =>
        `${resolveCurrency(code).symbol}${Number(amount).toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    const [dateRange, setDateRange] = useState<{ startDate: Date | null, endDate: Date | null }>({
        startDate: null,
        endDate: null,
    });
    const [dateRangeError, setDateRangeError] = useState<string | null>(null);
    const [searchInput, setSearchInput] = useState<string>('');
    const debouncedSearchTerm = useDebounce(searchInput, 500);
    const [searchParams, setSearchParams] = useSearchParams();
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState(false);
    useEffect(() => {
        if (token) {
            fetchSalesReport();
        }
    }, [token, debouncedSearchTerm, page, limit]);

    const fetchSalesReport = async (range = dateRange) => {
        try {
            setIsLoading(true);
            const params: Record<string, string> = {};
            if (range.startDate && range.endDate) {
                params.startDate = formatLocalDateTime(range.startDate, 'start', true);
                params.endDate = formatLocalDateTime(range.endDate, 'end', true);
            }
            params.search = debouncedSearchTerm;
            params.limit = Number(searchParams.get('limit') || 10).toString();
            params.page = Number(searchParams.get('page') || 1).toString();
            const response = await axios.get<SalesReportResponse>(Constants.GET_SALES_REPORT_URL, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params
            });

            if (response.data.success) {
                setSalesReport(response.data.records);
                setChartData(response.data.data);
                setPagination(response.data.pagination);
            } else {
                toast.error(response.data?.message || 'Failed to load sales report');
            }
        } catch (error) {
            console.log(error);
            toast.error('Failed to load sales report');
        } finally {
            setIsLoading(false);
        }
    }
    const handleRangeInputChange = (range: { startDate: Date | null, endDate: Date | null }) => {
        setDateRange(range);
        if (range.startDate && range.endDate) {
            setDateRangeError(null);
            fetchSalesReport(range);
        } else {
            setDateRangeError('Please select start date and end date');
        }
    }

    const clearAllFilters = () => {
        setDateRange({ startDate: null, endDate: null });
        setSearchInput('');
        fetchSalesReport({ startDate: null, endDate: null });
    }

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ limit: String(limit), page: String(newPage) });
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);


    const parsePercentage = (value?: string | number | null): number | null => {
        if (value === undefined || value === null) return null;

        // If it's already a number
        if (typeof value === "number") {
            return Math.abs(value);
        }

        // If it's a string, remove % and spaces
        const cleaned = value.replace("%", "").trim();
        const num = Number(cleaned);

        if (isNaN(num)) return null;

        return Math.abs(num);
    }

    // Summing mixed currencies has no meaning (no FX). Only show a money total
    // when every row shares a single currency; otherwise show a dash.
    const distinctCurrencies = Array.from(
        new Set(salesReport.map((r) => resolveCurrency(r.currencyCode).code))
    );
    const isMixedCurrency = distinctCurrencies.length > 1;
    const totalRevenueDisplay = isMixedCurrency
        ? '— (mixed currencies)'
        : format(chartData?.TotalRevenue.currentMonthAmount || 0);

    const totalRevenuePercentage = parsePercentage(chartData?.TotalRevenue.change || 0);
    const activeInvoicesPercentage = parsePercentage(chartData?.ActiveInvoices.change || 0);
    const bestSellingProductPercentage = parsePercentage(chartData?.BestSellingProduct.change || 0);
    return (
        <div className="space-y-4">
            <PageHeader title="Sales Report" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatsCard
                    title="Total Revenue"
                    period="This month"
                    value={totalRevenueDisplay}
                    difference={totalRevenuePercentage || 0}
                    icon={<BiMoneyWithdraw size={25} />}
                    color="purple"
                />
                <StatsCard
                    title="Active Invoices"
                    period="This month"
                    value={chartData?.ActiveInvoices.currentMonthCount || 0}
                    difference={activeInvoicesPercentage || 0}
                    icon={<CheckCircleIcon size={25} />}
                    color="purple"
                />
                <StatsCard
                    title={`Best Selling Product` + (chartData?.BestSellingProduct.name ? ` - ${chartData?.BestSellingProduct.name}` : '')}
                    period="This month"
                    value={chartData?.BestSellingProduct.currentMonthQty || 0}
                    difference={bestSellingProductPercentage || 0}
                    icon={<Box size={25} />}
                    color="purple"
                />
            </div>
            {/* Filters*/}
            <div className="flex items-center gap-2 w-full">
                <div>
                    <input type="text" name="search" id="search" placeholder="Search..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="border border-gray-300 rounded-md px-4 py-2  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600" />
                </div>
                <div>
                    <DateRangePicker
                        value={dateRange}
                        onChange={handleRangeInputChange}
                    />
                    {dateRangeError && <p className="text-red-500 text-sm">{dateRangeError}</p>}
                </div>
                {/* clear filters */}
                <div>
                    <button
                        onClick={clearAllFilters}
                        className="border border-gray-300 rounded-md px-4 py-2  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 cursor-pointer"
                    >
                        Clear Filters
                    </button>
                </div>
                <div className="ml-auto">
                    <select
                        value={limit}
                        onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                        className="border border-gray-300 px-3 py-2 rounded-md bg-white  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                    >
                        {[10, 25, 50].map((num) => (
                            <option className="text-gray-950 " key={num} value={num}>{num} / page</option>
                        ))}
                    </select>
                </div>
            </div>
            {/* Table */}
            <Table headers={['#', 'Invoice ID', 'Customer', 'Total Amount', 'Paid Amount', 'Remaining Balance', 'Status', 'Invoice Date']}>
                {!isLoading && salesReport && salesReport.map((item: SalesReportShape, index: number) => (
                    <TableRow
                        key={item.invoiceId}
                        row={item}
                        index={index + 1}
                        columns={[
                            item.invoiceNumber,
                            <ProfileCard
                                imageUrl={item.customer?.image}
                                name={item.customer?.name}
                                email={item.customer?.email}
                            />,
                            formatRowAmount(item.amount, item.currencyCode),
                            formatRowAmount(item.paidAmount, item.currencyCode),
                            formatRowAmount(item.remainingBalance, item.currencyCode),
                            <StatusBadge status={item.status} />,
                            formatDate(item.invoiceDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                        ]}
                    />
                ))}

                {!isLoading && salesReport.length === 0 && (
                    <tr>
                        <td colSpan={8} className="text-center py-4 text-gray-600 font-semibold">No records found</td>
                    </tr>
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={8}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {/* Pagination Component */}
            <PaginationWrapper
                count={pagination.totalPages}
                page={page}
                from={from}
                to={to}
                total={pagination.total}
                onChange={(_, newPage) => handlePageChange(newPage)}
                paginationVariant="outlined"
                paginationShape="rounded"
            />
        </div>
    );
}

export default SalesReport;