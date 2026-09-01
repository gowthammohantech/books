ALTER TABLE "SupplierPayment" ADD COLUMN "isVoided" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SupplierPayment" ADD COLUMN "voidedById" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "SupplierPayment" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE SET NULL;
