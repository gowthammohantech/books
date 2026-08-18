export interface PermissionSet {
    id: string;
    roleId: string;
    moduleId: string;
    moduleName: string;
    moduleSlug: string;
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    allowAll: boolean;
}

export type PermissionAction = "view" | "create" | "edit" | "delete" | "allowAll";