import Modal from "@components/admin/Modal";
import SearchableDropdown from "@components/admin/SearchableDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import Constants from "@constants/api";
import { useDebounce } from "@hooks/useDebounce";
import type { RootState } from "@store/index";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";

interface InventoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void
}

interface Options {
    id: string;
    name: string;
    code: string;
    unit: { id: string; name: string; } | null;
    prices: { selling: number; purchase: number; };
}

interface InventoryFormData {
    productId: string;
    quantity: number;
    type: string;
    notes: string | null;
}

const initialFormData: InventoryFormData = { productId: '', quantity: 0, type: '', notes: null };
const NewInventoryModal: React.FC<InventoryModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const [products, setProducts] = useState<Options[]>([]);
    const [productSearchInput, setProductSearchInput] = useState<string>("");
    const [selectedProduct, setSelectedProduct] = useState<Options | null>(null);
    const [formData, setFormData] = useState<InventoryFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const debouncedSearchTerm = useDebounce(productSearchInput, 500);
    const [isSubmitting, setIsSubmitting] = useState(false);
    useEffect(() => {
        setSelectedProduct(null);
        setProductSearchInput('');
        setFormErrors({});
        setFormData(initialFormData);
    }, [isOpen]);

    useEffect(() => {
        const fetchProductsByQuery = async () => {
            try {
                const response = await axios.get(`${Constants.FETCH_PRODUCTS_WITH_SEARCH_URL}?search=${debouncedSearchTerm}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                setProducts(response.data.data);
            } catch (error) {
                console.error('Error fetching products:', error);
                setProducts([]);
            }
        }

        fetchProductsByQuery();
    }, [debouncedSearchTerm]);

    const validateForm = () => {
        const errors: { [key: string]: string } = {};
        if (!selectedProduct) {
            errors.product = 'Product/Service is required';
        }
        if (formData.quantity <= 0) {
            errors.quantity = 'Quantity must be greater than 0';
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;
        try {
            setIsSubmitting(true);
            const payload = {
                ...formData,
                productId: selectedProduct?.id || '',
                type: 'stock_in',
            };
            await axios.post(Constants.UPDATE_INVENTORY_URL, payload, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Inventory created successfully');
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Error creating inventory:', error);
        } finally {
            setIsSubmitting(false);
        }
    }
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add Inventory">
            <form onSubmit={handleSubmit}>
                <div className="mb-4">
                    <label htmlFor="product" className="block text-gray-700  font-semibold mb-2">Product/Service <em className="text-red-500">*</em></label>
                    <SearchableDropdown
                        options={products}
                        placeholder="Type to search..."
                        onInputChange={(_, value) => setProductSearchInput(value)}
                        onChange={(_, value) => setSelectedProduct(value as Options)}
                        value={selectedProduct}
                    />
                    {formErrors.product && <p className="text-red-500 text-sm mt-1">{formErrors.product}</p>}
                </div>
                <div className="flex gap-4">
                    <div className="mb-4 w-1/2">
                        <label className="block text-gray-700  font-semibold mb-2">Code</label>
                        <input
                            type="text"
                            value={selectedProduct?.code || ''}
                            readOnly
                            className="border border-gray-300 bg-gray-100 mt-1 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                        />
                    </div>
                    <div className="mb-4 w-1/2">
                        <label className="block text-gray-700  font-semibold mb-2">Unit</label>
                        <input
                            type="text"
                            value={selectedProduct?.unit?.name || ''}
                            readOnly
                            className="border border-gray-300 bg-gray-100 mt-1 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                        />
                    </div>
                </div>
                <div className="flex gap-4">
                    <div className="mb-4 w-1/2">
                        <label className="block text-gray-700  font-semibold mb-2">Purchase Price </label>
                        <input
                            type="text"
                            value={selectedProduct?.prices?.purchase || ''}
                            readOnly
                            className="border border-gray-300 bg-gray-100 mt-1 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                        />
                    </div>
                    <div className="mb-4 w-1/2">
                        <label className="block text-gray-700  font-semibold mb-2">Selling Price </label>
                        <input
                            type="text"
                            value={selectedProduct?.prices?.selling || ''}
                            readOnly
                            className="border border-gray-300 bg-gray-100 mt-1 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                        />
                    </div>
                </div>
                <div className="mb-4">
                    <label htmlFor="type" className="block text-gray-700  font-semibold mb-2">Type <em className="text-red-500">*</em></label>
                    <input
                        type="text"
                        value={`Stock In`}
                        readOnly
                        className="border border-gray-300 bg-gray-100 mt-1 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                    />
                    {formErrors.type && <span className="text-red-500 text-sm">{formErrors.type}</span>}
                </div>
                <div className="mb-4">
                    <label htmlFor="quantity" className="block text-gray-700  font-semibold mb-2">Quantity <em className="text-red-500">*</em></label>
                    <input
                        type="number"
                        id="quantity"
                        name="quantity"
                        value={formData.quantity}
                        onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
                        className="border border-gray-300 mt-1 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                    />
                    {formErrors.quantity && <span className="text-red-500 text-sm">{formErrors.quantity}</span>}
                </div>
                <div className="flex justify-end gap-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-950 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                    >
                        Cancel
                    </button>
                    <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode="create" />
                </div>
            </form>
        </Modal>
    );
}

export default NewInventoryModal;