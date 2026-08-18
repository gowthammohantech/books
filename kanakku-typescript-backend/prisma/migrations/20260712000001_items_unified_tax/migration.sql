-- Items + unified tax (spec 2026-07-12). Additive/loosening only — no
-- destructive DDL: no dropped columns/tables, taxGroupId and item_type stay.

-- 1) Loosen Product columns: unit / image / description become nullable
--    (null unitId = "-no unit-"; controller already defaults image to '').
ALTER TABLE "Product" ALTER COLUMN "unitId" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "product_image" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "description" DROP NOT NULL;

-- 2) Direct Product -> TaxRate link (nullable FK; legacy taxGroupId untouched).
ALTER TABLE "Product" ADD COLUMN "taxRateId" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRateId_fkey"
  FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Engine-provisioned GST component rows are flagged so tax lists can hide them.
ALTER TABLE "TaxRate" ADD COLUMN "isSystemComponent" BOOLEAN NOT NULL DEFAULT false;
