import api from '@lib/apiClient';
import { useEffect, useState } from "react";
import Constants from "../../../constants/api";

import Table from "../../../components/admin/Table";
import { toast } from "sonner";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import SearchableDropdown from "@components/admin/SearchableDropdown";
import useDateFormatter from "@hooks/useDateFormatter";
import type { SyntheticEvent } from "react";
import { PageHeader } from "@/context/PageHeaderContext";

import { EmptyStateRow } from "@components/ui";

interface IProduct {
    id: string;
    name: string;
}

interface ICostLayer {
    id: string;
    qtyRemaining: number;
    unitCost: number;
    receivedAt: string;
}

const CostLayers: React.FC = () => {
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { formatDate } = useDateFormatter();

    const [products, setProducts] = useState<IProduct[]>([]);
    const [selectedProduct, setSelectedProduct] = useState<IProduct | null>(null);
    const [layers, setLayers] = useState<ICostLayer[]>([]);
    const [isLoadingProducts, setIsLoadingProducts] = useState(false);
    const [isLoadingLayers, setIsLoadingLayers] = useState(false);

    const authHeaders = {};
    const dateFormat = systemSettings?.dateFormat?.format || "d-m-Y";

    const fetchProducts = async () => {
        try {
            setIsLoadingProducts(true);
            const response = await api.get(Constants.FETCH_PRODUCTS_URL, {
                params: { limit: 500 },
                headers: authHeaders
            });
            const data = response.data.data?.products || response.data.data || [];
            setProducts(
                (Array.isArray(data) ? data : []).map((p: any) => ({ id: p.id, name: p.name }))
            );
        } catch {
            toast.error("Failed to load products.");
        } finally {
            setIsLoadingProducts(false);
        }
    };

    const fetchLayers = async (productId: string) => {
        try {
            setIsLoadingLayers(true);
            setLayers([]);
            const response = await api.get(Constants.FETCH_COST_LAYERS_URL, {
                params: { productId },
                headers: authHeaders
            });
            setLayers(response.data.data || []);
        } catch {
            toast.error("Failed to load cost layers.");
        } finally {
            setIsLoadingLayers(false);
        }
    };

    useEffect(() => { fetchProducts(); }, []);

    const handleProductChange = (_e: SyntheticEvent, val: IProduct | null) => {
        setSelectedProduct(val);
        if (val) {
            fetchLayers(val.id);
        } else {
            setLayers([]);
        }
    };

    const tableHeaders = ["#", "Qty Remaining", "Unit Cost", "Received At"];

    return (
        <div className="space-y-6">
            <PageHeader title="FIFO Cost Layers" />

            <div className="bg-card border border-gray-200 rounded-lg p-4 space-y-2">
                <p className="text-sm text-gray-700">Select a product to view its FIFO cost layers (inventory valuation buckets).</p>
                <div className="max-w-sm">
                    <SearchableDropdown
                        label="Product"
                        required
                        value={selectedProduct}
                        options={products}
                        onChange={handleProductChange}
                        placeholder="Select a product"
                        loading={isLoadingProducts}
                    />
                </div>
            </div>

            {selectedProduct && (
                <div className="space-y-2">
                    <h2 className="text-base font-semibold text-gray-700">
                        Layers for <span className="text-primary">{selectedProduct.name}</span>
                        {layers.length > 0 && (
                            <span className="ml-2 text-sm font-normal text-gray-700">
                                — Total Qty: {layers.reduce((sum, l) => sum + l.qtyRemaining, 0).toLocaleString()}
                            </span>
                        )}
                    </h2>

                    <Table headers={tableHeaders}>
                        {!isLoadingLayers && layers.length > 0 &&
                            layers.map((layer, index) => (
                                <tr key={layer.id} className="hover:bg-gray-50 border-b border-gray-100">
                                    <td className="px-4 py-2 text-sm text-gray-700">{index + 1}</td>
                                    <td className="px-4 py-2 text-sm text-gray-900 font-medium">{Number(layer.qtyRemaining).toLocaleString()}</td>
                                    <td className="px-4 py-2 text-sm text-gray-900">{Number(layer.unitCost).toLocaleString()}</td>
                                    <td className="px-4 py-2 text-sm text-gray-700">{formatDate(layer.receivedAt, dateFormat)}</td>
                                </tr>
                            ))
                        }
                        {!isLoadingLayers && layers.length === 0 && (
                            <EmptyStateRow colSpan={4} art="empty" title="No Cost Layers Found" />
                        )}
                        {isLoadingLayers && (
                            <tr key="loader"><td className="text-center py-2 font-semibold" colSpan={4}><LoaderSpinner /></td></tr>
                        )}
                    </Table>
                </div>
            )}

            {!selectedProduct && (
                <div className="text-center py-12 text-gray-600 text-sm">
                    Select a product above to see its FIFO cost layers.
                </div>
            )}
        </div>
    );
};

export default CostLayers;
