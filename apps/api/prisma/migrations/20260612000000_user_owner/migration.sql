-- Shared-workspace tenancy: link staff/admin users to a company owner.
-- ownerId = null means the row IS the owner (the sole user_type:1 account).
-- Data scope resolves to `ownerId ?? id` so a company shares one dataset.
ALTER TABLE "User" ADD COLUMN "ownerId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_ownerId_idx" ON "User"("ownerId");
