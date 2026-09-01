-- DebitNote vendor/bill-to -> Supplier migration.
-- Adds parallel Supplier FK columns; legacy User columns (vendorId, billTo)
-- are kept nullable as a fallback for pre-migration rows.

-- AlterTable
ALTER TABLE "DebitNote" ALTER COLUMN "vendorId" DROP NOT NULL;
ALTER TABLE "DebitNote" ALTER COLUMN "billTo" DROP NOT NULL;
ALTER TABLE "DebitNote" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "DebitNote" ADD COLUMN "billToSupplierId" TEXT;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_billToSupplierId_fkey" FOREIGN KEY ("billToSupplierId") REFERENCES "Supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL;
