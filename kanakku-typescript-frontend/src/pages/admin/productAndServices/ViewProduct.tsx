import { useEffect, useState } from 'react';
import type { FC, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';
import { ArrowLeft, Edit } from 'lucide-react';
import Constants from '@constants/api';
import type { RootState } from '@store/index';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Card, Badge } from '@components/ui';
import { useCurrencies } from '@hooks/useCurrencies';
import { hasPermission } from '@utils/hasPermission';

// Shape of the GET /admin/products/:id response (returned at response.data — not wrapped in `data`).
interface IProductView {
    id: string;
    item_type: 'Product' | 'Service';
    name: string;
    code?: string | null;
    category?: { category_name?: string | null } | null;
    brand?: { brand_name?: string | null } | null;
    unit?: { unit_name?: string | null; short_name?: string | null } | null;
    selling_price?: number | string | null;
    purchase_price?: number | string | null;
    discount_type?: 'Fixed' | 'Percentage' | null;
    discount_value?: number | string | null;
    taxGroup?: { tax_name?: string | null } | null;
    tax_rate?: { taxRateId: string | null; name: string; rate: number } | null;
    barcode?: string | null;
    alert_quantity?: number | string | null;
    enable_inventory?: boolean | null;
    stock?: number | string | null;
    description?: string | null;
    product_image?: string | null;
    gallery_images?: string[] | null;
    valuationMethod?: 'WAC' | 'FIFO' | null;
    currencyCode?: string | null;
}

type ProductParams = { id: string };

// Render "—" for empty/blank values.
const orDash = (value: ReactNode): ReactNode => {
    if (value === null || value === undefined || value === '') return '—';
    return value;
};

const DetailItem: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
    <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
        <dd className="mt-1 text-sm text-gray-900">{children}</dd>
    </div>
);

const ViewProduct: FC = () => {
    const { id } = useParams<ProductParams>();
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatMoney } = useCurrencies();

    const [product, setProduct] = useState<IProductView | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const fetchProduct = async () => {
            try {
                setLoading(true);
                // getProductById returns the product object directly at response.data.
                const response = await axios.get<IProductView>(`${Constants.GET_PRODUCT_URL}/${id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                setProduct(response.data);
            } catch (error) {
                console.error('Failed to fetch product data:', error);
                toast.error('Could not load item data.');
                setProduct(null);
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchProduct();
    }, [id, token]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <LoaderSpinner />
            </div>
        );
    }

    if (!product) {
        return (
            <>
                <PageHeader title="Item">
                    <Button
                        variant="secondary"
                        leftIcon={<ArrowLeft size={14} />}
                        onClick={() => navigate('/admin/products')}
                    >
                        Back
                    </Button>
                </PageHeader>
                <div className="p-6 text-center text-red-500">Item not found.</div>
            </>
        );
    }

    const currencyCode = product.currencyCode;
    const gallery = product.gallery_images ?? [];
    const discount =
        product.discount_value !== null &&
        product.discount_value !== undefined &&
        product.discount_value !== ''
            ? product.discount_type === 'Percentage'
                ? `${Number(product.discount_value)}%`
                : formatMoney(Number(product.discount_value), currencyCode)
            : null;

    return (
        <div className="space-y-4">
            <PageHeader title={product.name || 'Item'}>
                {hasPermission(permissions, 'product-services', 'edit') && (
                    <Button
                        leftIcon={<Edit size={14} />}
                        onClick={() => navigate(`/admin/products/edit/${product.id}`)}
                    >
                        Edit
                    </Button>
                )}
                <Button
                    variant="secondary"
                    leftIcon={<ArrowLeft size={14} />}
                    onClick={() => navigate('/admin/products')}
                >
                    Back
                </Button>
            </PageHeader>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Images */}
                <Card title="Images" className="lg:col-span-1">
                    <div className="space-y-4">
                        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-2">
                            {product.product_image ? (
                                <img
                                    src={product.product_image}
                                    alt={product.name}
                                    className="max-h-56 w-auto object-contain"
                                />
                            ) : (
                                <span className="py-16 text-sm text-gray-400">No image</span>
                            )}
                        </div>
                        {gallery.length > 0 && (
                            <div className="grid grid-cols-4 gap-2">
                                {gallery.map((img, idx) => (
                                    <img
                                        key={idx}
                                        src={img}
                                        alt={`${product.name} ${idx + 1}`}
                                        className="h-16 w-full rounded-md border border-gray-200 object-cover"
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </Card>

                {/* Details */}
                <Card title="Details" className="lg:col-span-2">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                        <DetailItem label="Inventory">
                            <Badge color={product.enable_inventory ? 'success' : 'gray'}>
                                {product.enable_inventory ? 'Tracked' : 'Not tracked'}
                            </Badge>
                        </DetailItem>
                        <DetailItem label="Code">{orDash(product.code)}</DetailItem>
                        <DetailItem label="Barcode">{orDash(product.barcode)}</DetailItem>
                        <DetailItem label="Category">
                            {orDash(product.category?.category_name)}
                        </DetailItem>
                        <DetailItem label="Brand">{orDash(product.brand?.brand_name)}</DetailItem>
                        <DetailItem label="Unit">
                            {orDash(product.unit?.unit_name ?? product.unit?.short_name)}
                        </DetailItem>
                        <DetailItem label="Selling Price">
                            {product.selling_price !== null && product.selling_price !== undefined
                                ? formatMoney(Number(product.selling_price), currencyCode)
                                : '—'}
                        </DetailItem>
                        <DetailItem label="Purchase Price">
                            {product.purchase_price !== null && product.purchase_price !== undefined
                                ? formatMoney(Number(product.purchase_price), currencyCode)
                                : '—'}
                        </DetailItem>
                        <DetailItem label="Discount">{orDash(discount)}</DetailItem>
                        <DetailItem label="Tax">
                            {orDash(product.tax_rate ? `${product.tax_rate.name} (${product.tax_rate.rate}%)` : product.taxGroup?.tax_name)}
                        </DetailItem>
                        <DetailItem label="Valuation Method">
                            {orDash(product.valuationMethod)}
                        </DetailItem>
                    </dl>
                </Card>
            </div>

            {/* Inventory */}
            {product.enable_inventory && (
                <Card title="Inventory">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                        <DetailItem label="Current Stock">
                            {product.stock !== null && product.stock !== undefined
                                ? Number(product.stock)
                                : '—'}
                        </DetailItem>
                        <DetailItem label="Alert Quantity">
                            {product.alert_quantity !== null && product.alert_quantity !== undefined
                                ? Number(product.alert_quantity)
                                : '—'}
                        </DetailItem>
                    </dl>
                </Card>
            )}

            {/* Description */}
            <Card title="Description">
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {product.description ? product.description : '—'}
                </p>
            </Card>
        </div>
    );
};

export default ViewProduct;
