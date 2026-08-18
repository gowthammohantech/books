-- Per-contact "Account Credit": a running credit a business can manually grant
-- a customer (goodwill, timely-payment bonus, promo) and later redeem against
-- a future invoice. Additive/non-destructive: 1 new enum + 1 new table.
--
-- Balance is ALWAYS computed on the fly (see lib/contacts/accountCreditBalance.ts)
-- from SUM(GRANT) - SUM(REDEMPTION) over non-voided rows — nothing here stores a
-- denormalized running balance.
--
-- Written idempotently (IF NOT EXISTS / guarded DO blocks) to match this repo's
-- convention for hand-written migrations that touch self-hosted installs which
-- may retry a partially-applied `prisma migrate deploy` (see 20260628210000_mtd_config).

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountCreditEntryType') THEN
        CREATE TYPE "AccountCreditEntryType" AS ENUM ('GRANT', 'REDEMPTION');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AccountCreditEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "AccountCreditEntryType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "invoiceId" TEXT,
    "invoicePaymentId" TEXT,
    "currencyCode" TEXT,
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountCreditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountCreditEntry_userId_contactId_idx" ON "AccountCreditEntry"("userId", "contactId");
CREATE INDEX IF NOT EXISTS "AccountCreditEntry_invoiceId_idx" ON "AccountCreditEntry"("invoiceId");
CREATE INDEX IF NOT EXISTS "AccountCreditEntry_invoicePaymentId_idx" ON "AccountCreditEntry"("invoicePaymentId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AccountCreditEntry_userId_fkey'
    ) THEN
        ALTER TABLE "AccountCreditEntry"
            ADD CONSTRAINT "AccountCreditEntry_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AccountCreditEntry_contactId_fkey'
    ) THEN
        ALTER TABLE "AccountCreditEntry"
            ADD CONSTRAINT "AccountCreditEntry_contactId_fkey"
            FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AccountCreditEntry_invoiceId_fkey'
    ) THEN
        ALTER TABLE "AccountCreditEntry"
            ADD CONSTRAINT "AccountCreditEntry_invoiceId_fkey"
            FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AccountCreditEntry_invoicePaymentId_fkey'
    ) THEN
        ALTER TABLE "AccountCreditEntry"
            ADD CONSTRAINT "AccountCreditEntry_invoicePaymentId_fkey"
            FOREIGN KEY ("invoicePaymentId") REFERENCES "InvoicePayment"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
