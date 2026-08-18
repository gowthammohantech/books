-- Drop old FK (pointing at User)
ALTER TABLE "SupplierPayment" DROP CONSTRAINT IF EXISTS "SupplierPayment_supplierId_fkey";
-- Allow NULL (must happen before UPDATE that sets supplierId to NULL)
ALTER TABLE "SupplierPayment" ALTER COLUMN "supplierId" DROP NOT NULL;
-- null out legacy rows whose supplierId is not a real Supplier (they pointed at User ids)
UPDATE "SupplierPayment" sp SET "supplierId" = NULL
  WHERE sp."supplierId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Supplier" s WHERE s."id" = sp."supplierId"
  );
-- Add new FK pointing at Supplier
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL;
