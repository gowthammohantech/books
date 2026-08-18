-- Resend provider config on the EmailSettings master.
ALTER TABLE "EmailSettings" ADD COLUMN "resendFromName" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN "resendFromEmail" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN "resendApiKey" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN "resend_status" BOOLEAN DEFAULT false;
