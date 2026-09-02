import api from '@lib/apiClient';
import Constants from "@constants/api";
import type { RootState } from "@store/index";

import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Banknote, ChevronDown, ChevronUp, HandCoinsIcon, LandmarkIcon, TrendingDown, TrendingUp } from "lucide-react";
import Chart from "react-apexcharts";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import { toast } from "sonner";
import type { BankAccount } from "@models/bank-account";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/context/PageHeaderContext";
import { themeColor } from "@lib/designTokens";

interface BalanceTrend {
    bankCurrentTotal: number;
    bankLastTotal: number;
    bankFlag: string;
    pettyCurrentTotal: number;
    pettyLastTotal: number;
    pettyFlag: string;
}
const Banking: React.FC = () => {
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const currencySymbol = systemSettings?.currency?.symbol || "$";
    const [chartData, setChartData] = useState<any>(null);
    const [totals, setTotals] = useState<any>(null);
    const [viewMode, setViewMode] = useState<"30days" | "12months">("30days");
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [showChart, setShowChart] = useState(true);
    const { format } = useCurrencyFormatter();
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const [balanaceTrend, setBalanceTrend] = useState<BalanceTrend | null>(null);
    useEffect(() => {
        fetchChartData();
        fetchBankAccountWithBalance();
    }, []);

    const fetchBankAccountWithBalance = async () => {
        try {
            const response = await api.get(Constants.FETCH_BANK_ACCOUNT_WITH_BALANCE_URL);
            const data = response.data.data;
            if (data && data.bankDetails) {
                setBankAccounts(data.bankDetails);
            } else {
                setBankAccounts([]);
            }
            setBalanceTrend(data.totals ? data.totals : null);
        } catch (error) {
            toast.error("Failed to fetch bank account with balance.");
        }
    }
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownOpen &&
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [dropdownOpen]);

    const fetchChartData = async () => {
        try {
            const response = await api.get(Constants.FETCH_BANKING_CHART_URL);
            const data = response.data.data;
            setChartData(data.chartData);
            setTotals(data.totals);
        } catch (error) {
            console.error("Error fetching chart data:", error);
        }
    };

    if (!chartData || !totals) return null;

    const currentData =
        viewMode === "30days" ? chartData.last30Days : chartData.last12Months;

    const series = [
        {
            name: "Bank Balance",
            data: currentData.map((d: any) => d.bank),
        },
        {
            name: "Petty Cash",
            data: currentData.map((d: any) => d.pettyCash),
        },
    ];

    const options: ApexCharts.ApexOptions = {
        chart: {
            type: "line",
            toolbar: { show: false },
            zoom: { enabled: false },
        },
        stroke: {
            curve: "smooth",
            width: 2,
        },
        colors: [themeColor("primary"), themeColor("teal")],
        markers: {
            size: 0,
            hover: { size: 2 },
        },
        xaxis: {
            categories: currentData.map((d: any) => {
                const parts = d.label.split(" ");
                return parts;
            }),
            labels: {
                style: {
                    colors: themeColor("muted-foreground"),
                    fontSize: "10px",
                },
            },
        },

        yaxis: {
            labels: {
                formatter: (val: number) => `${currencySymbol}${val.toLocaleString()}`,
            },
        },
        tooltip: {
            y: {
                formatter: (val: number) => `${currencySymbol}${val.toLocaleString()}`,
            },
        },
        legend: {
            position: "bottom",
            horizontalAlign: "left",
        },
    };

    return (
        <div className="space-y-6">
            <PageHeader title="Banking Overview" />
            {/* Bank Balance & Chart */}
            <div className="border border-gray-200 rounded-xl p-4">
                <div className="flex justify-between">
                    <h4 className="text-lg font-semibold text-gray-950">All Accounts</h4>
                    <div className="relative inline-block text-left" ref={dropdownRef}>
                        <button
                            type="button"
                            className="inline-flex justify-between items-center px-4 py-2 text-sm font-medium text-gray-700"
                            onClick={() => setDropdownOpen((prev) => !prev)}
                        >
                            {viewMode === "30days" ? "Last 30 Days" : "Last 12 Months"}
                            <ChevronDown className="w-4 h-4 ml-2" />
                        </button>

                        {/* Dropdown Menu */}
                        {dropdownOpen && (
                            <div className="absolute bg-white border border-gray-200 rounded-md z-10">
                                <button
                                    className={`w-full text-left px-4 py-2 text-sm rounded-t-md font-medium transition ${viewMode === "30days"
                                        ? "bg-primary text-white"
                                        : "text-gray-700 hover:bg-gray-100"
                                        }`}
                                    onClick={() => {
                                        setViewMode("30days");
                                        setDropdownOpen(false);
                                    }}
                                >
                                    Last 30 Days
                                </button>
                                <button
                                    className={`w-full text-left px-4 py-2 text-sm rounded-b-md font-medium transition ${viewMode === "12months"
                                        ? "bg-primary text-white"
                                        : "text-gray-700 hover:bg-gray-100"
                                        }`}
                                    onClick={() => {
                                        setViewMode("12months");
                                        setDropdownOpen(false);
                                    }}
                                >
                                    Last 12 Months
                                </button>
                            </div>
                        )}
                    </div>

                </div>
                <div className="flex gap-4 border-t border-gray-200 mt-4">
                    {/* Cash In Hand */}
                    <div className="flex items-center py-4 w-56">
                        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                            <HandCoinsIcon className="w-6 h-6 text-gray-600" />
                        </div>
                        <div className="ml-4">
                            <h3 className="text-sm text-gray-600 font-medium">Cash In Hand</h3>
                            <p className="flex items-center gap-2 text-xl font-semibold text-gray-900">
                                {format(totals.pettyCashCurrentBalance)}
                                {balanaceTrend?.pettyFlag === 'up' ? <TrendingUp className="w-4 h-4 text-green-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}
                            </p>
                        </div>
                    </div>

                    {/* Bank Balance */}
                    <div className="flex items-center py-4 w-56">
                        <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center">
                            <LandmarkIcon className="w-6 h-6 text-green-600" />
                        </div>
                        <div className="ml-4">
                            <h3 className="text-sm text-gray-600 font-medium">Bank Balance</h3>
                            <p className="flex items-center gap-2 text-xl font-semibold text-gray-900">
                                {format(totals.bankCurrentBalance)}
                                {balanaceTrend?.bankFlag === 'up' ? <TrendingUp className="w-4 h-4 text-green-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}
                            </p>
                        </div>
                    </div>
                </div>
                <div
                    className="flex items-center cursor-pointer space-x-2 p-2 rounded"
                    onClick={() => setShowChart(!showChart)}
                >
                    <TrendingUp className="w-5 h-5 text-primary" />
                    <span className="text-primary font-medium">
                        {showChart ? "Hide Chart" : "Show Chart"}
                    </span>
                    {showChart ? (
                        <ChevronUp className="w-4 h-4 text-primary" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-primary" />
                    )}
                </div>

                {/* Chart */}
                {showChart &&
                    <div className="transition-all duration-300">
                        <Chart options={options} series={series} type="line" height={300} />
                    </div>
                }
            </div>
            {/* Bank Accounts */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h4 className="text-lg font-semibold text-gray-900">All Accounts</h4>
                    <span className="text-sm text-gray-500">
                        {bankAccounts ? bankAccounts.length + 1 : 1} accounts
                    </span>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200 uppercase">
                            <tr className="text-left">
                                <th className="py-4 px-6 text-sm font-semibold text-gray-700">Account Details</th>
                                <th className="py-4 px-6 text-sm font-semibold text-gray-700">Amount in Bank</th>
                                <th className="py-4 px-6 text-sm font-semibold text-gray-700">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {/* Petty Cash Row */}
                            <tr className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate('/petty-cash')}>
                                <td className="py-2 px-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full border border-indigo-200 flex items-center justify-center">
                                            <Banknote className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-primary">Petty Cash</p>
                                            <p className="text-xs text-indigo-500">Cash Account</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="py-4 px-6">
                                    <span className="font-semibold text-gray-900">
                                        {format(totals.pettyCashCurrentBalance)}
                                    </span>
                                </td>
                                <td className="py-4 px-6">
                                    <span className="text-gray-950 text-sm font-semibold">View</span>
                                </td>
                            </tr>

                            {/* Bank Accounts */}
                            {bankAccounts && bankAccounts.length > 0 ? (
                                bankAccounts.map((bankAccount) => (
                                    <tr key={bankAccount.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate(`/banking/${bankAccount.id}`)}>
                                        <td className="py-2 px-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full border border-indigo-200 flex items-center justify-center">
                                                    <LandmarkIcon className="w-5 h-5 text-indigo-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-primary">{bankAccount.bankName} - {bankAccount.accountHoldername}</p>
                                                    <p className="text-xs text-indigo-500">
                                                        {bankAccount.accountNumber ? `****${bankAccount.accountNumber.slice(-4)}` : 'Bank Account'}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-2 px-6">
                                            <span className="font-semibold text-gray-900">
                                                {format(bankAccount.currentBalance)}
                                            </span>
                                        </td>
                                        <td className="py-2 px-6">
                                            <span className="text-gray-950 text-sm font-semibold">View</span>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={3} className="py-8 px-6 text-center">
                                        <div className="flex flex-col items-center justify-center text-gray-500">
                                            <LandmarkIcon className="w-12 h-12 text-gray-300 mb-2" />
                                            <p className="font-medium">No bank accounts found</p>
                                            <p className="text-sm mt-1">Add your first bank account to get started</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Banking;
