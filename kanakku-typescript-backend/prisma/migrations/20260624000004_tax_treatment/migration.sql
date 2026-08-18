-- New regime-agnostic treatment enum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'REVERSE_CHARGE', 'OUT_OF_SCOPE');

-- Add the new column (nullable first so we can backfill), then default + not null
ALTER TABLE "Contact" ADD COLUMN "defaultTaxTreatment" "TaxTreatment";

-- Backfill from the old vatMode: ALWAYS->STANDARD, NEVER->OUT_OF_SCOPE, UK_VAT_AREA->STANDARD
UPDATE "Contact" SET "defaultTaxTreatment" =
  CASE "vatMode"
    WHEN 'NEVER' THEN 'OUT_OF_SCOPE'::"TaxTreatment"
    ELSE 'STANDARD'::"TaxTreatment"
  END;

ALTER TABLE "Contact" ALTER COLUMN "defaultTaxTreatment" SET DEFAULT 'STANDARD';
ALTER TABLE "Contact" ALTER COLUMN "defaultTaxTreatment" SET NOT NULL;

-- Drop the old column + enum (unused by any tax logic)
ALTER TABLE "Contact" DROP COLUMN "vatMode";
DROP TYPE "ContactVatMode";
