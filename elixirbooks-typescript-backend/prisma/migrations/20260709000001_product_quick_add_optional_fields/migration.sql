-- Allow duplicate descriptions: drop the unique index on Product.name
DROP INDEX IF EXISTS "Product_name_key";

-- Make catalog foreign keys optional (FK constraints remain valid on NULLs)
ALTER TABLE "Product" ALTER COLUMN "categoryId" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "brandId" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "taxGroupId" DROP NOT NULL;

-- Make barcode optional (its unique index still permits multiple NULLs in Postgres)
ALTER TABLE "Product" ALTER COLUMN "barcode" DROP NOT NULL;

-- Defaults so omitted numeric / enum fields fill automatically
ALTER TABLE "Product" ALTER COLUMN "selling_price"  SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "purchase_price" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "discount_value" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "alert_quantity" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "discount_type"  SET DEFAULT 'Fixed';
