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
import type { QuotationReportShape } from "@models/transaction-reports";
import type { RootState } from "@store/index";
import { formatLocalDateTime } from "@utils/converters";
import axios from "axios";
import { Ban, CheckCircleIcon, HourglassIcon, ShoppingBagIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/context/PageHeaderContext";
interface QuotationReportResponse {
    success: boolean;
    message: string;
    data: ChartData;
    records: QuotationReportShape[];
    pagination: PaginationData;
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface ChartData {
    total: {
        current: number;
        previous: number;
        percentage: number;
        ratio: 'down' | 'up' | 'equal';
    },
    pending: {
        current: number;
        previous: number;
        percentage: number;
        ratio: 'down' | 'up' | 'equal';
    },
    completed: {
        current: number;
        previous: number;
        percentage: number;
        ratio: 'down' | 'up' | 'equal';
    },
    cancelled: {
        current: number;
        previous: number;
        percentage: number;
        ratio: 'down' | 'up' | 'equal';
    }
}
const QuotationReport: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [quotationReport, setQuotationReport] = useState<QuotationReportShape[]>([]);
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
            fetchQuotationReport();
        }
    }, [token, debouncedSearchTerm, page, limit]);

    const fetchQuotationReport = async (range = dateRange) => {
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
            const response = await axios.get<QuotationReportResponse>(Constants.GET_QUOTATION_REPORT_URL, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params
            });

            if (response.data.success) {
                setQuotationReport(response.data.records);
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
            fetchQuotationReport(range);
        } else {
            setDateRangeError('Please select start date and end date');
        }
    }

    const clearAllFilters = () => {
        setDateRange({ startDate: null, endDate: null });
        setSearchInput('');
        fetchQuotationReport({ startDate: null, endDate: null });
    }

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ limit: String(limit), page: String(newPage) });
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    // Summing mixed currencies has no meaning (no FX). Only show a money total
    // when every row shares a single currency; otherwise show a dash.
    const distinctCurrencies = Array.from(
        new Set(quotationReport.map((r) => resolveCurrency(r.currencyCode).code))
    );
    const isMixedCurrency = distinctCurrencies.length > 1;
    const totalQuotationsDisplay = isMixedCurrency
        ? '— (mixed currencies)'
        : format(chartData?.total.current || 0);


    return (
        <div className="space-y-4">
            <PageHeader title="Quotation Report" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatsCard
                    title="Total Quotations"
                    period="This month"
                    value={totalQuotationsDisplay}
                    difference={chartData?.total.percentage || 0}
                    icon={<ShoppingBagIcon size={25} />}
                    color="purple"
                />
                <StatsCard
                    title="Pending Quotations"
                    period="This month"
                    value={chartData?.pending.current || 0}
                    difference={chartData?.pending.percentage || 0}
                    icon={<HourglassIcon size={25} />}
                    color="purple"
                />
                <StatsCard
                    title="Completed Quotations"
                    period="This month"
                    value={chartData?.completed.current || 0}
                    difference={chartData?.completed.percentage || 0}
                    icon={<CheckCircleIcon size={25} />}
                    color="purple"
                />
                <StatsCard
                    title="Cancelled Quotations"
                    period="This month"
                    value={chartData?.cancelled.current || 0}
                    difference={chartData?.cancelled.percentage || 0}
                    icon={<Ban size={25} />}
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
            <Table headers={['#', 'Quotation ID', 'Customer', 'Total Amount', 'Status', 'Quotation Date']}>
                {!isLoading && quotationReport && quotationReport.map((item: QuotationReportShape, index: number) => (
                    <TableRow
                        key={item.quotationId}
                        row={item}
                        index={index + 1}
                        columns={[
                            item.quotationId,
                            <ProfileCard
                                imageUrl={item.customer?.image}
                                name={item.customer?.name}
                                email={item.customer?.email}
                            />,
                            formatRowAmount(item.totalAmount, item.currencyCode),
                            <StatusBadge status={item.status} />,
                            formatDate(item.quotationDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                        ]}
                    />
                ))}

                {!isLoading && quotationReport.length === 0 && (
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

export default QuotationReport;