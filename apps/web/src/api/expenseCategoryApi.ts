
import api from '@lib/apiClient';
import Constants from "@constants/api";
import type { ExpenseCategoryResponse } from "@models/apiResponses";

export const fetchExpenseCategories = async (params: any) => {
    const { debouncedSearch, ...rest } = params;
    const requestParams = { ...rest, search: debouncedSearch };
    const res = await api.get<ExpenseCategoryResponse>(
        Constants.FETCH_EXPENSE_CATEGORIES_FOR_LIST_URL,
        {
            params: requestParams
}
    );
    return res.data.data;
};