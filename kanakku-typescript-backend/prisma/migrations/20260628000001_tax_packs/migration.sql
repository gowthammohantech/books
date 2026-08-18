-- Tax packs: UK/EU/AU/NZ regimes + tenant & contact tax identifiers (additive, non-destructive).

-- 1) New TaxRegime enum values.
-- NOTE: Postgres requires ALTER TYPE ... ADD VALUE for enums, and (pre-PG12 caveats aside)
-- a newly added enum value cannot be USED in the same transaction it was added in.
-- Prisma's migrate engine runs each statement separately, so the ADD VALUEs below are
-- committed before the ALTER TABLE statements that follow. The new columns are plain
-- TEXT/VARCHAR (they do not reference the new enum values), so there is no unsafe usage.
ALTER TYPE "TaxRegime" ADD VALUE IF NOT EXISTS 'VAT_UK';
ALTER TYPE "TaxRegime" ADD VALUE IF NOT EXISTS 'VAT_EU';
ALTER TYPE "TaxRegime" ADD VALUE IF NOT EXISTS 'GST_AU';
ALTER TYPE "TaxRegime" ADD VALUE IF NOT EXISTS 'GST_NZ';

-- 2) Tenant-level tax registration identifiers on CompanySettings.
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "gstin" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "vatNumber" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "abn" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "nzGstNumber" TEXT;

-- 3) Contact: customer VAT number + country code (for EU cross-border / reverse-charge detection).
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "vatNumber" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "country" TEXT;
