import api from '@lib/apiClient';
import Constants from "@constants/api";
import type { Pagination } from "@models/common";
import type { CustomFieldShape } from "@models/modulesettings/customField";
import type { ModuleListResponse } from "@models/apiResponses";

export interface CustomFieldListResponse {
    success: boolean;
    message: string;
    data: {
        fields: CustomFieldShape[],
        pagination: Pagination
    }
}

export interface FetchCustomFieldsParams {
    page?: number;
    limit?: number;
    search?: string;
}

export const fetchCustomFieldTypes = async () => {
    const res = await api.get<any>(
        Constants.FETCH_CUSTOM_FIELD_TYPES
    );
    return res.data;
};

export const fetchModuleHierarchy = async () => {
    const res = await api.get<ModuleListResponse>(
        Constants.FETCH_MODULES_URL
    );
    return res.data;
};

export const fetchCustomFieldsByModule = async (
    moduleId: string,
    params?: FetchCustomFieldsParams
) => {
    const res = await api.get<CustomFieldListResponse>(
        `${Constants.BASE_URL}/api/admin/custom-fields/module/${moduleId}`,
        {
params: params
        }
    );
    return res.data;
};