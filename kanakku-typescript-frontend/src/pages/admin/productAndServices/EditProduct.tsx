import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import Constants from '../../../constants/api';
import ProductForm from './ProductForm';
import { toast } from "sonner";
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { PageHeader } from "@/context/PageHeaderContext";

// --- Type Definitions ---

// Defines the shape of the product data fetched from the API
interface IProduct {
    id: string;
    name: string;
    code: string;
    category?: { id: string };
    brand?: { id: string };
    unit?: { id: string };
    selling_price: number;
    purchase_price: number;
    discount_type: 'Fixed' | 'Percentage';
    discount_value: number;
    taxGroup?: { id: string };
    tax_rate?: { taxRateId: string | null; name: string; rate: number } | null;
    barcode: string;
    alert_quantity: number;
    description: string;
    product_image: string;
    gallery_images: string[];
}

// Defines the expected URL parameters
type ProductParams = {
    id: string;
};


// --- Component ---

export default function EditProduct() {
    // Type the `useParams` hook to ensure `id` is a string
    const { id } = useParams<ProductParams>();

    // Type the product state to be either IProduct or null
    const [product, setProduct] = useState<IProduct | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const { token } = useSelector((state: RootState) => state.auth);

    useEffect(() => {
        const fetchProduct = async () => {
            try {
                // Type the axios response to expect an IProduct object
                const response = await axios.get<IProduct>(`${Constants.GET_PRODUCT_URL}/${id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                setProduct(response.data);
            } catch (error) {
                console.error("Failed to fetch product data:", error);
                toast.error("Could not load item data.");
            } finally {
                setLoading(false);
            }
        };

        if (id) {
            fetchProduct();
        }
    }, [id, token]);

    if (loading) {
        return <div className="flex items-center justify-center h-screen"><LoaderSpinner /></div>;
    }

    if (!product) {
        return <div className="p-6 text-center text-red-500">Item not found.</div>;
    }

    return (
        <div className="p-4 bg-white border border-gray-200 rounded-lg ">
            <PageHeader title="Edit Item" />
            {/* Pass the typed product data to the form component */}
            <ProductForm productData={product} />
        </div>
    );
}