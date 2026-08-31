import type { PermissionSet } from "./permissions";

/**
 * One workspace the signed-in person belongs to. Mirrors `MembershipSummary` in
 * the backend's controllers/authController.ts — login, switch-tenant and
 * session all return an array of exactly this shape.
 */
export interface TenantSummary {
    membershipId: string;
    tenantId: string;
    name: string;
    slug: string;
    /** The role this person holds IN THIS WORKSPACE — it differs per workspace. */
    roleName: string | null;
    isOwner: boolean;
}

/** The workspace the current token is scoped to. */
export interface ActiveTenant {
    id: string;
    name: string;
    slug: string;
    roleName: string | null;
    isOwner: boolean;
    plan?: string | null;
    status?: string;
}

/** GET /api/auth/session -> data */
export interface SessionPayload {
    user: Record<string, unknown> & { id: string; email: string };
    tenant: ActiveTenant;
    memberships: TenantSummary[];
    setup: {
        /** Has THIS workspace been through /setup? Per-tenant, unlike the old
         *  install-wide `company_settings` flag it replaces. */
        companySettingsComplete: boolean;
    };
    /** moduleSlug -> permission flags, as a plain object (a Map is not JSON). */
    permissions: Record<string, Partial<PermissionSet>>;
}
