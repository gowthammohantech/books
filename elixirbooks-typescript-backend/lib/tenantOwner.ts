// lib/tenantOwner.ts
//
// Several document endpoints (invoice, quotation, credit note, purchase,
// expense, bank detail) used to `include: { user: {...} }` to render the
// owning party alongside the document. That relation pointed at User because
// the tenant column WAS a user id.
//
// After P3 the column points at Tenant, so the same information has to come
// through the workspace's OWNER MEMBERSHIP instead. Doing it this way rather
// than reading CompanySettings keeps the response shape byte-identical (the
// frontend still gets `{ id, name, email, phone }`), and unlike the old
// `Tenant.id === owner User.id` shortcut it stays correct in P5, when a user
// can own more than one workspace and tenant ids stop matching user ids.
//
// Cost: one nested join per query, bounded by `take: 1`.

/** Spread into a Prisma `include`/`select` to reach the tenant's owner. */
export const tenantOwnerInclude = {
  select: {
    id: true,
    name: true,
    memberships: {
      where: { isOwner: true },
      take: 1,
      select: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            profileImage: true,
            address: true,
            user_type: true,
          },
        },
      },
    },
  },
} as const;

export interface TenantWithOwner {
  id: string;
  name: string;
  memberships: Array<{
    user: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
      profileImage?: string | null;
      address?: string | null;
      user_type?: number;
    } | null;
  }>;
}

/**
 * The owner User of a tenant loaded with {@link tenantOwnerInclude}, or null.
 *
 * Null is a real possibility, not a defensive shrug: a workspace whose owner
 * membership was revoked has no owner until one is reassigned. Callers should
 * degrade (omit the block) rather than throw.
 */
export function tenantOwner<T extends TenantWithOwner | null | undefined>(
  tenant: T,
): TenantWithOwner['memberships'][number]['user'] | null {
  return tenant?.memberships?.[0]?.user ?? null;
}
