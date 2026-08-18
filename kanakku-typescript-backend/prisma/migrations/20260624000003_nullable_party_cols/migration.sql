ALTER TABLE "Invoice"         ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "Invoice"         ALTER COLUMN "billTo" DROP NOT NULL;
ALTER TABLE "CreditNote"      ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "CreditNote"      ALTER COLUMN "billTo" DROP NOT NULL;
ALTER TABLE "DeliveryChallan" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "DeliveryChallan" ALTER COLUMN "billTo" DROP NOT NULL;
ALTER TABLE "Quotation"       ALTER COLUMN "billTo" DROP NOT NULL;
ALTER TABLE "Vehicle"         ALTER COLUMN "customerId" DROP NOT NULL;
