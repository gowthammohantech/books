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
import type { SalesReturnReportShape } from "@models/transaction-reports";
import type { RootState } from "@store/index";
import { formatLocalDateTime } from "@utils/converters";
import axios from "axios";
import { Box, CheckCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { BiMoneyWithdraw } from "react-icons/bi";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/context/PageHeaderContext";
interface SalesReturnReportResponse {
    success: boolean;
    message: string;
    data: ChartData;
    records: SalesReturnReportShape[];
    pagination: PaginationData;
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface ChartData {
    TotalRefund: {
        currentMonthAmount: number;
        previousMonthAmount: number;
        change: number;
        trend: 'down' | 'up' | 'equal';
    },
    ActiveCreditNotes: {
        currentMonthCount: number;
        previousMonthCount: number;
        change: number;
        trend: 'down' | 'up' | 'equal';
    },
    MostReturnedProduct: {
        name: string;
        currentMonthQty: number;
        previousMonthQty: number;
        change: number;
        trend: 'down' | 'up' | 'equal';
    },
}
const SalesReturnReport: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [salesReturnReport, setSalesReturnReport] = useState<SalesReturnReportShape[]>([]);
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
            fetchSalesReturnReport();
        }
    }, [token, debouncedSearchTerm, page, limit]);

    const fetchSalesReturnReport = async (range = dateRange) => {
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
            const response = await axios.get<SalesReturnReportResponse>(Constants.GET_SALES_RETURN_REPORT_URL, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params
            });

            if (response.data.success) {
                setSalesReturnReport(response.data.records);
                setChartData(response.data.data);
                setPagination(response.data.pagination);
            }
        } catch (error) {
            console.log(error);
        } finally {
            setIsLoading(false);
        }
    }
    const handleRangeInputChange = (range: { startDate: Date | null, endDate: Date | null }) => {
        setDateRange(range);
        if (range.startDate && range.endDate) {
            setDateRangeError(null);
            fetchSalesReturnReport(range);
        } else {
            setDateRangeError('Please select start date and end date');
        }
    }

    const clearAllFilters = () => {
        setDateRange({ startDate: null, endDate: null });
        setSearchInput('');
        fetchSalesReturnReport({ startDate: null, endDate: null });
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
        new Set(salesReturnReport.map((r) => resolveCurrency(r.currencyCode).code))
    );
    const isMixedCurrency = distinctCurrencies.length > 1;
    const totalRefundDisplay = isMixedCurrency
        ? '— (mixed currencies)'
        : format(chartData?.TotalRefund.currentMonthAmount || 0);

    const totalRefundPercentage = parsePercentage(chartData?.TotalRefund.change || 0);
    const activeCreditNotesPercentage = parsePercentage(chartData?.ActiveCreditNotes.change || 0);
    const mostReturnedProductPercentage = parsePercentage(chartData?.MostReturnedProduct.change || 0);
    return (
        <div className="space-y-4">
            <PageHeader title="Sales Return Report" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatsCard
                    title="Total Returned Amount"
                    period="This month"
                    value={totalRefundDisplay}
                    difference={totalRefundPercentage || 0}
                    icon={<BiMoneyWithdraw size={25} />}
                    color="purple"
                />
                <StatsCard
                    title="Active Credit Notes"
                    period="This month"
                    value={chartData?.ActiveCreditNotes.currentMonthCount || 0}
                    difference={activeCreditNotesPercentage || 0}
                    icon={<CheckCircleIcon size={25} />}
                    color="purple"
                />
                <StatsCard
                    title={`Most Returned Product` + (chartData?.MostReturnedProduct.name ? ` - ${chartData?.MostReturnedProduct.name}` : '')}
                    period="This month"
                    value={chartData?.MostReturnedProduct.currentMonthQty || 0}
                    difference={mostReturnedProductPercentage || 0}
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
            <Table headers={['#', 'Credit Note ID', 'Customer', 'Total Amount', 'Status', 'Credit Note Date']}>
                {!isLoading && salesReturnReport && salesReturnReport.map((item: SalesReturnReportShape, index: number) => (
                    <TableRow
                        key={item.creditNoteId}
                        row={item}
                        index={index + 1}
                        columns={[
                            item.creditNoteNumber,
                            <ProfileCard
                                imageUrl={item.customer?.image}
                                name={item.customer?.name}
                                email={item.customer?.email}
                            />,
                            formatRowAmount(item.refundAmount, item.currencyCode),
                            <StatusBadge status={item.status} />,
                            formatDate(item.creditNoteDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                        ]}
                    />
                ))}

                {!isLoading && salesReturnReport.length === 0 && (
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

export default SalesReturnReport;