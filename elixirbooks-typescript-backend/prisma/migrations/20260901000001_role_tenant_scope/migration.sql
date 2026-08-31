-- P1 / M2: make Role (and its Permission rows) tenant-scoped.
--
-- Until now Role and Permission were install-global: one tenant renaming
-- "Admin" or revoking a module from it changed it for every other tenant on the
-- install. Each workspace now owns its own role set, seeded at signup by
-- prisma/seedTenant.ts. Module stays global — it names features, not data.
--
-- Permission.tenantId is DENORMALIZED from Role.tenantId. The tenant guard can
-- only inject a top-level `where`, so scoping Permission through a relation
-- traversal (`role: { tenantId }`) is not something it can generate generically.
-- prisma/checkTenantIntegrity.ts asserts the two stay in agreement.
--
-- NOTE ON UNIQUENESS: no unique index on (tenantId, roleName) is created here.
-- roleController soft-deletes roles (sets deletedAt) and scopes every
-- name-collision check to `deletedAt: null`, so a plain unique constraint would
-- break "delete a role, then recreate it with the same name". The correct
-- constraint is a partial unique index, which Prisma cannot represent in the
-- schema and which would therefore read as drift forever. Uniqueness stays
-- enforced in application code, tenant-scoped, as it already was.

-- AlterTable: nullable first so existing rows survive the backfill below.
ALTER TABLE "Role" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Permission" ADD COLUMN "tenantId" TEXT;

-- Guard for a pathological install: Role rows exist but tenant_core created no
-- Tenant (every real user soft-deleted, leaving only the user_type=999
-- `sys-bootstrap` account). Those roles are orphaned seed data, but failing the
-- migration would block boot entirely, and deleting them is not this
-- migration's call. Give them a placeholder workspace instead; it is inert
-- (nobody is a member) and a later signup creates its own tenant as normal.
INSERT INTO "Tenant" ("id", "name", "slug", "status", "createdAt", "updatedAt")
SELECT 'tenant-orphaned-roles', 'Default Workspace', 'default', 'ACTIVE', now(), now()
WHERE EXISTS (SELECT 1 FROM "Role")
  AND NOT EXISTS (SELECT 1 FROM "Tenant");

-- Backfill: every pre-existing role belongs to the one pre-existing tenant.
-- On a fresh install both tables are empty and this is a no-op.
UPDATE "Role"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL;

-- Backfill Permission from its owning Role rather than from the tenant lookup,
-- so the denormalized column is correct by construction.
UPDATE "Permission" p
SET "tenantId" = r."tenantId"
FROM "Role" r
WHERE r.id = p."roleId"
  AND p."tenantId" IS NULL;

-- Belt-and-braces: a Permission whose Role vanished would block the NOT NULL
-- below. Verified unreachable in practice — Permission.roleId carries a real FK
-- to Role, so an orphan cannot be inserted — but a no-op DELETE costs nothing
-- and a failed migration on a customer install costs a lot.
DELETE FROM "Permission" WHERE "tenantId" IS NULL;

-- Enforce
ALTER TABLE "Role" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Permission" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Role_tenantId_idx" ON "Role"("tenantId");

-- CreateIndex
CREATE INDEX "Permission_tenantId_idx" ON "Permission"("tenantId");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
