import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Constants from '../../../constants/api';
import { toast } from "sonner";
import { Upload, X } from 'lucide-react';
import { useSelector } from 'react-redux';
import ImageCropperUpload from '@components/common/ImageCropperUpload';
import type { RootState } from '../../../store';
import SubmitButton from '@components/admin/SubmitButton';
import { useDebounce } from '@hooks/useDebounce';
import SmartDropdown from '@components/admin/SmartDropdown';
import CreateCategoryModal from './CreateCategoryModal';
import CreateBrandModal from './CreateBrandModal';
import CreateUnitModal from './CreateUnitModal';
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import DynamicCustomFields from '@components/admin/DynamicCustomFields';
import { Button } from '@components/ui';
import type { ProductTaxRate } from '@models/product';
import type { TaxRate } from '@models/taxRate';
import { validateProductForm } from '@utils/productValidation';
import {
    generateProductCode as generateNewProductCode,
    generateRandomBarcode as generateNewBarcode,
} from '@utils/productGenerators';

interface OptionType {
    id: string;
    name: string;
}
// For the main product data object (used in props)
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
    tax_rate?: ProductTaxRate | null;
    barcode: string;
    alert_quantity: number;
    enable_inventory?: boolean;
    stock?: number;
    description: string;
    product_image?: string;
    gallery_images?: string[];
    valuationMethod?: 'WAC' | 'FIFO';
    currencyCode?: string;
    customFields?: Record<string, any>;
}

// For the component's props
interface ProductFormProps {
    productData?: IProduct;
}

// For the form's state
interface IFormData {
    name: string;
    code: string;
    category: string;
    brand: string;
    unit: string;
    selling_price: string | number;
    purchase_price: string | number;
    discount_type: 'Fixed' | 'Percentage';
    discount_value: number;
    taxRateId: string;
    barcode: string;
    alert_quantity: string | number;
    enable_inventory: boolean;
    stock: string | number;
    description: string;
    images_to_remove?: string[];
    productImageUrl?: string;
    valuationMethod: 'WAC' | 'FIFO';
    currencyCode: string;
}

// For form validation errors
type FormErrors = Partial<Record<keyof IFormData | 'product_image', string>>;

// Sentinel so the Unit dropdown can represent "no unit chosen" as a real,
// selectable, clearable row instead of an empty placeholder state.
const NO_UNIT = { id: '', name: '-no unit-' };

// --- Component ---

export default function ProductForm({ productData }: ProductFormProps) {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const isEditMode = Boolean(productData);
    const { defaultCurrencyCode } = useCurrencies();

    const [formData, setFormData] = useState<IFormData>({
        name: '',
        code: '',
        category: '',
        brand: '',
        unit: '',
        selling_price: '',
        purchase_price: '',
        discount_type: 'Fixed',
        discount_value: 0,
        taxRateId: '',
        barcode: '',
        alert_quantity: 0,
        enable_inventory: false,
        stock: 0,
        description: '',
        valuationMethod: 'WAC',
        currencyCode: defaultCurrencyCode,
    });

    const [productImage, setProductImage] = useState<File | null>(null);
    const [productImagePreview, setProductImagePreview] = useState<string>('');
    const [galleryImages, setGalleryImages] = useState<File[]>([]);
    const [galleryImagePreviews, setGalleryImagePreviews] = useState<string[]>([]);
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Set by the "Create & Add Another" button's onClick, read once at the top
    // of handleSubmit — see the comment there for why this is a ref, not state.
    const addAnotherRef = useRef(false);
    // Dynamic data states
    const [categories, setCategories] = useState<OptionType[]>([]);
    const [brands, setBrands] = useState<OptionType[]>([]);
    const [units, setUnits] = useState<OptionType[]>([]);
    const [taxes, setTaxes] = useState<OptionType[]>([]);
    const [categorySearchInput, setCategorySearchInput] = useState<string>('');
    const debouncedCategorySearch = useDebounce(categorySearchInput, 500);
    const [brandSearchInput, setBrandSearchInput] = useState<string>('');
    const debouncedBrandSearch = useDebounce(brandSearchInput, 500);
    const [unitSearchInput, setUnitSearchInput] = useState<string>('');
    const debouncedUnitSearch = useDebounce(unitSearchInput, 500);
    const [taxSearchInput, setTaxSearchInput] = useState<string>('');
    const debouncedTaxSearch = useDebounce(taxSearchInput, 500);
    const [isCategoryCreateModalOpen, setIsCategoryCreateModalOpen] = useState(false);
    const [isCreateBrandModalOpen, setIsCreateBrandModalOpen] = useState(false);
    const [isCreateUnitModalOpen, setIsCreateUnitModalOpen] = useState(false);
    const [customFields, setCustomFields] = useState<Record<string, any>>({});
    const [activeCustomFields, setActiveCustomFields] = useState<any[]>([]);

    const handleCustomFieldChange = (fieldSlugOrId: string, value: any) => {
        setCustomFields(prev => ({ ...prev, [fieldSlugOrId]: value }));
    };

    useEffect(() => {
        const fetchCategoriesByQuery = async () => {
            const headers = { 'Authorization': `Bearer ${token}` };
            try {
                const response = await axios.get(`${Constants.FETCH_PRODUCT_CATEGORIES_URL}?search=${debouncedCategorySearch}`, { headers });
                const formattedCategories = response.data.data.map((category: any) => ({
                    id: category.id,
                    name: category.categoryName
                }));
                setCategories(formattedCategories);
            } catch (error) {
                console.error("Failed to fetch categories:", error);
                toast.error("Failed to load required data for the form.");
            }
        }
        fetchCategoriesByQuery();
    }, [debouncedCategorySearch]);

    useEffect(() => {
        const fetchBrandsByQuery = async () => {
            const headers = { 'Authorization': `Bearer ${token}` };
            try {
                const response = await axios.get(`${Constants.FETCH_PRODUCT_BRANDS_URL}?search=${debouncedBrandSearch}`, { headers });
                const formattedBrands = response.data.data.map((brand: any) => ({
                    id: brand.id,
                    name: brand.brandName
                }));
                setBrands(formattedBrands);
            } catch (error) {
                console.error("Failed to fetch brands:", error);
                toast.error("Failed to load required data for the form.");
            }
        }
        fetchBrandsByQuery();
    }, [debouncedBrandSearch]);

    useEffect(() => {
        const fetchUnitsByQuery = async () => {
            const headers = { 'Authorization': `Bearer ${token}` };
            try {
                const response = await axios.get(`${Constants.FETCH_PRODUCT_UNITS_URL}?search=${debouncedUnitSearch}`, { headers });
                const formattedUnits = response.data.data.map((unit: any) => ({
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
    }, [debouncedUnitSearch]);

    const [taxRateRows, setTaxRateRows] = useState<TaxRate[]>([]);
    useEffect(() => {
        const fetchTaxesByQuery = async () => {
            const headers = { 'Authorization': `Bearer ${token}` };
            try {
                const response = await axios.get(
                    `${Constants.GET_TAX_RATES_FOR_LIST_URL}?limit=100&isActive=true&search=${debouncedTaxSearch}`,
                    { headers },
                );
                const rows: TaxRate[] = response.data?.data?.taxRates ?? [];
                setTaxRateRows(rows);
                setTaxes(rows.map((r) => ({ id: r.id, name: `${r.name} (${Number(r.rate)}%)` })));
            } catch (error) {
                console.error("Failed to fetch taxes:", error);
                toast.error("Failed to load required data for the form.");
            }
        }
        fetchTaxesByQuery();
    }, [debouncedTaxSearch]);

    // Default the Tax dropdown to the tenant's "No Tax" (0% NONE) rate on create.
    useEffect(() => {
        if (isEditMode || formData.taxRateId || taxRateRows.length === 0) return;
        const noTax = taxRateRows.find((r) => Number(r.rate) === 0 && r.regime === 'NONE');
        if (noTax) setFormData(prev => prev.taxRateId ? prev : { ...prev, taxRateId: noTax.id });
    }, [taxRateRows, isEditMode]);

    // Sync defaultCurrencyCode into the form once it resolves (create mode only)
    useEffect(() => {
        if (!isEditMode && defaultCurrencyCode) {
            setFormData(prev => ({
                ...prev,
                currencyCode: prev.currencyCode || defaultCurrencyCode,
            }));
        }
    }, [defaultCurrencyCode, isEditMode]);

    // Populate form if in edit mode
    useEffect(() => {
        if (isEditMode && productData) {
            setFormData({
                name: productData.name || '',
                code: productData.code || '',
                category: productData.category?.id || '',
                brand: productData.brand?.id || '',
                unit: productData.unit?.id || '',
                selling_price: productData.selling_price || '',
                purchase_price: productData.purchase_price || '',
                discount_type: productData.discount_type || 'Fixed',
                discount_value: productData.discount_value || 0,
                taxRateId: productData.tax_rate?.taxRateId ?? '',
                barcode: productData.barcode || '',
                alert_quantity: productData.alert_quantity || 0,
                enable_inventory: productData.enable_inventory || false,
                stock: productData.stock || 0,
                description: productData.description || '',
                images_to_remove: [],
                valuationMethod: productData.valuationMethod || 'WAC',
                currencyCode: productData.currencyCode || defaultCurrencyCode,
            });
            if (productData.product_image) {
                let _baseUrl = Constants.BASE_URL;
                if (_baseUrl.endsWith('/')) {
                    _baseUrl = _baseUrl.slice(0, -1);
                }
                setProductImagePreview(_baseUrl + productData.product_image);
            }
            if (productData.gallery_images) {
                // Avoid mutating the prop directly. Create a new array.
                let _baseUrl = Constants.BASE_URL;
                //remove last slash if present
                if (_baseUrl.endsWith('/')) {
                    _baseUrl = _baseUrl.slice(0, -1);
                }
                const fullImageUrls = productData.gallery_images.map(image => _baseUrl + image);
                setGalleryImagePreviews(fullImageUrls);
            }
            if (productData.customFields) {
                setCustomFields(productData.customFields);
            }
        }
    }, [isEditMode, productData]);


    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleCroppedProductImage = (file: File) => {
        setProductImage(file);
        setProductImagePreview(URL.createObjectURL(file));
    };

    const handleGalleryImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            setGalleryImages(prev => [...prev, ...files]);
            const newPreviews = files.map(file => URL.createObjectURL(file));
            setGalleryImagePreviews(prev => [...prev, ...newPreviews]);
        }
    };

    const removeGalleryImage = (indexToRemove: number) => {
        const imagePathToRemove = galleryImagePreviews[indexToRemove];
        setGalleryImages(prev => prev.filter((_, i) => i !== indexToRemove));
        setGalleryImagePreviews(prev => prev.filter((_, i) => i !== indexToRemove));
        setFormData(prev => ({
            ...prev,
            images_to_remove: [...(prev.images_to_remove || []), imagePathToRemove]
        }));
    };

    const generateProductCode = () => {
        const code = generateNewProductCode();
        setFormData(prev => ({ ...prev, code: code }));
    }
    const generateBarcode = () => {
        const barcode = generateNewBarcode();
        setFormData(prev => ({ ...prev, barcode: barcode }));
    }

    const prefillAutoGeneratedFields = () => {
        const updated = { ...formData };

        if (!updated.code) {
            updated.code = generateNewProductCode();
        }
        if (!updated.barcode) {
            updated.barcode = generateNewBarcode();
        }
        if (!updated.alert_quantity) {
            updated.alert_quantity = 0;
        }
        if (!updated.discount_value) {
            updated.discount_value = 0;
        }

        setFormData(updated);
        return updated;
    };

    const validateForm = (): boolean => {
        const errs = validateProductForm(formData);
        setFormErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // Captured (and cleared) immediately: the "Create & Add Another" button's
        // onClick sets addAnotherRef.current = true a tick before this handler runs
        // (click → implicit form submit, same synchronous pass). Reading a ref here
        // is deterministic; reading `addAnother` React state would race, since this
        // handleSubmit closure was created on the PRIOR render and would only ever
        // see the state value as of THAT render, not the value the click just queued.
        const wantsAddAnother = addAnotherRef.current;
        addAnotherRef.current = false;
        setFormErrors({});

        if (!validateForm()) return;

        const filledData = prefillAutoGeneratedFields();

        const submissionData = new FormData();
        Object.keys(filledData).forEach(key => {
            const formKey = key as keyof IFormData;
            const value = filledData[formKey];
            if (value !== undefined && value !== null) {
                submissionData.append(formKey, Array.isArray(value) ? JSON.stringify(value) : String(value));
            }
        });

        // taxRateId: '' means "no tax selected" on create (omit — nothing to
        // disconnect yet), but on edit it means "disconnect the tax rate" per C3,
        // so the empty string must reach the server there.
        if (!isEditMode && !filledData.taxRateId) {
            submissionData.delete('taxRateId');
        }

        if (productImage) {
            submissionData.append('product_image', productImage);
        }

        galleryImages.forEach(file => {
            submissionData.append('gallery_images', file);
        });

        // Append custom fields (slug→id resolved from loaded definitions)
        Object.entries(customFields)
            .filter(([, val]) => {
                if (val === undefined || val === null) return false;
                if (typeof val === 'string' && val.trim() === '') return false;
                if (Array.isArray(val) && val.length === 0) return false;
                return true;
            })
            .forEach(([fieldSlugOrId, val], index) => {
                const matchedField = activeCustomFields.find(f => f.fieldSlug === fieldSlugOrId || f.id === fieldSlugOrId);
                const finalFieldId = matchedField ? matchedField.id : fieldSlugOrId;
                submissionData.append(`customFields[${index}][fieldId]`, finalFieldId);
                if (Array.isArray(val)) {
                    submissionData.append(`customFields[${index}][value]`, val.join(','));
                } else if (val instanceof Date) {
                    const year = val.getFullYear();
                    const month = String(val.getMonth() + 1).padStart(2, '0');
                    const day = String(val.getDate()).padStart(2, '0');
                    submissionData.append(`customFields[${index}][value]`, `${year}-${month}-${day}`);
                } else if (val instanceof File) {
                    submissionData.append(`customField_${finalFieldId}`, val);
                } else {
                    submissionData.append(`customFields[${index}][value]`, String(val));
                }
            });

        try {
            setIsSubmitting(true);
            const config = { headers: { 'Authorization': `Bearer ${token}` } };
            if (isEditMode) {
                await axios.put(`${Constants.UPDATE_PRODUCT_URL}/${productData?.id}`, submissionData, config);
                toast.success("Item updated successfully!");
                navigate('/admin/products');
            } else {
                await axios.post(Constants.CREATE_PRODUCT_URL, submissionData, config);
                toast.success("Item created successfully!");
                if (wantsAddAnother) {
                    // The No-Tax default effect keys off [taxRateRows, isEditMode], neither
                    // of which changes on this reset, so it won't refire to re-default
                    // taxRateId — re-derive the same "No Tax" (0% NONE) row here instead.
                    const noTaxReset = taxRateRows.find((r) => Number(r.rate) === 0 && r.regime === 'NONE');
                    setFormData({ name: '', code: '', category: '', brand: '', unit: '', selling_price: '', purchase_price: '', discount_type: 'Fixed', discount_value: 0, taxRateId: noTaxReset?.id ?? '', barcode: '', alert_quantity: 0, enable_inventory: false, stock: 0, description: '', valuationMethod: 'WAC', currencyCode: defaultCurrencyCode });
                    setProductImage(null); setProductImagePreview(''); setGalleryImages([]); setGalleryImagePreviews([]); setCustomFields({}); setFormErrors({});
                } else {
                    navigate('/admin/products');
                }
            }
        } catch (error: any) {
            if (error.response && error.response.status === 422) {
                setFormErrors(error.response.data.errors);
                toast.error('Please review the highlighted fields.');
            } else {
                console.error("Submission failed:", error);
                toast.error(error.response?.data?.message || "An unexpected error occurred.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };


    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-4 bg-white">
                {/* --- Form Grid --- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ">
                    {/* Name */}
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-red-500">Name *</label>
                        <input type="text" name="name" id="name" maxLength={255} value={formData.name} onChange={handleInputChange} className="mt-1 block text-gray-700 p-2 w-full border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600" />
                        {formErrors.name && <p className="text-red-500 text-xs mt-1">{formErrors.name}</p>}
                    </div>

                    {/* Unit */}
                    <div>
                        <label htmlFor="unit" className="block text-sm font-medium text-gray-600">Unit</label>
                        <SmartDropdown
                            items={[NO_UNIT, ...units]}
                            value={unitSearchInput}
                            onChange={(value) => setUnitSearchInput(value)}
                            onSelect={(selected) => setFormData(prev => ({ ...prev, unit: (selected?.id || '') as string }))}
                            placeholder="Type to search unit..."
                            selectedItem={units.find(unit => unit.id === formData.unit) || NO_UNIT}
                            onAddNew={() => { setIsCreateUnitModalOpen(true) }}
                            addNewLabel='New Unit'
                        />
                        {formErrors.unit && <p className="text-red-500 text-xs mt-1">{formErrors.unit}</p>}
                    </div>

                    {/* Description */}
                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-gray-600">Description</label>
                        <textarea name="description" id="description" rows={2} value={formData.description} onChange={handleInputChange} className="mt-1 block text-gray-700 p-2 w-full border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600" />
                        {formErrors.description && <p className="text-red-500 text-xs mt-1">{formErrors.description}</p>}
                    </div>

                    {/* Unit Price */}
                    <div>
                        <label htmlFor="selling_price" className="block text-sm font-medium text-gray-600">Unit Price</label>
                        <input type="number" name="selling_price" id="selling_price" value={formData.selling_price} onChange={handleInputChange} className="mt-1 text-gray-700 p-2 block w-full focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 border border-gray-200 rounded-md " />
                        {formErrors.selling_price && <p className="text-red-500 text-xs mt-1">{formErrors.selling_price}</p>}
                    </div>

                    {/* Tax */}
                    <div>
                        <label htmlFor="tax" className="block text-sm font-medium text-gray-600">Tax</label>
                        <SmartDropdown
                            items={taxes}
                            value={taxSearchInput}
                            onChange={(value) => setTaxSearchInput(value)}
                            onSelect={(s) => setFormData(prev => ({ ...prev, taxRateId: (s?.id || '') as string }))}
                            placeholder="Type to search tax..."
                            selectedItem={taxes.find(t => t.id === formData.taxRateId) || (formData.taxRateId === '' && isEditMode && productData?.tax_rate ? { id: '', name: `${productData.tax_rate.name} (${productData.tax_rate.rate}%)` } : null)}
                        />
                        {formErrors.taxRateId && <p className="text-red-500 text-xs mt-1">{formErrors.taxRateId}</p>}
                    </div>
                </div>

                {/* --- More Options (optional fields) --- */}
                <details className="mt-2 rounded-md border border-gray-200 p-4">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700">More options</summary>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                        {/* Product Image */}
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">Product Image</label>
                            <ImageCropperUpload
                                value={productImagePreview || undefined}
                                aspect={1}
                                label="Upload Image"
                                onCropped={handleCroppedProductImage}
                            />
                            {formErrors.product_image && <p className="text-red-500 text-xs mt-1">{formErrors.product_image}</p>}
                        </div>

                        {/* Code */}
                        <div>
                            <label htmlFor="code" className="block text-sm font-medium text-gray-600">Code </label>
                            <div className="mt-1 flex">
                                <input type="text" name="code" id="code" value={formData.code} onChange={handleInputChange} className="flex-grow block text-gray-700 p-2 w-full border border-gray-200 rounded-l-md focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600" />
                                <button type="button" onClick={generateProductCode} className="px-3 py-2 bg-gray-200 text-gray-700 border border-l-0 border-gray-200 rounded-r-md hover:bg-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600">Generate</button>
                            </div>
                            {formErrors.code && <p className="text-red-500 text-xs mt-1">{formErrors.code}</p>}
                        </div>

                        {/* Category */}
                        <div>
                            <label htmlFor="category" className="block text-sm font-medium text-gray-600">Category</label>
                            <SmartDropdown
                                items={categories}
                                value={categorySearchInput}
                                onChange={(value) => setCategorySearchInput(value)}
                                onSelect={(selected) => setFormData(prev => ({ ...prev, category: (selected?.id || '') as string }))}
                                placeholder="Type to search category..."
                                selectedItem={categories.find(cat => cat.id === formData.category) || null}
                                onAddNew={() => { setIsCategoryCreateModalOpen(true) }}
                                addNewLabel='New Category'
                            />
                            {formErrors.category && <p className="text-red-500 text-xs mt-1">{formErrors.category}</p>}
                        </div>

                        {/* Brand */}
                        <div>
                            <label htmlFor="brand" className="block text-sm font-medium text-gray-600">Brand</label>
                            <SmartDropdown
                                items={brands}
                                value={brandSearchInput}
                                onChange={(value) => setBrandSearchInput(value)}
                                onSelect={(selected) => setFormData(prev => ({ ...prev, brand: (selected?.id || '') as string }))}
                                placeholder="Type to search brand..."
                                selectedItem={brands.find(brand => brand.id === formData.brand) || null}
                                onAddNew={() => { setIsCreateBrandModalOpen(true) }}
                                addNewLabel='New Brand'
                            />
                            {formErrors.brand && <p className="text-red-500 text-xs mt-1">{formErrors.brand}</p>}
                        </div>

                        {/* Purchase Price */}
                        <div>
                            <label htmlFor="purchase_price" className="block text-sm font-medium text-gray-600">Purchase Price</label>
                            <input type="number" name="purchase_price" id="purchase_price" value={formData.purchase_price} onChange={handleInputChange} className="mt-1 text-gray-700 p-2 block w-full focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 border border-gray-200 rounded-md " />
                            {formErrors.purchase_price && <p className="text-red-500 text-xs mt-1">{formErrors.purchase_price}</p>}
                        </div>

                        {/* Discount Type */}
                        <div>
                            <label htmlFor="discount_type" className="block text-sm font-medium text-gray-600">Discount Type</label>
                            <select name="discount_type" id="discount_type" value={formData.discount_type} onChange={handleInputChange} className="mt-1 text-gray-700 p-2 block w-full border border-gray-200 rounded-md ">
                                <option value="Fixed">Fixed</option>
                                <option value="Percentage">Percentage</option>
                            </select>
                            {formErrors.discount_type && <p className="text-red-500 text-xs mt-1">{formErrors.discount_type}</p>}
                        </div>

                        {/* Discount Value */}
                        <div>
                            <label htmlFor="discount_value" className="block text-sm font-medium text-gray-500">Discount Value </label>
                            <input type="number" name="discount_value" id="discount_value" value={formData.discount_value} onChange={handleInputChange} className="mt-1 text-gray-700 p-2 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 block w-full border border-gray-200 rounded-md " />
                            {formErrors.discount_value && <p className="text-red-500 text-xs mt-1">{formErrors.discount_value}</p>}
                        </div>

                        {/* Barcode */}
                        <div>
                            <label htmlFor="barcode" className="block text-sm font-medium text-gray-600">Barcode </label>
                            <div className="mt-1 flex">
                                <input type="text" name="barcode" id="barcode" value={formData.barcode} onChange={handleInputChange} className="flex-grow block text-gray-700 p-2 w-full focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 border border-gray-200 rounded-l-md " />
                                <button type="button" onClick={generateBarcode} className="px-3 py-2 bg-gray-200 text-gray-700 border border-l-0 border-gray-200 rounded-r-md hover:bg-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600">Generate</button>
                            </div>
                            {formErrors.barcode && <p className="text-red-500 text-xs mt-1">{formErrors.barcode}</p>}
                        </div>

                        {/* Track Inventory */}
                        <div className="flex items-center mt-6">
                            <label className="flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="enable_inventory"
                                    checked={formData.enable_inventory}
                                    onChange={(e) => setFormData(prev => ({ ...prev, enable_inventory: e.target.checked }))}
                                    className="h-4 w-4 text-purple-600 border-gray-200 rounded focus:ring-purple-600"
                                />
                                <span className="ml-2 text-sm text-gray-700">Track inventory in stock</span>
                            </label>
                        </div>

                        {/* Opening Stock, Alert Quantity, Valuation Method — only meaningful when tracking inventory */}
                        {formData.enable_inventory && (
                            <div>
                                <label htmlFor="stock" className="block text-sm font-medium text-gray-600">Opening stock quantity</label>
                                <input type="number" name="stock" id="stock" value={formData.stock} onChange={handleInputChange} className="mt-1 text-gray-700 p-2 block focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 w-full border border-gray-200 rounded-md " />
                                <p className="text-xs text-gray-400 mt-1">Creates an inventory record so this product appears in Inventory.</p>
                                {formErrors.stock && <p className="text-red-500 text-xs mt-1">{formErrors.stock}</p>}
                            </div>
                        )}

                        {formData.enable_inventory && (
                            <div>
                                <label htmlFor="alert_quantity" className="block text-sm font-medium text-gray-600">Alert Quantity </label>
                                <input type="number" name="alert_quantity" id="alert_quantity" value={formData.alert_quantity} onChange={handleInputChange} className="mt-1 text-gray-700 p-2 block focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 w-full border border-gray-200 rounded-md " />
                                {formErrors.alert_quantity && <p className="text-red-500 text-xs mt-1">{formErrors.alert_quantity}</p>}
                            </div>
                        )}

                        {formData.enable_inventory && (
                            <div>
                                <label htmlFor="valuationMethod" className="block text-sm font-medium text-gray-600">Valuation Method</label>
                                <select
                                    name="valuationMethod"
                                    id="valuationMethod"
                                    value={formData.valuationMethod}
                                    onChange={handleInputChange}
                                    className="mt-1 text-gray-700 p-2 block w-full border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                                >
                                    <option value="WAC">WAC (Weighted Average Cost)</option>
                                    <option value="FIFO">FIFO (First In, First Out)</option>
                                </select>
                            </div>
                        )}

                        {/* Currency */}
                        <div>
                            <CurrencySelect
                                label="Currency"
                                value={formData.currencyCode}
                                onChange={(code) => setFormData(prev => ({ ...prev, currencyCode: code }))}
                            />
                        </div>

                        {/* Gallery Images */}
                        <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Gallery Images</label>
                            <div className="mt-1 flex items-center space-x-4">
                                <label className="cursor-pointer bg-gray-50 text-gray-500 flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-gray-200 rounded-md hover:bg-gray-100">
                                    <Upload />
                                    <span>Browse Images</span>
                                    <p className="text-xs text-gray-400 mt-1">Supported formats: PNG, JPEG, WEBP</p>
                                    <input type="file" className="hidden" onChange={handleGalleryImagesChange} accept="image/png, image/jpeg, image/webp" multiple />
                                </label>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-4">
                                {galleryImagePreviews.map((preview, index) => (
                                    <div key={index} className="relative w-24 h-24">
                                        <img src={preview} alt="Gallery preview" className="w-full h-full object-cover rounded-md" />
                                        <button type="button" onClick={() => removeGalleryImage(index)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 leading-none">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </details>

                {/* --- Custom Fields --- */}
                <DynamicCustomFields
                    moduleSlug="product-services"
                    values={customFields}
                    onChange={handleCustomFieldChange}
                    onFieldsLoaded={setActiveCustomFields}
                />

                {/* --- Action Buttons --- */}
                <div className="flex justify-end space-x-4 pt-6 ">
                    <Button variant="white" onClick={() => navigate('/admin/products')}>Cancel</Button>
                    {!isEditMode && (
                        <Button type="submit" variant="white" disabled={isSubmitting} onClick={() => { addAnotherRef.current = true; }}>
                            Create &amp; Add Another
                        </Button>
                    )}
                    <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode={isEditMode ? 'edit' : 'create'} />
                </div>
            </form>

            {/* Category Create Modal — the modal doesn't hand back the created record,
                so refetch with an empty search (backend orders these lists createdAt
                desc) to grab the just-created row at index 0, then select it. */}
            <CreateCategoryModal
                isOpen={isCategoryCreateModalOpen}
                onClose={() => setIsCategoryCreateModalOpen(false)}
                onSuccess={async () => {
                    setIsCategoryCreateModalOpen(false);
                    try {
                        const headers = { 'Authorization': `Bearer ${token}` };
                        const response = await axios.get(`${Constants.FETCH_PRODUCT_CATEGORIES_URL}?search=`, { headers });
                        const formatted = response.data.data.map((category: { id: string; categoryName: string }) => ({
                            id: category.id,
                            name: category.categoryName
                        }));
                        setCategories(formatted);
                        if (formatted[0]) setFormData(prev => ({ ...prev, category: formatted[0].id }));
                    } catch (error) {
                        console.error("Failed to refetch categories:", error);
                        toast.error("Failed to load required data for the form.");
                    }
                }}
            />

            {/* Create Brand Modal — same refetch-then-select as Category (see above). */}
            <CreateBrandModal
                isOpen={isCreateBrandModalOpen}
                onClose={() => setIsCreateBrandModalOpen(false)}
                onSuccess={async () => {
                    setIsCreateBrandModalOpen(false);
                    try {
                        const headers = { 'Authorization': `Bearer ${token}` };
                        const response = await axios.get(`${Constants.FETCH_PRODUCT_BRANDS_URL}?search=`, { headers });
                        const formatted = response.data.data.map((brand: { id: string; brandName: string }) => ({
                            id: brand.id,
                            name: brand.brandName
                        }));
                        setBrands(formatted);
                        if (formatted[0]) setFormData(prev => ({ ...prev, brand: formatted[0].id }));
                    } catch (error) {
                        console.error("Failed to refetch brands:", error);
                        toast.error("Failed to load required data for the form.");
                    }
                }}
            />

            {/* Create Unit Modal — same refetch-then-select as Category (see above). */}
            <CreateUnitModal
                isOpen={isCreateUnitModalOpen}
                onClose={() => setIsCreateUnitModalOpen(false)}
                onSuccess={async () => {
                    setIsCreateUnitModalOpen(false);
                    try {
                        const headers = { 'Authorization': `Bearer ${token}` };
                        const response = await axios.get(`${Constants.FETCH_PRODUCT_UNITS_URL}?search=`, { headers });
                        const formatted = response.data.data.map((unit: { id: string; unitName: string }) => ({
                            id: unit.id,
                            name: unit.unitName
                        }));
                        setUnits(formatted);
                        if (formatted[0]) setFormData(prev => ({ ...prev, unit: formatted[0].id }));
                    } catch (error) {
                        console.error("Failed to refetch units:", error);
                        toast.error("Failed to load required data for the form.");
                    }
                }}
            />
        </>
    );
}