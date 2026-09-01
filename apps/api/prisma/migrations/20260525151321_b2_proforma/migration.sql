-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('INVOICE', 'PROFORMA');

-- AlterTable: add columns
ALTER TABLE "Invoice" ADD COLUMN "invoiceType" "InvoiceType" NOT NULL DEFAULT 'INVOICE';
ALTER TABLE "Invoice" ADD COLUMN "convertedFromId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "convertedAt" TIMESTAMP(3);

-- FK + indexes
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_convertedFromId_fkey" FOREIGN KEY ("convertedFromId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Invoice_invoiceType_idx" ON "Invoice"("invoiceType");
CREATE INDEX "Invoice_convertedFromId_idx" ON "Invoice"("convertedFromId");
