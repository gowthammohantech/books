-- Invoice item-picker display toggles on CompanySettings (per-tenant opt-in/opt-out
-- of extra columns/affordances in the invoice line-item product picker).
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "itemPickerShowRate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "itemPickerShowStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "itemPickerShowImage" BOOLEAN NOT NULL DEFAULT false;
