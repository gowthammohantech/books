-- P4 / M10: the twelve install-global catalogs become tenant-scoped.
--
-- These tables never had a tenant column at all: Product, Brand, Category,
-- Unit, TaxGroup, ExpenseCategory, CustomField(+Value,+DataType),
-- EmailTemplate, GeneralSetting and Currency were shared by the whole install.
-- On a single-tenant install that was invisible; the moment a second tenant
-- exists, every one of them leaks. Two of them leak in a way a user can SEE
-- and EDIT (Product, Currency), and one of them (GeneralSetting) is where the
-- document-number prefixes and invoice defaults live.
--
-- BACKFILL SOURCE. There is exactly one implicit tenant at this point in the
-- upgrade -- P1/M1 created it, and self-serve signup does not exist until P5 --
-- so "the primary tenant" is unambiguous and every existing row belongs to it.
-- The selector is the same ordering P1 and P2 use (oldest tenant wins), so all
-- three migrations agree on which tenant is #1.
--
-- CustomFieldValue derives its tenant from its parent CustomField rather than
-- from the constant, then falls back. Today the two are identical; expressing
-- the real derivation keeps the statement honest, and keeps it correct if a
-- future backfill ever splits these catalogs per tenant.
--
-- FRESH INSTALLS have no Tenant row and no rows in any of these tables (the
-- global seed data moves to prisma/seedTenant.ts in this same phase), so the
-- UPDATEs match nothing and the DELETEs that follow them are no-ops.
--
-- UNIQUE CONSTRAINTS. Product.code, Product.barcode, Brand.brand_name,
-- Category.category_name, Category.slug, GeneralSetting.key and
-- CustomFieldDataType.type were install-wide unique; they become
-- (tenantId, X). With one tenant at migration time a composite cannot collide
-- where the single column did not, so the swap is safe by construction.
-- None of these models soft-delete, so a plain composite unique cannot break
-- "delete a row, then recreate it with the same name" the way it would on Role.

-- ---------------------------------------------------------------------------
-- 1. Add the column, backfill, enforce.
-- ---------------------------------------------------------------------------

ALTER TABLE "Product" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Brand" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Category" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "TaxGroup" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "ExpenseCategory" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "CustomField" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "CustomFieldValue" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "CustomFieldDataType" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "GeneralSetting" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Currency" ADD COLUMN "tenantId" TEXT;

-- CustomField first, so CustomFieldValue can derive from it.
UPDATE "CustomField"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1);

UPDATE "CustomFieldValue" v
SET "tenantId" = f."tenantId"
FROM "CustomField" f
WHERE f.id = v."customFieldId";

UPDATE "Product"             SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Brand"               SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Category"            SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Unit"                SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "TaxGroup"            SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "ExpenseCategory"     SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "CustomFieldValue"    SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "CustomFieldDataType" SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "EmailTemplate"       SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "GeneralSetting"      SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Currency"            SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1) WHERE "tenantId" IS NULL;

-- Still NULL means there is no Tenant at all, i.e. a fresh install where these
-- tables are necessarily empty. Same belt-and-braces step as the P2 siblings.
DELETE FROM "CustomFieldValue"    WHERE "tenantId" IS NULL;
DELETE FROM "CustomField"         WHERE "tenantId" IS NULL;
DELETE FROM "Product"             WHERE "tenantId" IS NULL;
DELETE FROM "Brand"               WHERE "tenantId" IS NULL;
DELETE FROM "Category"            WHERE "tenantId" IS NULL;
DELETE FROM "Unit"                WHERE "tenantId" IS NULL;
DELETE FROM "TaxGroup"            WHERE "tenantId" IS NULL;
DELETE FROM "ExpenseCategory"     WHERE "tenantId" IS NULL;
DELETE FROM "CustomFieldDataType" WHERE "tenantId" IS NULL;
DELETE FROM "EmailTemplate"       WHERE "tenantId" IS NULL;
DELETE FROM "GeneralSetting"      WHERE "tenantId" IS NULL;
DELETE FROM "Currency"            WHERE "tenantId" IS NULL;

ALTER TABLE "Product"             ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Brand"               ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Category"            ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Unit"                ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "TaxGroup"            ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ExpenseCategory"     ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CustomField"         ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CustomFieldValue"    ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CustomFieldDataType" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "EmailTemplate"       ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "GeneralSetting"      ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Currency"            ALTER COLUMN "tenantId" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Swap the install-wide uniques for tenant-scoped ones.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "Product_code_key";
DROP INDEX IF EXISTS "Product_barcode_key";
DROP INDEX IF EXISTS "Brand_brand_name_key";
DROP INDEX IF EXISTS "Category_category_name_key";
DROP INDEX IF EXISTS "Category_slug_key";
DROP INDEX IF EXISTS "GeneralSetting_key_key";
DROP INDEX IF EXISTS "CustomFieldDataType_type_key";

CREATE UNIQUE INDEX "Product_tenantId_code_key" ON "Product"("tenantId", "code");
CREATE UNIQUE INDEX "Product_tenantId_barcode_key" ON "Product"("tenantId", "barcode");
CREATE UNIQUE INDEX "Brand_tenantId_brand_name_key" ON "Brand"("tenantId", "brand_name");
CREATE UNIQUE INDEX "Category_tenantId_category_name_key" ON "Category"("tenantId", "category_name");
CREATE UNIQUE INDEX "Category_tenantId_slug_key" ON "Category"("tenantId", "slug");
CREATE UNIQUE INDEX "GeneralSetting_tenantId_key_key" ON "GeneralSetting"("tenantId", "key");
CREATE UNIQUE INDEX "CustomFieldDataType_tenantId_type_key" ON "CustomFieldDataType"("tenantId", "type");

-- EmailTemplate gains a unique it never had. prisma/seedEmailTemplates.ts
-- already treats (notificationTypeId, title) as the key -- it does a findFirst
-- on exactly that tuple before creating -- but createEmailTemplate never
-- enforced it, so a real install CAN hold duplicates and the index would fail.
-- Rename the losers rather than delete them: these are user-authored email
-- bodies, and silently dropping one is far worse than an odd title.
UPDATE "EmailTemplate" e
SET "title" = e."title" || ' (' || d.rn || ')'
FROM (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY "tenantId", "notificationTypeId", "title"
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "EmailTemplate"
) d
WHERE d.id = e.id AND d.rn > 1;

CREATE UNIQUE INDEX "EmailTemplate_tenantId_notificationTypeId_title_key"
  ON "EmailTemplate"("tenantId", "notificationTypeId", "title");

-- ---------------------------------------------------------------------------
-- 3. Plain tenant indexes for the tables whose uniques do not already lead
--    with tenantId.
-- ---------------------------------------------------------------------------

CREATE INDEX "Unit_tenantId_idx" ON "Unit"("tenantId");
CREATE INDEX "TaxGroup_tenantId_idx" ON "TaxGroup"("tenantId");
CREATE INDEX "ExpenseCategory_tenantId_idx" ON "ExpenseCategory"("tenantId");
CREATE INDEX "CustomField_tenantId_idx" ON "CustomField"("tenantId");
CREATE INDEX "CustomFieldValue_tenantId_idx" ON "CustomFieldValue"("tenantId");
CREATE INDEX "Currency_tenantId_idx" ON "Currency"("tenantId");

-- ---------------------------------------------------------------------------
-- 4. Foreign keys.
-- ---------------------------------------------------------------------------

ALTER TABLE "Product"             ADD CONSTRAINT "Product_tenantId_fkey"             FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Brand"               ADD CONSTRAINT "Brand_tenantId_fkey"               FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category"            ADD CONSTRAINT "Category_tenantId_fkey"            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Unit"                ADD CONSTRAINT "Unit_tenantId_fkey"                FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxGroup"            ADD CONSTRAINT "TaxGroup_tenantId_fkey"            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseCategory"     ADD CONSTRAINT "ExpenseCategory_tenantId_fkey"     FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomField"         ADD CONSTRAINT "CustomField_tenantId_fkey"         FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomFieldValue"    ADD CONSTRAINT "CustomFieldValue_tenantId_fkey"    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomFieldDataType" ADD CONSTRAINT "CustomFieldDataType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailTemplate"       ADD CONSTRAINT "EmailTemplate_tenantId_fkey"       FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneralSetting"      ADD CONSTRAINT "GeneralSetting_tenantId_fkey"      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Currency"            ADD CONSTRAINT "Currency_tenantId_fkey"            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
