export interface ModuleList {
    /** Prisma shape (post-Mongoose migration) */
    id: string;
    moduleName: string;
    moduleSlug: string;
    parentId: string | null;
    userType: number;
    children: ChildModuleList[]
    /** Set when the module has no children of its own and is rendered as a single
     *  self-toggleable row (e.g. AI). The lone child mirrors the module itself. */
    isLeaf?: boolean;
}

export interface ChildModuleList {
    /** Prisma shape (post-Mongoose migration) */
    id: string;
    moduleName: string;
    moduleSlug: string;
    parentId: string | null;
    userType: number;
    permissions: Permission
}

export interface Permission {
    create: boolean;
    edit: boolean;
    delete: boolean;
    view: boolean;
    allowAll: boolean;
}

export interface RoleList {
    id: number;
    roleName: string;
    status: boolean;
    createdAt: string;
}