import Constants from "@constants/api";
import type { Pagination } from "@models/common";
import type { CustomFieldShape } from "@models/modulesettings/customField";
import type { ModuleListResponse } from "@pages/admin/roles-permissions/RolePermissions";
import axios from "axios";

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

export const fetchCustomFieldTypes = async (token: string) => {
    const res = await axios.get<any>(
        Constants.FETCH_CUSTOM_FIELD_TYPES,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data;
};

export const fetchModuleHierarchy = async (token: string) => {
    const res = await axios.get<ModuleListResponse>(
        Constants.FETCH_MODULES_URL,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data;
};

export const fetchCustomFieldsByModule = async (
    token: string,
    moduleId: string,
    params?: FetchCustomFieldsParams
) => {
    const res = await axios.get<CustomFieldListResponse>(
        `${Constants.BASE_URL}/api/admin/custom-fields/module/${moduleId}`,
        {
            headers: { Authorization: `Bearer ${token}` },
            params: params,
        }
    );
    return res.data;
};