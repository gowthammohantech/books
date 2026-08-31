import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import type { OptionType } from "@models/common";
import { useDebounce } from "./useDebounce";

/**
 * Shared category/brand/unit/tax dropdown data + debounced search state for the
 * product forms (full-page ProductForm + the inline CreateProductForm modal).
 *
 * Was duplicated 1:1 (4 debounced fetch effects) in both forms; extracted here so
 * they can't drift again. `unit.name` is sourced from `unitName` (the full-page's
 * original mapping) — the modal used to map `shortName` instead, which is the
 * fixed drift (see task report for details).
 *
 * `isActive` gates the effects: pass `true` for the always-mounted full page,
 * and the modal's `isOpen` for the inline modal (matches each form's original
 * fetch-guard behavior exactly).
 */
export function useProductLookups(isActive: boolean) {
    const { token } = useSelector((state: RootState) => state.auth);

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

    useEffect(() => {
        const fetchCategoriesByQuery = async () => {
            if (!isActive) return;
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
    }, [debouncedCategorySearch, isActive]);

    useEffect(() => {
        const fetchBrandsByQuery = async () => {
            if (!isActive) return;
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
    }, [debouncedBrandSearch, isActive]);

    useEffect(() => {
        const fetchUnitsByQuery = async () => {
            if (!isActive) return;
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
    }, [debouncedUnitSearch, isActive]);

    useEffect(() => {
        const fetchTaxesByQuery = async () => {
            if (!isActive) return;
            const headers = { 'Authorization': `Bearer ${token}` };
            try {
                const response = await axios.get(`${Constants.FETCH_PRODUCT_TAXES_URL}?search=${debouncedTaxSearch}`, { headers });
                const formattedTaxes = response.data.data.map((tax: any) => ({
                    id: tax.id,
                    name: tax.taxGroupName
                }));
                setTaxes(formattedTaxes);
            } catch (error) {
                console.error("Failed to fetch taxes:", error);
                toast.error("Failed to load required data for the form.");
            }
        }
        fetchTaxesByQuery();
    }, [debouncedTaxSearch, isActive]);

    /**
     * Quick-create append+select helpers.
     *
     * The Create*Modal components (CreateUnitModal/CreateCategoryModal/CreateBrandModal/
     * CreateTaxGroupModal) don't hand the created record back to the caller (`onSuccess()`
     * takes no payload). Rather than reach into those modals, we lean on a property already
     * true of every one of these list endpoints: they're ordered `createdAt desc`, and an
     * empty `?search=` returns the most-recently-created 10 rows. So refetching with an
     * empty search after a quick-create success deterministically puts the just-created
     * record at index 0 — the caller uses that to both append (the list state is replaced
     * with the fresh fetch) and select (grab `[0].id`) in one round trip.
     */
    const refetchCategories = useCallback(async (): Promise<OptionType[]> => {
        const headers = { 'Authorization': `Bearer ${token}` };
        try {
            const response = await axios.get(`${Constants.FETCH_PRODUCT_CATEGORIES_URL}?search=`, { headers });
            const formatted = response.data.data.map((category: any) => ({ id: category.id, name: category.categoryName }));
            setCategories(formatted);
            return formatted;
        } catch (error) {
            console.error("Failed to refetch categories:", error);
            toast.error("Failed to load required data for the form.");
            return [];
        }
    }, [token]);

    const refetchBrands = useCallback(async (): Promise<OptionType[]> => {
        const headers = { 'Authorization': `Bearer ${token}` };
        try {
            const response = await axios.get(`${Constants.FETCH_PRODUCT_BRANDS_URL}?search=`, { headers });
            const formatted = response.data.data.map((brand: any) => ({ id: brand.id, name: brand.brandName }));
            setBrands(formatted);
            return formatted;
        } catch (error) {
            console.error("Failed to refetch brands:", error);
            toast.error("Failed to load required data for the form.");
            return [];
        }
    }, [token]);

    const refetchUnits = useCallback(async (): Promise<OptionType[]> => {
        const headers = { 'Authorization': `Bearer ${token}` };
        try {
            const response = await axios.get(`${Constants.FETCH_PRODUCT_UNITS_URL}?search=`, { headers });
            const formatted = response.data.data.map((unit: any) => ({ id: unit.id, name: unit.unitName }));
            setUnits(formatted);
            return formatted;
        } catch (error) {
            console.error("Failed to refetch units:", error);
            toast.error("Failed to load required data for the form.");
            return [];
        }
    }, [token]);

    const refetchTaxes = useCallback(async (): Promise<OptionType[]> => {
        const headers = { 'Authorization': `Bearer ${token}` };
        try {
            const response = await axios.get(`${Constants.FETCH_PRODUCT_TAXES_URL}?search=`, { headers });
            const formatted = response.data.data.map((tax: any) => ({ id: tax.id, name: tax.taxGroupName }));
            setTaxes(formatted);
            return formatted;
        } catch (error) {
            console.error("Failed to refetch taxes:", error);
            toast.error("Failed to load required data for the form.");
            return [];
        }
    }, [token]);

    return {
        categories, brands, units, taxes,
        categorySearchInput, setCategorySearchInput,
        brandSearchInput, setBrandSearchInput,
        unitSearchInput, setUnitSearchInput,
        taxSearchInput, setTaxSearchInput,
        refetchCategories, refetchBrands, refetchUnits, refetchTaxes,
    };
}
