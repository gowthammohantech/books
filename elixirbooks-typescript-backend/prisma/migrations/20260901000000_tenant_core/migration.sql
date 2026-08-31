-- P1 / M1: the tenancy core — Tenant + TenantMembership.
--
-- Before this migration "tenant" meant "the company-owner user id": every
-- business table's `userId` column held `User.ownerId ?? User.id`, and an
-- install was capped at a single owner by the registration guard in
-- controllers/authController.ts.
--
-- KEY DECISION: tenant #1 is created with `id` = the primary owner's User.id,
-- not a fresh uuid. Every existing tenant column therefore ALREADY holds a
-- valid Tenant.id, which means:
--   * the later column rename (tenant_column_rename) needs zero UPDATEs on
--     business tables — it is pure DDL;
--   * every already-issued JWT, whose `tenantId` claim is that same owner id,
--     keeps resolving correctly, so deploying this does not log anyone out.
--
-- Fresh installs (no real users yet) get no Tenant row at all — they go
-- through self-serve signup, which creates the tenant itself.

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_userId_tenantId_key" ON "TenantMembership"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_status_idx" ON "TenantMembership"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_status_idx" ON "TenantMembership"("userId", "status");

-- AlterTable: which workspace to reopen on next login (advisory only).
ALTER TABLE "User" ADD COLUMN "lastTenantId" TEXT;

-- Backfill: create tenant #1 for an existing install.
--
-- The owner selector is byte-identical to backfill (4) in
-- 20260702000001_pettycash_tenant_scope so both migrations agree on exactly
-- which row is "the install's primary admin": the earliest-created user_type=1
-- account, falling back to the earliest-created user overall.
--
-- user_type = 999 is excluded: prisma/seed.ts creates a `sys-bootstrap` user
-- with that type purely as an FK target for Currency.createdBy, and it must
-- never be mistaken for a real account. A fresh install has only that row, so
-- this INSERT selects nothing and no Tenant is created.
INSERT INTO "Tenant" ("id", "name", "slug", "status", "createdAt", "updatedAt")
SELECT
  u.id,
  COALESCE(
    NULLIF(TRIM((SELECT cs."companyName" FROM "CompanySettings" cs WHERE cs."userId" = u.id LIMIT 1)), ''),
    'Default Workspace'
  ),
  'default',
  'ACTIVE',
  now(),
  now()
FROM "User" u
WHERE u."isDeleted" = false
  AND u.user_type <> 999
ORDER BY
  CASE WHEN u.user_type = 1 THEN 0 ELSE 1 END,
  u."createdAt" ASC
LIMIT 1;

-- Backfill: one membership per real user of that tenant.
--
-- This permanently replaces prisma/seedUserOwner.ts, whose boot-time job was to
-- point every staff user's `ownerId` at the single owner. Note the scope is
-- WIDER than that seeder's: it also covers the owner itself (ownerId IS NULL)
-- and users the seeder skipped, because a tenant with an unmembered owner would
-- lock that owner out entirely once `protect` requires a membership.
--
-- `isOwner` is true for the one user whose id IS the tenant id; `roleId` is
-- carried over from User.roleId, which the app stops reading in P5.
INSERT INTO "TenantMembership" ("id", "userId", "tenantId", "roleId", "status", "isOwner", "joinedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u.id,
  t.id,
  u."roleId",
  'ACTIVE',
  (u.id = t.id),
  u."createdAt",
  now(),
  now()
FROM "User" u
CROSS JOIN "Tenant" t
WHERE u."isDeleted" = false
  AND u.user_type <> 999
  AND (u.id = t.id OR u."ownerId" = t.id OR u."ownerId" IS NULL)
ON CONFLICT ("userId", "tenantId") DO NOTHING;

-- Seed lastTenantId so the first post-deploy login lands in the right place.
UPDATE "User" u
SET "lastTenantId" = m."tenantId"
FROM "TenantMembership" m
WHERE m."userId" = u.id
  AND u."lastTenantId" IS NULL;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lastTenantId_fkey" FOREIGN KEY ("lastTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
