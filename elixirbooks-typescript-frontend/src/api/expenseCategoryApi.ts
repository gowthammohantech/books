import axios from "axios";
import Constants from "@constants/api";
import type { ExpenseCategoryResponse } from "@pages/admin/finance-and-accounting/ExpenseCategoryList";

export const fetchExpenseCategories = async (
    token: string,
    params: any
) => {
    const { debouncedSearch, ...rest } = params;
    const requestParams = { ...rest, search: debouncedSearch };
    const res = await axios.get<ExpenseCategoryResponse>(
        Constants.FETCH_EXPENSE_CATEGORIES_FOR_LIST_URL,
        {
            params: requestParams,
            headers: { Authorization: `Bearer ${token}` },
        }
    );
    return res.data.data;
};