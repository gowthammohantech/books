-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('GST_INDIA', 'VAT_GENERIC', 'US_SALES_TAX', 'NONE');

-- CreateEnum
CREATE TYPE "TaxKind" AS ENUM ('CGST', 'SGST', 'IGST', 'UTGST', 'CESS', 'VAT', 'SALES_TAX');

-- Rename existing columns
ALTER TABLE "TaxRate" RENAME COLUMN "tax_name" TO "name";
ALTER TABLE "TaxRate" RENAME COLUMN "tax_rate" TO "rate";
ALTER TABLE "TaxRate" ALTER COLUMN "rate" TYPE DECIMAL(7, 4);

-- Add nullable new columns first
ALTER TABLE "TaxRate" ADD COLUMN "userId" TEXT;
ALTER TABLE "TaxRate" ADD COLUMN "regime" "TaxRegime";
ALTER TABLE "TaxRate" ADD COLUMN "taxKind" "TaxKind";
ALTER TABLE "TaxRate" ADD COLUMN "countryId" TEXT;
ALTER TABLE "TaxRate" ADD COLUMN "stateId" TEXT;
ALTER TABLE "TaxRate" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TaxRate" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing rows to demo admin (so they aren't orphaned)
UPDATE "TaxRate" SET
  "userId" = (SELECT id FROM "User" WHERE email = 'admin@dreamstechnologies.com' LIMIT 1),
  "regime" = 'NONE'
WHERE "userId" IS NULL;

-- Delete orphaned rows (no demo admin existed → can't assign)
DELETE FROM "TaxRate" WHERE "userId" IS NULL;

-- Mark required columns NOT NULL
ALTER TABLE "TaxRate" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "TaxRate" ALTER COLUMN "regime" SET NOT NULL;

-- Drop deprecated columns
ALTER TABLE "TaxRate" DROP COLUMN IF EXISTS "status";
ALTER TABLE "TaxRate" DROP COLUMN IF EXISTS "created_on";

-- FKs and index on TaxRate
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "TaxRate_userId_isDeleted_regime_idx" ON "TaxRate"("userId", "isDeleted", "regime");

-- CompanySettings: regime + country FK
ALTER TABLE "CompanySettings" ADD COLUMN "taxRegime" "TaxRegime" NOT NULL DEFAULT 'NONE';
ALTER TABLE "CompanySettings" ADD COLUMN "countryId" TEXT;
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
