import { DateRangePicker } from "@components/admin/DateRangePicker";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import StatsCard from "@components/admin/StatsCard";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Constants from "@constants/api";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import type { StaffActivityRowShape, StaffActivityTotalsShape } from "@models/staff-activity-reports";
import type { RootState } from "@store/index";
import { formatLocalDateTime } from "@utils/converters";
import axios from "axios";
import { FilePenLine, FilePlus2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BiMoneyWithdraw } from "react-icons/bi";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import { PageHeader } from "@/context/PageHeaderContext";

interface StaffActivityReportResponse {
    success: boolean;
    message?: string;
    data: {
        from: string | null;
        to: string | null;
        rows: StaffActivityRowShape[];
        totals: StaffActivityTotalsShape;
    };
}

const EMPTY_TOTALS: StaffActivityTotalsShape = {
    invoicesCreated: 0,
    invoicesUpdated: 0,
    invoicesDeleted: 0,
    totalValueCreated: 0,
};

const StaffActivityReport: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { format } = useCurrencyFormatter();
    const [rows, setRows] = useState<StaffActivityRowShape[]>([]);
    const [totals, setTotals] = useState<StaffActivityTotalsShape>(EMPTY_TOTALS);
    const [dateRange, setDateRange] = useState<{ startDate: Date | null, endDate: Date | null }>({
        startDate: null,
        endDate: null,
    });
    const [dateRangeError, setDateRangeError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (token) {
            fetchStaffActivityReport();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const fetchStaffActivityReport = async (range = dateRange) => {
        try {
            setIsLoading(true);
            const params: Record<string, string> = {};
            if (range.startDate && range.endDate) {
                params.from = formatLocalDateTime(range.startDate, 'start', true);
                params.to = formatLocalDateTime(range.endDate, 'end', true);
            }
            const response = await axios.get<StaffActivityReportResponse>(Constants.STAFF_ACTIVITY_REPORT_URL, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params
            });

            if (response.data.success) {
                setRows(response.data.data.rows);
                setTotals(response.data.data.totals);
            } else {
                toast.error(response.data?.message || 'Failed to load staff activity report');
            }
        } catch (error) {
            console.log(error);
            toast.error('Failed to load staff activity report');
        } finally {
            setIsLoading(false);
        }
    }

    const handleRangeInputChange = (range: { startDate: Date | null, endDate: Date | null }) => {
        setDateRange(range);
        if (range.startDate && range.endDate) {
            setDateRangeError(null);
            fetchStaffActivityReport(range);
        } else {
            setDateRangeError('Please select start date and end date');
        }
    }

    const clearAllFilters = () => {
        setDateRange({ startDate: null, endDate: null });
        fetchStaffActivityReport({ startDate: null, endDate: null });
    }

    const periodCaption = dateRange.startDate && dateRange.endDate ? 'Selected period' : 'All time';

    return (
        <div className="space-y-4">
            <PageHeader title="Staff Activity" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatsCard
                    title="Invoices Created"
                    period={periodCaption}
                    value={totals.invoicesCreated}
                    icon={<FilePlus2 size={25} />}
                    color="purple"
                    accent="success"
                />
                <StatsCard
                    title="Invoices Updated"
                    period={periodCaption}
                    value={totals.invoicesUpdated}
                    icon={<FilePenLine size={25} />}
                    color="purple"
                    accent="info"
                />
                <StatsCard
                    title="Invoices Deleted"
                    period={periodCaption}
                    value={totals.invoicesDeleted}
                    icon={<Trash2 size={25} />}
                    color="purple"
                    accent="danger"
                />
                <StatsCard
                    title="Total Value Created"
                    period={periodCaption}
                    value={format(totals.totalValueCreated)}
                    icon={<BiMoneyWithdraw size={25} />}
                    color="purple"
                    accent="primary"
                />
            </div>
            {/* Filters*/}
            <div className="flex items-center gap-2 w-full">
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
            </div>
            {/* Table */}
            <Table headers={['#', 'Staff Name', 'Invoices Created', 'Invoices Updated', 'Invoices Deleted', 'Total Value Created']}>
                {!isLoading && rows && rows.map((item: StaffActivityRowShape, index: number) => (
                    <TableRow
                        key={item.userId}
                        row={item}
                        index={index + 1}
                        columns={[
                            item.userName,
                            item.invoicesCreated,
                            item.invoicesUpdated,
                            item.invoicesDeleted,
                            format(item.totalValueCreated),
                        ]}
                    />
                ))}

                {!isLoading && rows.length === 0 && (
                    <NoRecords colSpan={6} />
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={6}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>
        </div>
    );
}

export default StaffActivityReport;
