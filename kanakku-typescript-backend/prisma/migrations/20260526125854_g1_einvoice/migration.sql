CREATE TYPE "EInvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'CANCELLED', 'FAILED');

CREATE TABLE "EInvoiceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "irn" TEXT,
    "ackNo" TEXT,
    "ackDate" TIMESTAMP(3),
    "signedInvoice" TEXT,
    "signedQRCode" TEXT,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EInvoiceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EInvoiceRecord_irn_key" ON "EInvoiceRecord"("irn") WHERE "irn" IS NOT NULL;
CREATE INDEX "EInvoiceRecord_invoiceId_idx" ON "EInvoiceRecord"("invoiceId");
CREATE INDEX "EInvoiceRecord_userId_status_idx" ON "EInvoiceRecord"("userId", "status");
ALTER TABLE "EInvoiceRecord" ADD CONSTRAINT "EInvoiceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EInvoiceRecord" ADD CONSTRAINT "EInvoiceRecord_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
