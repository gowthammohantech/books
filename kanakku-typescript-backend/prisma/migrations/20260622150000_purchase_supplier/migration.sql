-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "Purchase" ALTER COLUMN "billTo" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "billTo" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL;
