-- Add RESEND to the email provider enum (separate migration: a new enum value
-- cannot be used in the same transaction it is created in).
ALTER TYPE "EmailSettingsProviderType" ADD VALUE IF NOT EXISTS 'RESEND';
