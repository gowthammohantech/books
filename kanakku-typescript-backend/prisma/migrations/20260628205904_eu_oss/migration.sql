-- EU One-Stop-Shop (OSS) registration flag. Additive, non-destructive.
--
-- CompanySettings.ossRegistered: per-tenant toggle. When ON, B2C cross-border EU
-- supplies are taxed at the DESTINATION member-state rate (instead of origin).
-- OFF by default so existing tenants keep the current origin-rate behaviour and
-- reverse-charge (B2B) / domestic supplies are unaffected.
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "ossRegistered" BOOLEAN NOT NULL DEFAULT false;
