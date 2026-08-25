import Modal from "@components/admin/Modal";
import Constants from "@constants/api";
import type { Product, ProductFormData } from "@models/product";
import type { TaxRate } from "@models/taxRate";
import type { RootState } from "@store/index";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import SubmitButton from "./SubmitButton";
import { useDebounce } from "@hooks/useDebounce";
import SmartDropdown from "./SmartDropdown";
import type { OptionType } from "@models/common";
import { validateProductForm } from "@utils/productValidation";

interface Props { //return new product data onSuccess
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (newProduct: Product) => void;
}

const NO_UNIT: OptionType = { id: '', name: '-no unit-' };

const initialFormData: ProductFormData = {
    name: '',
    unit: '',
    description: '',
    selling_price: '',
    taxRateId: '',
}

const CreateProductForm: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<ProductFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [units, setUnits] = useState<OptionType[]>([]);
    const [taxes, setTaxes] = useState<OptionType[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [unitSearchInput, setUnitSearchInput] = useState<string>('');
    const debouncedUnitSearch = useDebounce(unitSearchInput, 500);
    const [taxSearchInput, setTaxSearchInput] = useState<string>('');
    const debouncedTaxSearch = useDebounce(taxSearchInput, 500);

    useEffect(() => {
        if (isOpen) {
            setFormData(initialFormData);
            setFormErrors({});
        }
    }, [isOpen]);

    useEffect(() => {
        const fetchUnitsByQuery = async () => {
            if (!isOpen) return;
            const headers = { 'Authorization': `Bearer ${token}` };
            try {
                const response = await axios.get(`${Constants.FETCH_PRODUCT_UNITS_URL}?search=${debouncedUnitSearch}`, { headers });
                const formattedUnits = response.data.data.map((unit: { id: string; unitName: string }) => ({
                    id: unit.id,
                    name: unit.unitName
                }));
                setUnits(formattedUnits);
            } catch (error) {
                console.error("Failed to fetch units:", error);
                toast.error("Failed to load required data for the form.");
            }
        }
        fetchUnitsByQuery();
    }, [debouncedUnitSearch, isOpen]);

    useEffect(() => {
        const fetchTaxesByQuery = async () => {
            if (!isOpen) return;
            const headers = { 'Authorization': `Bearer ${token}` };
            try {
                const response = await axios.get(
                    `${Constants.GET_TAX_RATES_FOR_LIST_URL}?limit=100&isActive=true&search=${debouncedTaxSearch}`,
                    { headers },
                );
                const rows: TaxRate[] = response.data?.data?.taxRates ?? [];
                setTaxes(rows.map((r) => ({ id: r.id, name: `${r.name} (${Number(r.rate)}%)` })));
            } catch (error) {
                console.error("Failed to fetch taxes:", error);
                toast.error("Failed to load required data for the form.");
            }
        }
        fetchTaxesByQuery();
    }, [debouncedTaxSearch, isOpen]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, type, value } = e.target;
        const finalValue = type === 'number' ? (value === '' ? '' : Number(value)) : value;
        setFormData(prev => ({ ...prev, [name]: finalValue }));
        setFormErrors(prev => ({ ...prev, [name]: '' }));
    };

    const validateForm = () => {
        const newErrors = validateProductForm({
            name: formData.name, unit: formData.unit,
            selling_price: formData.selling_price, purchase_price: '',
            enable_inventory: false, stock: 0,
        });
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;
        try {
            setIsSubmitting(true);
            const payloadFormData = new FormData();
            payloadFormData.append('name', formData.name);
            payloadFormData.append('unit', formData.unit); // '' → no unit (C2)
            if (formData.description) payloadFormData.append('description', formData.description);
            if (formData.selling_price !== '') payloadFormData.append('selling_price', String(formData.selling_price));
            if (formData.taxRateId) payloadFormData.append('taxRateId', formData.taxRateId);
            const response = await axios.post(Constants.CREATE_PRODUCT_URL, payloadFormData, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            toast.success("Item created successfully!");
            onSuccess(response.data.data || {});
        } catch (error: any) {
            if (error.response && error.response.status === 422) {
                setFormErrors(error.response.data.errors);
            } else {
                toast.error(error.response?.data?.message || "An unexpected error occurred.");
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} title="New Item" size="3xl">
                <form onSubmit={handleSubmit}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                        {/* Name */}
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-red-500">Name *</label>
                            <input type="text" name="name" id="name" maxLength={255} value={formData.name} onChange={handleInputChange} className="mt-1 block text-gray-700 p-2 w-full border border-gray-300 rounded-md " />
                            {formErrors.name && <p className="text-red-500 text-xs mt-1">{formErrors.name}</p>}
                        </div>

                        {/* Unit */}
                        <div>
                            <label htmlFor="unit" className="block text-sm font-medium text-gray-700">Unit</label>
                            <SmartDropdown
                                items={[NO_UNIT, ...units]}
                                value={unitSearchInput}
                                onChange={(value) => setUnitSearchInput(value)}
                                onSelect={(selected) => setFormData(prev => ({ ...prev, unit: (selected?.id || '') as string }))}
                                placeholder="-no unit-"
                                selectedItem={units.find(unit => unit.id === formData.unit) || NO_UNIT}
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
                            <textarea name="description" id="description" rows={2} value={formData.description} onChange={handleInputChange} className="mt-1 block text-gray-700 p-2 w-full border border-gray-300 rounded-md " />
                        </div>

                        {/* Unit Price */}
                        <div>
                            <label htmlFor="selling_price" className="block text-sm font-medium text-gray-700">Unit Price</label>
                            <input type="number" name="selling_price" id="selling_price" min="0" value={formData.selling_price} onChange={handleInputChange} className="mt-1 text-gray-700 p-2 block w-full border border-gray-300 rounded-md " />
                            {formErrors.selling_price && <p className="text-red-500 text-xs mt-1">{formErrors.selling_price}</p>}
                        </div>

                        {/* Tax */}
                        <div>
                            <label htmlFor="tax" className="block text-sm font-medium text-gray-700">Tax</label>
                            <SmartDropdown
                                items={taxes}
                                value={taxSearchInput}
                                onChange={(value) => setTaxSearchInput(value)}
                                onSelect={(selected) => setFormData(prev => ({ ...prev, taxRateId: (selected?.id || '') as string }))}
                                placeholder="No Tax"
                                selectedItem={taxes.find(tax => tax.id === formData.taxRateId) || null}
                            />
                            {formErrors.taxRateId && <p className="text-red-500 text-xs mt-1">{formErrors.taxRateId}</p>}
                        </div>
                    </div>
                    <div className="flex justify-end space-x-4 pt-6">
                        <button type="button" onClick={onClose} className="px-6 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                        <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode='create' />
                    </div>
                </form>
            </Modal>
        </>
    );
};

export default CreateProductForm;
