-- P3.5 — Inventory FIFO + Landed Cost

-- 1. Add valuationMethod to Product (default WAC — zero impact on existing rows)
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "valuationMethod" TEXT NOT NULL DEFAULT 'WAC';

-- 2. Add landedCost to Purchase (optional — null for existing rows)
ALTER TABLE "Purchase"
  ADD COLUMN IF NOT EXISTS "landedCost" DECIMAL(18, 4);

-- 3. Create InventoryCostLayer table
CREATE TABLE IF NOT EXISTS "InventoryCostLayer" (
    "id"           TEXT             NOT NULL,
    "userId"       TEXT             NOT NULL,
    "productId"    TEXT             NOT NULL,
    "qtyRemaining" DECIMAL(18, 4)   NOT NULL,
    "unitCost"     DECIMAL(18, 4)   NOT NULL,
    "receivedAt"   TIMESTAMP(3)     NOT NULL,
    "sourceType"   TEXT,
    "sourceId"     TEXT,
    "isDeleted"    BOOLEAN          NOT NULL DEFAULT FALSE,
    "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryCostLayer_pkey" PRIMARY KEY ("id")
);

-- 4. Index for efficient oldest-first load per product
CREATE INDEX IF NOT EXISTS "InventoryCostLayer_userId_productId_receivedAt_idx"
  ON "InventoryCostLayer" ("userId", "productId", "receivedAt");
