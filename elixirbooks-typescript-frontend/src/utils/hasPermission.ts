import type { PermissionAction, PermissionSet } from "@models/permissions";

/**
 * Does the caller's permission set allow `action` on `moduleSlug`?
 *
 * A pure function of the permissions it is handed — it no longer reaches into
 * the redux store to check `user_type === 1`. That bypass returned true for
 * every module regardless of the permissions argument, which made the whole
 * parameter decorative for those users, and it keyed off a property of the
 * PERSON rather than of their membership in the current workspace: someone who
 * signed up as an admin of their own company got full access inside every other
 * company they were later invited to. The permissions passed in are the ones
 * the server issued for the active workspace, and they are now the only input.
 */
export const hasPermission = (permissions: PermissionSet[], moduleSlug: string, action: PermissionAction) : boolean => {
    const module = permissions.find((permission) => permission.moduleSlug === moduleSlug);
    if (!module) return false;
    if (module.allowAll) return true;
    return module[action];
}