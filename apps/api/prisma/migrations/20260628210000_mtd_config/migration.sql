-- HMRC Making Tax Digital (MTD) VAT per-tenant config. Additive, non-destructive.
--
-- BYOK: the operator supplies HMRC software-vendor credentials (clientId/clientSecret)
-- and, after OAuth, accessToken/refreshToken are stored here. clientSecret,
-- accessToken and refreshToken hold `enc::` ciphertext at rest (see lib/emailSecret +
-- lib/configSecret); they are never returned cleartext. Off by default (enabled=false)
-- and sandbox-first (useSandbox=true) so the demo / self-host works with zero HMRC setup.
CREATE TABLE IF NOT EXISTS "MtdConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "vrn" TEXT,
    "useSandbox" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MtdConfig_pkey" PRIMARY KEY ("id")
);

-- One MTD config per tenant (userId is the owner/tenant key).
CREATE UNIQUE INDEX IF NOT EXISTS "MtdConfig_userId_key" ON "MtdConfig"("userId");

-- FK to User, matching the AccountingIntegration / MessagingConfig pattern.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MtdConfig_userId_fkey'
    ) THEN
        ALTER TABLE "MtdConfig"
            ADD CONSTRAINT "MtdConfig_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
