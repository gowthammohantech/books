import React, { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import { Edit, PlusCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "@hooks/useDebounce";
import type { RootState } from "@store/index";
import { useCurrencies } from "@hooks/useCurrencies";
import Constants from "@constants/api";
import { Badge, Button } from "@components/ui";
import { assetUrl } from "@utils/assetUrl";
import { clampDiscountValue } from "@lib/lineTax";
import { mergeLineFieldAutofill, type LineCustomField } from "@lib/lineCustomFields";

interface ProductItem {
    id: string;
    name: string;
    unit: string;
    qty: number;
    rate: number;
    discount: number;
    tax: number;
    amount: number;
    tax_group_id?: string;
    tax_rate_id?: string;
    discount_type?: 'Fixed' | 'Percentage';
    discount_value?: number;
    item_type?: string;
    enable_inventory?: boolean;
    stock?: { quantity: number; alert_quantity: number };
    customFields?: Record<string, string | number | boolean | string[]>;
}
interface Product {
    id: string;
    item_type: string;
    name: string;
    code: string;
    unit: { id: string; name: string } | null;
    prices: { selling: number; purchase: number };
    discount: { type: "Fixed" | "Percentage"; value: number } | null;
    tax: { group_id: string; group_name: string; total_rate: number } | null;
    tax_rate?: { taxRateId: string | null; name: string; rate: number } | null;
    enable_inventory?: boolean;
    stock?: { quantity: number; alert_quantity: number };
    images?: { main: string | null };
}

interface InvoiceTableRowProps {
    item: ProductItem;
    /** @deprecated No longer used — amounts are formatted via formatMoney(currencyCode). Kept optional for backward compatibility with existing callers. */
    currencySymbol?: string;
    currencyCode?: string;
    onEditItem: (item: ProductItem) => void;
    onDeleteItem: (item: ProductItem) => void;
    availableItems: ProductItem[];
    onInLineItemChange: (updatedItem: ProductItem) => void;
    /** When provided, fires instead of onInLineItemChange on product selection so the
     *  parent can resolve line tax via the resolve-line endpoint. Absent → old behavior. */
    onProductPicked?: (updatedItem: ProductItem) => void;
    addNewProduct: () => void;
    /** When true, out-of-stock inventory-tracked products are disabled in the picker and quantity is clamped to available stock. Default false — only invoice surfaces opt in; purchases/POs (which increase stock) must never block. */
    blockOutOfStock?: boolean;
    /**
     * Optional: called when Enter is pressed in this row's rate or discount
     * input. Callers should pass this only to the LAST row so Enter appends
     * a new row and (via id convention `row-name-<id>`) focuses its name
     * input. Omitted by callers (e.g. EditInvoice) that haven't wired it —
     * the row simply won't intercept Enter in that case.
     */
    onRequestNewRow?: () => void;
    /** Line-item-placed custom fields for this document's module. When provided,
     *  one extra cell per field renders between Item and Unit; the matching
     *  <th> columns are the consuming page's responsibility. */
    lineFields?: LineCustomField[];
}

const InvoiceTableRow: React.FC<InvoiceTableRowProps> = ({
    item,
    currencyCode,
    onEditItem,
    onDeleteItem,
    availableItems,
    onInLineItemChange,
    onProductPicked,
    addNewProduct,
    blockOutOfStock = false,
    onRequestNewRow,
    lineFields,
}) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const company = useSelector((state: RootState) => state.systemSettings.data?.company);
    const showRate = company?.itemPickerShowRate ?? true;
    const showStock = company?.itemPickerShowStock ?? true;
    const showImage = company?.itemPickerShowImage ?? false;
    const { formatMoney } = useCurrencies();
    const [searchInput, setSearchInput] = useState<string>(item.name || "");
    const debouncedSearchTerm = useDebounce(searchInput, 700);
    const [fetchedProducts, setFetchedProducts] = useState<Product[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const searchRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLUListElement>(null);
    const [isLoadingProducts, setIsLoadingProducts] = useState(false);
    // Tracks whether the "Only N in stock" toast has already fired for the
    // current out-of-stock-typing episode, so it shows once per episode
    // instead of on every keystroke. Reset when qty comes back within stock
    // (handleManualChange) or the product changes (below).
    const stockToastShownRef = useRef(false);

    // Hide dropdown when clicked outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        setSearchInput(item.name);
    }, [item.name]);

    // Fetch products by search. AbortController cancels the in-flight request
    // when a newer search fires (or the row unmounts) so a slow earlier
    // response can never clobber a later one. `availableItems` is deliberately
    // NOT a dependency — it changes on every keystroke across sibling rows,
    // which used to re-trigger this fetch constantly; instead we filter the
    // already-fetched list against it at render time (see `products` below).
    useEffect(() => {
        const controller = new AbortController();

        const fetchProducts = async () => {
            try {
                setIsLoadingProducts(true);
                const currencyParam = currencyCode
                    ? `&currencyCode=${encodeURIComponent(currencyCode)}`
                    : '';
                const response = await axios.get(
                    `${Constants.FETCH_PRODUCTS_WITH_SEARCH_URL}?search=${debouncedSearchTerm}${currencyParam}`,
                    { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
                );

                setFetchedProducts(response.data.data);
            } catch (error) {
                if (axios.isCancel(error)) return;
                console.error("Error fetching products:", error);
                setFetchedProducts([]);
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoadingProducts(false);
                }
            }
        };
        fetchProducts();

        return () => controller.abort();
    }, [debouncedSearchTerm, token, currencyCode]);

    // Filter out items already used on other rows of this invoice at render
    // time, so the fetch effect above doesn't need `availableItems` in its
    // dependency array.
    const products = useMemo(
        () => fetchedProducts.filter(
            (p) => availableItems.every((i) => i.id !== p.id)
        ),
        [fetchedProducts, availableItems]
    );

    // Auto scroll active item
    useEffect(() => {
        if (activeIndex > -1 && dropdownRef.current) {
            const activeItem = dropdownRef.current.children[activeIndex] as HTMLLIElement;
            if (activeItem) {
                activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    }, [activeIndex]);

    // Select product
    const handleProductSelect = (product: Product) => {
        const isTracked = product.item_type === 'Product' && !!product.enable_inventory;
        const isOutOfStock = isTracked && (product.stock?.quantity ?? 0) <= 0;
        if (blockOutOfStock && isOutOfStock) {
            // Hard block: out-of-stock tracked products are unselectable on invoices.
            return;
        }

        setSearchInput(product.name);
        setShowDropdown(false);
        setActiveIndex(-1);
        stockToastShownRef.current = false;

        const rate = product.prices?.selling ?? 0;
        const discount = product.discount?.value ?? 0;
        const taxPercent = product.tax_rate?.rate ?? product.tax?.total_rate ?? 0;
        const tax = (rate * taxPercent) / 100;
        const amount = rate + tax - discount;

        // Autofill line-item custom fields from the picked product, but existing
        // manual values on this row win. Only attach the key at all when there's
        // something to carry — with no lineFields configured (the case for every
        // page today) this stays `{}` and is omitted so the emitted item is
        // byte-identical to pre-custom-fields behavior.
        const mergedCustomFields = mergeLineFieldAutofill(
            (product as { customFields?: Record<string, unknown> }).customFields,
            item.customFields,
            lineFields ?? [],
        );

        (onProductPicked ?? onInLineItemChange)({
            ...item,
            id: product.id,
            name: product.name,
            unit: product.unit?.name ?? "",
            qty: 1,
            rate,
            amount,
            discount,
            tax,
            tax_group_id: product.tax?.group_id,
            tax_rate_id: product.tax_rate?.taxRateId ?? '',
            discount_type: product.discount?.type || "Fixed",
            discount_value: product.discount?.value,
            item_type: product.item_type,
            enable_inventory: product.enable_inventory,
            stock: product.stock,
            ...(Object.keys(mergedCustomFields).length > 0 ? { customFields: mergedCustomFields } : {}),
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showDropdown || products.length === 0) return;
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setActiveIndex((prev) => (prev < products.length - 1 ? prev + 1 : prev));
                break;
            case "ArrowUp":
                e.preventDefault();
                setActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
                break;
            case "Enter":
                e.preventDefault();
                if (activeIndex > -1) handleProductSelect(products[activeIndex]);
                break;
            case "Escape":
                setShowDropdown(false);
                break;
        }
    };

    const handleManualChange = (key: keyof ProductItem, value: any) => {
        let nextValue = value;

        // Invoice-only hard cap: never let entered qty exceed live available stock
        // for inventory-tracked products.
        if (key === "qty" && blockOutOfStock && item.item_type === 'Product' && item.enable_inventory) {
            const availableStock = item.stock?.quantity ?? 0;
            const requestedQty = Number(value);
            nextValue = Math.min(requestedQty, availableStock);
            if (requestedQty > availableStock) {
                // Only toast once per "clamp episode" — otherwise every keystroke
                // while typed qty > stock re-fires the warning. Reset when a qty
                // within stock is entered (below) or the product changes.
                if (!stockToastShownRef.current) {
                    toast.warning(`Only ${availableStock} in stock`);
                    stockToastShownRef.current = true;
                }
            } else {
                stockToastShownRef.current = false;
            }
        }

        // Clamp the raw discount_value input identically to the Edit-item modal
        // (CreateInvoice.tsx handleEditingItemChange): Percentage → [0,100],
        // Fixed → [0, qty*rate]. Only the raw value entering computeLineTaxFields
        // changes here — the recompute flow itself is untouched.
        if (key === "discount_value") {
            nextValue = clampDiscountValue(Number(value), item.discount_type, item.qty, item.rate);
        }

        const updated = {
            ...item,
            [key]: nextValue,
        };

        // Auto recalc total if qty or rate changed
        if (key === "qty" || key === "rate") {
            updated.amount = updated.qty * updated.rate;
        }

        onInLineItemChange(updated);
    };

    // Enter in the LAST row's rate/discount field appends a new row and
    // focuses its name input. `onRequestNewRow` is only wired by the parent
    // for the last row, so this is a no-op everywhere else.
    const handleAppendRowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && onRequestNewRow) {
            e.preventDefault();
            onRequestNewRow();
        }
    };

    const handleLineFieldChange = (slug: string, value: string) => {
        onInLineItemChange({
            ...item,
            customFields: { ...(item.customFields ?? {}), [slug]: value },
        });
    };

    const renderLineFieldInput = (field: LineCustomField) => {
        const slug = field.fieldSlug;
        const raw = item.customFields?.[slug];
        const value = raw === undefined || raw === null ? '' : Array.isArray(raw) ? raw.join(', ') : String(raw);
        const typeSlug = field.dataType?.slug ?? 'text';
        if (typeSlug === 'dropdown' || typeSlug === 'radio') {
            return (
                <select
                    className="w-28 p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none"
                    value={value}
                    onChange={(e) => handleLineFieldChange(slug, e.target.value)}
                    aria-label={field.labelName}
                >
                    <option value=""></option>
                    {(field.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            );
        }
        const inputType = typeSlug === 'number' ? 'number' : typeSlug === 'datepicker' ? 'date' : 'text';
        return (
            <input
                type={inputType}
                className="w-28 p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none"
                value={value}
                onChange={(e) => handleLineFieldChange(slug, e.target.value)}
                aria-label={field.labelName}
            />
        );
    };

    return (
        <tr className="bg-white text-gray-950 border-b border-gray-200">
            {/* Product Name Search/Manual */}
            <td className="p-3 font-medium">
                <div className="relative w-full" ref={searchRef}>
                    <input
                        type="text"
                        id={`row-name-${item.id}`}
                        className="p-2 w-full border text-gray-700 text-sm border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-purple-200"
                        placeholder="Search or type product..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)} // only local state
                        onBlur={() => handleManualChange("name", searchInput)} // update parent on blur
                        onFocus={() => setShowDropdown(true)}
                        onKeyDown={handleKeyDown}
                    />

                    {showDropdown && (
                        <ul
                            ref={dropdownRef}
                            className="absolute top-full left-0 w-full bg-white border border-gray-200 z-10 max-h-48 overflow-auto rounded-md shadow-dropdown"
                        >
                            {isLoadingProducts ? (
                                <li className="p-3 text-center text-sm text-gray-500">Loading...</li>
                            ) : products.length > 0 ? (
                                products.map((p, index) => {
                                    const isTracked = p.item_type === 'Product' && !!p.enable_inventory;
                                    const isOutOfStock = isTracked && (p.stock?.quantity ?? 0) <= 0;
                                    const isDisabled = blockOutOfStock && isOutOfStock;
                                    return (
                                        <li
                                            key={p.id}
                                            className={`p-3 hover:bg-purple-50 ${index === activeIndex ? "bg-purple-50" : ""
                                                } ${isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                            onMouseDown={(e) => {
                                                if (isDisabled) {
                                                    e.preventDefault();
                                                    return;
                                                }
                                                handleProductSelect(p);
                                            }}
                                        >
                                            <div className="flex items-center gap-2">
                                                {showImage && p.images?.main && (
                                                    <img
                                                        src={assetUrl(p.images.main)}
                                                        alt=""
                                                        className="h-8 w-8 rounded object-cover shrink-0"
                                                    />
                                                )}
                                                <div className="font-medium text-gray-800">{p.name}</div>
                                            </div>
                                            <div className="text-xs text-gray-500 flex items-center gap-2">
                                                {showRate && (
                                                    <span>Rate: {formatMoney(p.prices.selling, currencyCode)}</span>
                                                )}
                                                {isTracked && (
                                                    isOutOfStock ? (
                                                        (showStock || isDisabled) && <Badge color="danger">Out of stock</Badge>
                                                    ) : (
                                                        showStock && (
                                                            p.stock!.quantity <= p.stock!.alert_quantity ? (
                                                                <Badge color="warning">Low stock: {p.stock!.quantity}</Badge>
                                                            ) : (
                                                                <span className="text-gray-500">Qty: {p.stock!.quantity}</span>
                                                            )
                                                        )
                                                    )
                                                )}
                                            </div>
                                        </li>
                                    );
                                })
                            ) : (
                                <li className="p-3 text-center text-sm text-gray-500">
                                    No results for "{searchInput}"
                                </li>
                            )}

                            <li
                                className="p-3 border-t border-gray-200 cursor-pointer hover:bg-purple-50 text-purple-600 font-semibold flex items-center"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    addNewProduct();
                                }}
                            >
                                <PlusCircle size={16} className="mr-2" />
                                Add New Item
                            </li>
                        </ul>
                    )}
                </div>
            </td>

            {/* Line-item custom fields */}
            {(lineFields ?? []).map((field) => (
                <td key={field.fieldSlug} className="p-3">
                    {renderLineFieldInput(field)}
                </td>
            ))}

            {/* Unit */}
            <td className="p-3">
                <input
                    type="text"
                    className="w-20 p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none"
                    value={item.unit ?? ''}
                    onChange={(e) => handleManualChange("unit", e.target.value)}
                />
            </td>

            {/* Quantity */}
            <td className="p-3">
                <input
                    type="number"
                    className="w-20 p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none"
                    min="1"
                    max={blockOutOfStock && item.item_type === 'Product' && item.enable_inventory ? (item.stock?.quantity ?? 0) : undefined}
                    value={item.qty}
                    onChange={(e) => handleManualChange("qty", Number(e.target.value))}
                />
            </td>

            {/* Rate */}
            <td className="p-3">
                <input
                    type="number"
                    className="w-24 p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none"
                    value={item.rate}
                    onChange={(e) => handleManualChange("rate", Number(e.target.value))}
                    onKeyDown={handleAppendRowKeyDown}
                />
            </td>

            {/* Discount — inline amount edit; discount TYPE (Fixed/Percentage)
                stays in the row's Edit modal. Commits through the same
                handleManualChange pathway as qty/rate, writing discount_value
                (the field CreateInvoice/EditInvoice's computeLineTaxFields
                actually recomputes `discount`/`tax`/`amount` from) so the
                edit isn't silently discarded on the next recompute. */}
            <td className="p-3">
                <input
                    type="number"
                    className="w-24 p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none text-center"
                    min="0"
                    value={item.discount_value ?? item.discount ?? 0}
                    onChange={(e) => handleManualChange("discount_value", Number(e.target.value))}
                    onKeyDown={handleAppendRowKeyDown}
                />
            </td>

            {/* Tax */}
            <td className="p-3 font-semibold text-gray-800 text-center">
                {formatMoney(Number(item.tax ?? 0), currencyCode)}
            </td>

            {/* Amount */}
            <td className="p-3 font-semibold text-gray-800">
                {formatMoney(Number(item.amount ?? 0), currencyCode)}
            </td>

            {/* Actions */}
            <td className="p-6 flex items-center gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onEditItem(item)}
                    aria-label="Edit item"
                    className="!px-1.5 !py-1.5"
                >
                    <Edit size={16} className="text-body hover:text-purple-600" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteItem(item)}
                    aria-label="Remove item"
                    className="!px-1.5 !py-1.5"
                >
                    <Trash2 size={16} className="text-danger" />
                </Button>
            </td>
        </tr>
    );
};

export default InvoiceTableRow;
