-- OPTIONAL online EU VIES VAT-number validation. Additive, non-destructive.
-- All columns are nullable or defaulted so existing rows are unaffected.
--
-- CompanySettings.viesValidationEnabled: per-tenant opt-in toggle. OFF by default
-- so the outbound VIES call (a phone-home to the EU gov service) never fires
-- unless the tenant explicitly enables it.
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "viesValidationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Contact.viesValid / viesCheckedAt: audit of the last online VIES check.
-- NULL = never checked (VIES disabled, non-EU VAT, or no VAT number). Validation
-- is fail-open and non-blocking: these flag the contact but never reject a save.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "viesValid" BOOLEAN;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "viesCheckedAt" TIMESTAMP(3);
