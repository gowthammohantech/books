-- P2 / M9: replace Reminder.companyId with a real tenant column.
--
-- Reminder.companyId was the ONLY companyId in the schema and it pointed at
-- CompanySettings, not User -- a third spelling of "tenant" alongside
-- `User.ownerId` and every business table's `userId`. It is also dead in
-- application code: `grep -rn companyId controllers lib routes` finds nothing
-- outside the schema, and the value is only ever written through
-- `company: { connect: { id } }` in reminderController. So it is replaced
-- outright rather than kept in parallel.
--
-- THIS IS A CORRECTNESS FIX, NOT JUST PLUMBING. reminderController gates
-- ownership on `reminder.createdBy !== requireUserId(req)` -- comparing an
-- ACTOR column against a TENANT id. That only ever worked because the owner
-- created every reminder; any reminder created by a staff member was invisible
-- to their colleagues and to the owner. Scoping by tenantId fixes it.
--
-- CompanySettings is 1:1 with its owning user (userId is @unique), so the join
-- below yields exactly one tenant per reminder.

ALTER TABLE "Reminder" ADD COLUMN "tenantId" TEXT;

UPDATE "Reminder" r
SET "tenantId" = cs."userId"
FROM "CompanySettings" cs
WHERE cs.id = r."companyId";

-- FINAL FALLBACK, as in the sibling P2 migrations: a CompanySettings row whose
-- userId is not itself a tenant (possible on a pre-user_owner install) would
-- fail the foreign key below.
UPDATE "Reminder"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL
   OR "tenantId" NOT IN (SELECT id FROM "Tenant");

-- Still NULL means there is no Tenant at all -- a fresh install, where the
-- table is necessarily empty.
DELETE FROM "Reminder" WHERE "tenantId" IS NULL;

ALTER TABLE "Reminder" ALTER COLUMN "tenantId" SET NOT NULL;

-- Swap the composite index over in place: (companyId, status) becomes
-- (tenantId, status), which is what the cron's due-reminder scan uses.
DROP INDEX IF EXISTS "Reminder_companyId_status_idx";
CREATE INDEX "Reminder_tenantId_status_idx" ON "Reminder"("tenantId", "status");

ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retire the old column and its FK. Safe to drop in the same migration as the
-- replacement (unlike User.ownerId / User.roleId, which are deferred to P9)
-- because no code path reads companyId today.
ALTER TABLE "Reminder" DROP CONSTRAINT IF EXISTS "Reminder_companyId_fkey";
ALTER TABLE "Reminder" DROP COLUMN "companyId";
