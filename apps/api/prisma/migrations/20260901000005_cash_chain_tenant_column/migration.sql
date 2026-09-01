-- P2 / M6: denormalize `tenantId` onto the bank and petty-cash registers.
--
-- These tables reach their tenant only through a parent FK. lib/tenantGuard.ts
-- can inject a top-level `where` and nothing else -- it cannot generate a
-- relation-traversal filter per model -- so each child needs its own tenant
-- column. It is also what lets the composite document-number uniques in P4
-- exist at all (e.g. SupplierPayment (tenantId, paymentId)).
--
-- Backfill order, matching 20260702000001_pettycash_tenant_scope:
--   1) copy the tenant down from the parent row;
--   2) FINAL FALLBACK: coerce anything that is not a live Tenant id to the
--      install's tenant. A pre-20260612000000_user_owner install could have
--      business rows stamped with a STAFF user id rather than the owner id
--      (the `ownerId ?? id` rule did not exist yet), and those would fail the
--      foreign key below. Assigning them to the sole tenant matches the
--      single-org semantics they were created under.
--
-- Additive only: no application code reads these columns yet.

-- BankTransaction: tenant via BankTransaction.bankAccountId -> BankDetail."userId"
ALTER TABLE "BankTransaction" ADD COLUMN "tenantId" TEXT;

UPDATE "BankTransaction" c
SET "tenantId" = p."userId"
FROM "BankDetail" p
WHERE p.id = c."bankAccountId";

UPDATE "BankTransaction"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL
   OR "tenantId" NOT IN (SELECT id FROM "Tenant");

-- A row that STILL has no tenant means there is no Tenant at all, i.e. a fresh
-- install where the table is necessarily empty. Deleting nothing is correct;
-- leaving a NULL would fail the NOT NULL below.
DELETE FROM "BankTransaction" WHERE "tenantId" IS NULL;

ALTER TABLE "BankTransaction" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "BankTransaction_tenantId_idx" ON "BankTransaction"("tenantId");
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PettyCashTransaction: tenant via PettyCashTransaction.pettyCashId -> PettyCash."userId"
ALTER TABLE "PettyCashTransaction" ADD COLUMN "tenantId" TEXT;

UPDATE "PettyCashTransaction" c
SET "tenantId" = p."userId"
FROM "PettyCash" p
WHERE p.id = c."pettyCashId";

UPDATE "PettyCashTransaction"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL
   OR "tenantId" NOT IN (SELECT id FROM "Tenant");

-- A row that STILL has no tenant means there is no Tenant at all, i.e. a fresh
-- install where the table is necessarily empty. Deleting nothing is correct;
-- leaving a NULL would fail the NOT NULL below.
DELETE FROM "PettyCashTransaction" WHERE "tenantId" IS NULL;

ALTER TABLE "PettyCashTransaction" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "PettyCashTransaction_tenantId_idx" ON "PettyCashTransaction"("tenantId");
ALTER TABLE "PettyCashTransaction" ADD CONSTRAINT "PettyCashTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
