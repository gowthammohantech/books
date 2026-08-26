import { ChartCard } from "@components/admin/ChartCard";
import { DateRangePicker } from "@components/admin/DateRangePicker";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import ProfileCard from "@components/admin/ProfileImage";
import StatusBadge from "@components/admin/StatusBadge";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Constants from "@constants/api";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import { useCurrencies } from "@hooks/useCurrencies";
import useDateFormatter from "@hooks/useDateFormatter";
import { useDebounce } from "@hooks/useDebounce";
import type { PurchaseReportShape } from "@models/transaction-reports";
import type { RootState } from "@store/index";
import { formatLocalDateTime } from "@utils/converters";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/context/PageHeaderContext";
interface PurchaseReportResponse {
    success: boolean;
    message: string;
    data: ChartData;
    records: PurchaseReportShape[];
    pagination: PaginationData;
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface ChartData {
    totalPurchases: {
        count: number;
        totalAmount: number;
    },
    completedOrders: {
        count: number;
        totalAmount: number;
    },
    pendingOrders: {
        count: number;
        totalAmount: number;
    },
    cancelledOrders: {
        count: number;
        totalAmount: number;
    }
}
const PurchaseReport: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [purchaseReport, setPurchaseReport] = useState<PurchaseReportShape[]>([]);
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
            fetchPurchaseReport();
        }
    }, [token, debouncedSearchTerm, page, limit]);

    const fetchPurchaseReport = async (range = dateRange) => {
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
            const response = await axios.get<PurchaseReportResponse>(Constants.GET_PURCHASE_REPORT_URL, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params
            });

            if (response.data.success) {
                setPurchaseReport(response.data.records);
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
            fetchPurchaseReport(range);
        } else {
            setDateRangeError('Please select start date and end date');
        }
    }

    const clearAllFilters = () => {
        setDateRange({ startDate: null, endDate: null });
        setSearchInput('');
        fetchPurchaseReport({ startDate: null, endDate: null });
    }

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ limit: String(limit), page: String(newPage) });
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    // Summing mixed currencies has no meaning (no FX). Only show money totals
    // when every row shares a single currency; otherwise show a dash.
    const distinctCurrencies = Array.from(
        new Set(purchaseReport.map((r) => resolveCurrency(r.currencyCode).code))
    );
    const isMixedCurrency = distinctCurrencies.length > 1;
    const totalDisplay = (amount: number) =>
        isMixedCurrency ? '— (mixed currencies)' : format(amount);

    return (
        <div className="space-y-4">
            <PageHeader title="Purchase Report" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <ChartCard title="Total Purchases" value={totalDisplay(chartData?.totalPurchases.totalAmount || 0)} color="#7539FF" />
                <ChartCard title="Completed Orders" value={totalDisplay(chartData?.completedOrders.totalAmount || 0)} color="#27AE60" />
                <ChartCard title="Pending Orders" value={totalDisplay(chartData?.pendingOrders.totalAmount || 0)} color="#E2B93B" />
                <ChartCard title="Cancelled Orders" value={totalDisplay(chartData?.cancelledOrders.totalAmount || 0)} color="#EF1E1E" />
            </div>
            {/* Filters*/}
            <div className="flex items-center gap-2 w-full">
                <div>
                    <input type="text" name="search" id="search" placeholder="Search..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="border border-gray-300 rounded-md px-4 py-2  text-gray-950  focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                    <DateRangePicker
                        value={dateRange}
                        onChange={handleRangeInputChange}
                    />
                    {dateRangeError && <p className="text-destructive text-sm">{dateRangeError}</p>}
                </div>
                {/* clear filters */}
                <div>
                    <button
                        onClick={clearAllFilters}
                        className="border border-gray-300 rounded-md px-4 py-2  text-gray-950  focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                    >
                        Clear Filters
                    </button>
                </div>
                <div className="ml-auto">
                    <select
                        value={limit}
                        onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                        className="border border-gray-300 px-3 py-2 rounded-md bg-white  text-gray-950  focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                    >
                        {[10, 25, 50].map((num) => (
                            <option className="text-gray-950 " key={num} value={num}>{num} / page</option>
                        ))}
                    </select>
                </div>
            </div>
            {/* Table */}
            <Table headers={['#', 'Purchase ID', 'Supplier', 'Total Amount', 'Paid Amount', 'Balance', 'Status', 'Purchase Date']}>
                {!isLoading && purchaseReport && purchaseReport.map((item: any, index: number) => (
                    <TableRow
                        key={item.purchaseId}
                        row={item}
                        index={index + 1}
                        columns={[
                            item.purchaseId,
                            <ProfileCard
                                imageUrl={item.vendor?.image}
                                name={item.vendor?.name}
                                email={item.vendor?.email}
                            />,
                            formatRowAmount(item.totalAmount, item.currencyCode),
                            formatRowAmount(item.paidAmount, item.currencyCode),
                            formatRowAmount(item.balance, item.currencyCode),
                            <StatusBadge status={item.status} />,
                            formatDate(item.purchaseDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                        ]}
                    />
                ))}

                {!isLoading && purchaseReport.length === 0 && (
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

export default PurchaseReport;