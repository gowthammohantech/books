-- P2 / M8: denormalize `tenantId` onto the AI, time-tracking and payroll children.
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

-- AiChatMessage: tenant via AiChatMessage.sessionId -> AiChatSession."userId"
ALTER TABLE "AiChatMessage" ADD COLUMN "tenantId" TEXT;

UPDATE "AiChatMessage" c
SET "tenantId" = p."userId"
FROM "AiChatSession" p
WHERE p.id = c."sessionId";

UPDATE "AiChatMessage"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL
   OR "tenantId" NOT IN (SELECT id FROM "Tenant");

-- A row that STILL has no tenant means there is no Tenant at all, i.e. a fresh
-- install where the table is necessarily empty. Deleting nothing is correct;
-- leaving a NULL would fail the NOT NULL below.
DELETE FROM "AiChatMessage" WHERE "tenantId" IS NULL;

ALTER TABLE "AiChatMessage" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "AiChatMessage_tenantId_idx" ON "AiChatMessage"("tenantId");
ALTER TABLE "AiChatMessage" ADD CONSTRAINT "AiChatMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TimeEntry: tenant via TimeEntry.timesheetId -> Timesheet."userId"
ALTER TABLE "TimeEntry" ADD COLUMN "tenantId" TEXT;

UPDATE "TimeEntry" c
SET "tenantId" = p."userId"
FROM "Timesheet" p
WHERE p.id = c."timesheetId";

UPDATE "TimeEntry"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL
   OR "tenantId" NOT IN (SELECT id FROM "Tenant");

-- A row that STILL has no tenant means there is no Tenant at all, i.e. a fresh
-- install where the table is necessarily empty. Deleting nothing is correct;
-- leaving a NULL would fail the NOT NULL below.
DELETE FROM "TimeEntry" WHERE "tenantId" IS NULL;

ALTER TABLE "TimeEntry" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "TimeEntry_tenantId_idx" ON "TimeEntry"("tenantId");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LeaveRequestDay: tenant via LeaveRequestDay.leaveRequestId -> LeaveRequest."userId"
ALTER TABLE "LeaveRequestDay" ADD COLUMN "tenantId" TEXT;

UPDATE "LeaveRequestDay" c
SET "tenantId" = p."userId"
FROM "LeaveRequest" p
WHERE p.id = c."leaveRequestId";

UPDATE "LeaveRequestDay"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL
   OR "tenantId" NOT IN (SELECT id FROM "Tenant");

-- A row that STILL has no tenant means there is no Tenant at all, i.e. a fresh
-- install where the table is necessarily empty. Deleting nothing is correct;
-- leaving a NULL would fail the NOT NULL below.
DELETE FROM "LeaveRequestDay" WHERE "tenantId" IS NULL;

ALTER TABLE "LeaveRequestDay" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "LeaveRequestDay_tenantId_idx" ON "LeaveRequestDay"("tenantId");
ALTER TABLE "LeaveRequestDay" ADD CONSTRAINT "LeaveRequestDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayRunLine: tenant via PayRunLine.payRunId -> PayRun."userId"
ALTER TABLE "PayRunLine" ADD COLUMN "tenantId" TEXT;

UPDATE "PayRunLine" c
SET "tenantId" = p."userId"
FROM "PayRun" p
WHERE p.id = c."payRunId";

UPDATE "PayRunLine"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL
   OR "tenantId" NOT IN (SELECT id FROM "Tenant");

-- A row that STILL has no tenant means there is no Tenant at all, i.e. a fresh
-- install where the table is necessarily empty. Deleting nothing is correct;
-- leaving a NULL would fail the NOT NULL below.
DELETE FROM "PayRunLine" WHERE "tenantId" IS NULL;

ALTER TABLE "PayRunLine" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "PayRunLine_tenantId_idx" ON "PayRunLine"("tenantId");
ALTER TABLE "PayRunLine" ADD CONSTRAINT "PayRunLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
