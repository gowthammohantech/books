-- P9 / M13: drop User.ownerId and User.roleId.
--
-- These were the last two single-workspace assumptions still living on the User
-- row, and both have been replaced by TenantMembership:
--
--   ownerId -> a membership row. It pointed a staff user at the sole company
--              owner; the tenant resolved to `ownerId ?? id`. A person can
--              belong to several workspaces, which one column cannot express.
--   roleId  -> TenantMembership.roleId. A person holds a DIFFERENT role in each
--              workspace, so a single global role was never the right shape --
--              and it was actively wrong: CompanySettingsController served the
--              SPA a permission set derived from it, so someone who was an
--              Owner in one company and a Viewer in another got the Owner UI in
--              both, while the backend (which had read the membership since P5)
--              answered 403.
--
-- Both stopped being READ before this migration ships; they have been written
-- in parallel for one release so that a mid-upgrade rollback still worked.
--
-- LAST-CHANCE REPAIR. Once these columns are gone, a user who has an ownerId
-- but no membership can never be repaired automatically -- the information will
-- simply not exist. Such a user is ALREADY locked out (authMiddleware.protect
-- resolves the workspace from the membership and 401s without one), so this is
-- not a new failure; but it is the last moment at which it is fixable, so we
-- fix it here rather than dropping the evidence.

-- ---------------------------------------------------------------------------
-- 1. Repair: staff users whose ownerId names a real Tenant.
-- ---------------------------------------------------------------------------
-- The role is matched by NAME within the target workspace. `User.roleId` is
-- deliberately NOT trusted as a source: on a database predating per-tenant
-- roles it can name another company's Role row, and pointing a membership at a
-- foreign tenant's role is exactly the cross-workspace leak this conversion
-- exists to prevent.
INSERT INTO "TenantMembership" ("id", "userId", "tenantId", "roleId", "status", "isOwner", "joinedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u.id,
  u."ownerId",
  (
    SELECT r.id FROM "Role" r
    WHERE r."tenantId" = u."ownerId"
      AND r."deletedAt" IS NULL
      AND lower(r."roleName") = lower(
        CASE u.user_type WHEN 1 THEN 'Admin' WHEN 2 THEN 'Vendor' ELSE 'Staff' END
      )
    ORDER BY r."createdAt" ASC
    LIMIT 1
  ),
  'ACTIVE',
  FALSE,
  NOW(),
  NOW(),
  NOW()
FROM "User" u
WHERE u."ownerId" IS NOT NULL
  AND u.user_type <> 999
  AND u."isDeleted" = FALSE
  AND EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = u."ownerId")
  AND NOT EXISTS (
    SELECT 1 FROM "TenantMembership" m WHERE m."userId" = u.id AND m."tenantId" = u."ownerId"
  );

-- ---------------------------------------------------------------------------
-- 2. Repair: owners, whose own User.id IS their Tenant.id.
-- ---------------------------------------------------------------------------
-- That reuse was deliberate from P1 (migration 20260901000000_tenant_core) and
-- is still what signup produces for a person's FIRST workspace, so it is a
-- reliable signal rather than a coincidence.
INSERT INTO "TenantMembership" ("id", "userId", "tenantId", "roleId", "status", "isOwner", "joinedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u.id,
  t.id,
  (
    SELECT r.id FROM "Role" r
    WHERE r."tenantId" = t.id AND r."deletedAt" IS NULL AND lower(r."roleName") = 'owner'
    ORDER BY r."createdAt" ASC
    LIMIT 1
  ),
  'ACTIVE',
  TRUE,
  NOW(),
  NOW(),
  NOW()
FROM "User" u
JOIN "Tenant" t ON t.id = u.id
WHERE u.user_type <> 999
  AND u."isDeleted" = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM "TenantMembership" m WHERE m."userId" = u.id AND m."tenantId" = t.id
  );

-- ---------------------------------------------------------------------------
-- 3. Report anyone still unresolvable -- loudly, but do not block the upgrade.
-- ---------------------------------------------------------------------------
-- A WARNING rather than an EXCEPTION: these users cannot sign in TODAY, before
-- this migration runs, so refusing to upgrade would punish an install for a
-- pre-existing broken row without repairing anything. The warning names them so
-- an operator can add the membership by hand.
DO $$
DECLARE
  orphan_count INT;
  orphan_emails TEXT;
BEGIN
  SELECT COUNT(*), string_agg(email, ', ' ORDER BY email)
    INTO orphan_count, orphan_emails
  FROM "User" u
  WHERE u.user_type <> 999
    AND u."isDeleted" = FALSE
    AND NOT EXISTS (SELECT 1 FROM "TenantMembership" m WHERE m."userId" = u.id);

  IF orphan_count > 0 THEN
    RAISE WARNING
      'drop_user_owner_role: % user(s) hold no workspace membership and could not be resolved: %. They cannot sign in. Add a TenantMembership row for each; User.ownerId is about to be dropped, so this information will no longer be recoverable.',
      orphan_count, orphan_emails;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Drop.
-- ---------------------------------------------------------------------------
-- No IF EXISTS: if a constraint is not named what this expects, the migration
-- must fail loudly rather than silently leave a column behind that the Prisma
-- client no longer knows about.
ALTER TABLE "User" DROP CONSTRAINT "User_ownerId_fkey";
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

DROP INDEX "User_ownerId_idx";

ALTER TABLE "User" DROP COLUMN "ownerId";
ALTER TABLE "User" DROP COLUMN "roleId";
