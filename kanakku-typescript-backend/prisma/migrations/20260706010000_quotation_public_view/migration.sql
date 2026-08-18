-- Quotation public-view fields (mirrors Invoice.publicViewToken/publicViewEnabled from
-- 20260525170040_b4_public_view). Quotations never got the equivalent, so the emailed
-- "View Quotation Link" pointed at a staff-only /admin/view-quotation/:id route that
-- 404s for an external recipient with no login.
--
-- Written idempotently (IF NOT EXISTS-guarded) to match this repo's convention for
-- hand-written migrations that touch self-hosted installs which may retry a
-- partially-applied `prisma migrate deploy` (see 20260628210000_mtd_config,
-- 20260706000000_account_credit).

ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "publicViewToken" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "publicViewEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_publicViewToken_key" ON "Quotation"("publicViewToken");
