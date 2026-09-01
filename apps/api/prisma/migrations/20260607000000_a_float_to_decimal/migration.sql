ALTER TABLE "User" ALTER COLUMN "balance" TYPE DECIMAL(18,4) USING ("balance"::numeric), ALTER COLUMN "balance" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "selling_price" TYPE DECIMAL(18,4) USING ("selling_price"::numeric);
ALTER TABLE "Product" ALTER COLUMN "purchase_price" TYPE DECIMAL(18,4) USING ("purchase_price"::numeric);
ALTER TABLE "Product" ALTER COLUMN "discount_value" TYPE DECIMAL(18,4) USING ("discount_value"::numeric);
ALTER TABLE "Supplier" ALTER COLUMN "balance" TYPE DECIMAL(18,4) USING ("balance"::numeric), ALTER COLUMN "balance" SET DEFAULT 0;
ALTER TABLE "SupplierPayment" ALTER COLUMN "amount" TYPE DECIMAL(18,4) USING ("amount"::numeric);
ALTER TABLE "SupplierPayment" ALTER COLUMN "paidAmount" TYPE DECIMAL(18,4) USING ("paidAmount"::numeric);
ALTER TABLE "SupplierPayment" ALTER COLUMN "dueAmount" TYPE DECIMAL(18,4) USING ("dueAmount"::numeric);
