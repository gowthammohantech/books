import type { PermissionAction, PermissionSet } from "@models/permissions";
import { store } from "@store/index";
export const hasPermission = (permissions: PermissionSet[], moduleSlug: string, action: PermissionAction) : boolean => {
    const module = permissions.find((permission) => permission.moduleSlug === moduleSlug);
    const { user } = store.getState().auth;
    if (user && user.user_type === 1) return true;
    if (!module) return false;
    if (module.allowAll) return true;
    return module[action];
}