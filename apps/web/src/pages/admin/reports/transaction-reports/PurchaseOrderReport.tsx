import api from '@lib/apiClient';
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
import type { PurchaseOrderReportShape } from "@models/transaction-reports";
import type { RootState } from "@store/index";
import { formatLocalDateTime } from "@utils/converters";

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/context/PageHeaderContext";
import { themeColor } from "@lib/designTokens";
import { PageSizeSelect } from "@components/ui";
interface PurchaseOrderReportResponse {
    success: boolean;
    message: string;
    data: ChartData;
    records: PurchaseOrderReportShape[];
    pagination: PaginationData;
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface ChartData {
    totalOrders: {
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
const PurchaseOrderReport: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [purchaseOrderReport, setPurchaseOrderReport] = useState<PurchaseOrderReportShape[]>([]);
    const [chartData, setChartData] = useState<ChartData | null>(null);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
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
            fetchPurchaseOrderReport();
        }
    }, [token, debouncedSearchTerm, page, limit]);

    const fetchPurchaseOrderReport = async (range = dateRange) => {
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
            const response = await api.get<PurchaseOrderReportResponse>(Constants.GET_PURCHASE_ORDER_REPORT_URL, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params
            });

            if (response.data.success) {
                setPurchaseOrderReport(response.data.records);
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
            fetchPurchaseOrderReport(range);
        } else {
            setDateRangeError('Please select start date and end date');
        }
    }

    const clearAllFilters = () => {
        setDateRange({ startDate: null, endDate: null });
        setSearchInput('');
        fetchPurchaseOrderReport({ startDate: null, endDate: null });
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
        new Set(purchaseOrderReport.map((r) => resolveCurrency(r.currencyCode).code))
    );
    const isMixedCurrency = distinctCurrencies.length > 1;
    const totalDisplay = (amount: number) =>
        isMixedCurrency ? '— (mixed currencies)' : format(amount);

    return (
        <div className="space-y-4">
            <PageHeader title="Purchase Order Report" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <ChartCard title="Total Purchase Orders" value={totalDisplay(chartData?.totalOrders.totalAmount || 0)} color={themeColor("primary")} />
                <ChartCard title="Completed Orders" value={totalDisplay(chartData?.completedOrders.totalAmount || 0)} color={themeColor("success")} />
                <ChartCard title="Pending Orders" value={totalDisplay(chartData?.pendingOrders.totalAmount || 0)} color={themeColor("warning")} />
                <ChartCard title="Cancelled Orders" value={totalDisplay(chartData?.cancelledOrders.totalAmount || 0)} color={themeColor("destructive")} />
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
                    <PageSizeSelect value={limit} onChange={handlePageLengthChange} />
                </div>
            </div>
            {/* Table */}
            <Table headers={['#', 'Purchase Order ID', 'Supplier', 'Total Amount', 'Status', 'Purchase Order Date']}>
                {!isLoading && purchaseOrderReport && purchaseOrderReport.map((item: any, index: number) => (
                    <TableRow
                        key={item.purchaseOrderId}
                        row={item}
                        index={index + 1}
                        columns={[
                            item.purchaseOrderId,
                            <ProfileCard
                                imageUrl={item.vendor?.image}
                                name={item.vendor?.name}
                                email={item.vendor?.email}
                            />,
                            formatRowAmount(item.totalAmount, item.currencyCode),
                            <StatusBadge status={item.status} />,
                            formatDate(item.purchaseOrderDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                        ]}
                    />
                ))}

                {!isLoading && purchaseOrderReport.length === 0 && (
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

export default PurchaseOrderReport;