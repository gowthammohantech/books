-- P5 / M12: per-tenant API keys for the server-to-server integration.
--
-- The external API authenticated against one install-wide env var
-- (WHATSAPPCRM_API_KEY). That is fine when the install IS one company, and
-- meaningless afterwards: a request carrying that key says nothing about which
-- workspace the contact it is pushing belongs to, which is why
-- externalController.upsertCustomer resolved the target by looking up "the sole
-- admin". A key that names its own tenant removes the guess.
--
-- ONLY THE HASH IS STORED. The key is generated, shown once, and never
-- persisted in a recoverable form — a database leak therefore does not hand an
-- attacker working credentials. `prefix` is the non-secret leading characters
-- so a human can tell two keys apart in the UI.
--
-- NO BACKFILL. There is deliberately no attempt to mint a row for an existing
-- WHATSAPPCRM_API_KEY: doing so would have to write a hash of a secret this
-- migration cannot see. middleware/apiKeyAuth.js keeps accepting that env key
-- for backward compatibility instead, under the narrow conditions documented
-- there, so upgrading installs keep working with nothing to do.

CREATE TABLE "TenantApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantApiKey_keyHash_key" ON "TenantApiKey"("keyHash");

CREATE INDEX "TenantApiKey_tenantId_idx" ON "TenantApiKey"("tenantId");

ALTER TABLE "TenantApiKey" ADD CONSTRAINT "TenantApiKey_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
