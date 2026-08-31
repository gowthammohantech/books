-- Server-authoritative invoice tax: EU reverse-charge marker + note on Invoice.
-- Additive, non-destructive. `reverseCharge` defaults to false; `reverseChargeNote`
-- holds the human-readable reverse-charge statement when an EU B2B cross-border
-- supply is zero-rated (set by the tax engine via REVERSE_CHARGE_NOTE).
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "reverseCharge" BOOLEAN DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "reverseChargeNote" TEXT;
