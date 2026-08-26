ALTER TABLE "Purchase"       DROP CONSTRAINT IF EXISTS "Purchase_vendorId_fkey";
ALTER TABLE "Purchase"       DROP COLUMN IF EXISTS "vendorId";
ALTER TABLE "PurchaseOrder"  DROP CONSTRAINT IF EXISTS "PurchaseOrder_vendorId_fkey";
ALTER TABLE "PurchaseOrder"  DROP COLUMN IF EXISTS "vendorId";
ALTER TABLE "DebitNote"      DROP CONSTRAINT IF EXISTS "DebitNote_vendorId_fkey";
ALTER TABLE "DebitNote"      DROP COLUMN IF EXISTS "vendorId";
ALTER TABLE "DebitNote"      DROP CONSTRAINT IF EXISTS "DebitNote_billTo_fkey";
ALTER TABLE "DebitNote"      DROP COLUMN IF EXISTS "billTo";
