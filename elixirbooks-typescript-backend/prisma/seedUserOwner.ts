/**
 * Idempotent backfill: links every staff/admin user to the single company
 * owner so the shared-workspace tenancy (ownerId ?? id) resolves all of them
 * to one dataset.
 *
 * The owner is the sole user_type:1 account (registration enforces exactly one
 * — see controllers/authController.ts). Every other real user (user_type not in
 * {1, 999}) with ownerId = null is pointed at that owner. The owner itself and
 * the user_type:999 system-bootstrap account are left unlinked (they are not
 * tenant members).
 *
 * The `ownerId: null` guard makes re-runs no-ops, so this is safe to call on
 * every container boot from prisma/seed.ts.
 *
 * Run standalone:  npx ts-node prisma/seedUserOwner.ts
 * Called from:     prisma/seed.ts main()
 */

import { PrismaClient } from '@prisma/client';

// Self-contained client so the seeder doesn't depend on the hot-reload-cached
// shared client from lib/prisma (matches prisma/seedRoles.ts).
const prisma = new PrismaClient();

export interface SeedUserOwnerResult {
  /** The resolved owner's id, or null if no user_type:1 owner exists yet */
  ownerId: string | null;
  /** How many users were linked to the owner in this run */
  backfilled: number;
}

export async function seedUserOwner(): Promise<SeedUserOwnerResult> {
  // The canonical company owner: the single user_type:1 admin. Prefer the
  // oldest if (somehow) more than one exists, for a stable choice.
  const owner = await prisma.user.findFirst({
    where: { user_type: 1, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!owner) {
    // Fresh DB before the admin registers — nothing to backfill yet.
    return { ownerId: null, backfilled: 0 };
  }

  const result = await prisma.user.updateMany({
    where: {
      ownerId: null,
      user_type: { notIn: [1, 999] },
    },
    data: { ownerId: owner.id },
  });

  return { ownerId: owner.id, backfilled: result.count };
}

if (require.main === module) {
  seedUserOwner()
    .then((r) => {
      console.log(
        r.ownerId
          ? `User owner backfill: linked ${r.backfilled} user(s) to owner ${r.ownerId}.`
          : 'User owner backfill: no user_type:1 owner found yet — skipped.',
      );
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error('seedUserOwner error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
