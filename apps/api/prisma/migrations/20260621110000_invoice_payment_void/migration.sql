ALTER TABLE "InvoicePayment"
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "isVoided" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voidedById" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT;
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE SET NULL;
