-- Reply-To address per email provider (replies route to a real inbox while the
-- From address stays on the verified sending domain).
ALTER TABLE "EmailSettings" ADD COLUMN "nodeReplyTo" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN "smtpReplyTo" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN "resendReplyTo" TEXT;
