import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FileDownIcon } from "lucide-react";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import type { InventoryHistoryData } from "@models/inventory";
import { PageHeader } from "@/context/PageHeaderContext";
import { Badge, Button, Card } from "@components/ui";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import useDateFormatter from "@hooks/useDateFormatter";
import { useCurrencies } from "@hooks/useCurrencies";

// Friendly source label — distinguishes sales return (credit note) from
// purchase return (debit note); falls back to the raw value for legacy rows.
const refTypeLabel = (ref?: string | null, notes?: string | null): string => {
    switch (ref) {
        case "purchase": return "Purchase";
        case "invoice": return "Invoice";
        case "sales_return": return "Sales Return";
        case "purchase_return": return "Purchase Return";
        case "return_": return "Return";
        case "adjustment": return "Adjustment";
        default: return ref || notes || "-";
    }
};

const getAdjustmentDisplay = (adj: number) => {
    if (adj > 0) return <span className="text-success font-semibold">+{adj}</span>;
    if (adj < 0) return <span className="text-danger font-semibold">{adj}</span>;
    return "-";
};

const InventoryView: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatDateTime } = useDateFormatter();
    const { formatMoney } = useCurrencies();

    const [data, setData] = useState<InventoryHistoryData | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [notFound, setNotFound] = useState<boolean>(false);

    const fetchHistory = useCallback(async (inventoryId: string) => {
        try {
            setIsLoading(true);
            setNotFound(false);
            const response = await axios.get(
                `${Constants.FETCH_INVENTORY_HISTORY_URL}/${inventoryId}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            setData(response.data.data);
        } catch (error) {
            console.error("Error fetching inventory history:", error);
            setNotFound(true);
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (id) fetchHistory(id);
    }, [id, fetchHistory]);

    const handleDownloadPDF = useCallback(() => {
        if (!data) return;
        const doc = new jsPDF();
        const rawName = data.productId?.name ?? "";
        const productName = rawName ? rawName[0].toUpperCase() + rawName.slice(1) : "";
        doc.text(`Inventory History - ${productName}`, 14, 10);
        autoTable(doc, {
            head: [["Date", "Type", "Adjustment", "Stock After", "Notes"]],
            body: data.history.map((h) => {
                const adj = Number(h.adjustment ?? 0);
                const stockAfter = Number(h.quantity ?? 0) + adj;
                return [
                    formatDateTime(h.createdAt),
                    refTypeLabel(h.referenceType, h.notes),
                    adj > 0 ? `+${adj}` : adj || "-",
                    stockAfter,
                    h.notes || "-",
                ];
            }),
        });
        doc.save(`Inventory_History_${data.productId?.code || ""}.pdf`);
    }, [data, formatDateTime]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <LoaderSpinner />
            </div>
        );
    }

    if (notFound || !data) {
        return (
            <div className="space-y-4">
                <PageHeader title="Inventory Item">
                    <Button variant="white" onClick={() => navigate("/admin/inventory")}>Back</Button>
                </PageHeader>
                <Card>
                    <div className="py-10 text-center text-gray-500">Inventory item not found.</div>
                </Card>
            </div>
        );
    }

    const currency = data.currencyCode;
    const current = Number(data.currentQuantity ?? 0);
    const qtyOnHand = data.quantityOnHand != null ? Number(data.quantityOnHand) : null;
    const avgCost = data.avgCost != null ? Number(data.avgCost) : null;
    const alertQty = data.alertQuantity != null ? Number(data.alertQuantity) : null;
    const stockForValue = qtyOnHand != null ? qtyOnHand : current;
    const stockValue = avgCost != null ? stockForValue * avgCost : null;
    const isLowStock = alertQty != null && current <= alertQty;

    const detail = (label: string, value: React.ReactNode) => (
        <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
            <div className="text-sm font-semibold text-gray-950">{value}</div>
        </div>
    );

    return (
        <div className="space-y-4">
            <PageHeader
                title={
                    <span className="inline-flex items-baseline gap-2">
                        <span className="capitalize">{data.productId?.name || "Inventory Item"}</span>
                        {data.productId?.code && (
                            <span className="text-sm font-normal text-gray-500">{data.productId.code}</span>
                        )}
                    </span>
                }
            >
                <Button
                    variant="white"
                    onClick={handleDownloadPDF}
                    leftIcon={<FileDownIcon size={14} />}
                >
                    Download PDF
                </Button>
                <Button variant="white" onClick={() => navigate("/admin/inventory")}>
                    Back
                </Button>
            </PageHeader>

            {/* Details */}
            <Card title="Stock Details">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {detail("Product", data.productId?.name || "—")}
                    {detail("Code", data.productId?.code || "—")}
                    {detail(
                        "Current Stock",
                        <span className="inline-flex items-center gap-2">
                            {qtyOnHand != null ? qtyOnHand : current}
                            {isLowStock && (
                                <Badge color="danger" variant="soft">
                                    Low stock
                                </Badge>
                            )}
                        </span>,
                    )}
                    {detail("Valuation Method", data.valuationMethod || "—")}
                    {detail("Average Cost", avgCost != null ? formatMoney(avgCost, currency) : "—")}
                    {detail("Stock Value", stockValue != null ? formatMoney(stockValue, currency) : "—")}
                    {detail("Alert / Low-stock Qty", alertQty != null ? alertQty : "—")}
                    {detail("Unit", data.productId?.unitName || "—")}
                </div>
            </Card>

            {/* Activity History */}
            <Card title="Activity History" padded={false}>
                <div className="overflow-x-auto border border-border rounded-control">
                    <table className="w-full text-sm border-collapse">
                        <thead className="bg-gray-100 text-xs uppercase text-body">
                            <tr>
                                <th className="px-4 py-3 text-left border-b border-border">Date</th>
                                <th className="px-4 py-3 text-left border-b border-border">Type</th>
                                <th className="px-4 py-3 text-center border-b border-border">Adjustment</th>
                                <th className="px-4 py-3 text-center border-b border-border">Stock After</th>
                                <th className="px-4 py-3 text-left border-b border-border">Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.history.length === 0 ? (
                                <NoRecords colSpan={5} message="No activity history found." />
                            ) : (
                                data.history.map((h) => {
                                    const adj = Number(h.adjustment ?? 0);
                                    const stockAfter = Number(h.quantity ?? 0) + adj;
                                    return (
                                        <tr key={h.id} className="border-b border-border hover:bg-gray-50">
                                            <td className="px-4 py-3 text-gray-600">{formatDateTime(h.createdAt)}</td>
                                            <td className="px-4 py-3 text-gray-600 capitalize">{refTypeLabel(h.referenceType, h.notes)}</td>
                                            <td className="px-4 py-3 text-center">{getAdjustmentDisplay(adj)}</td>
                                            <td className="px-4 py-3 text-gray-950 font-medium text-center">{stockAfter}</td>
                                            <td className="px-4 py-3 text-gray-600">{h.notes || "—"}</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export default InventoryView;
