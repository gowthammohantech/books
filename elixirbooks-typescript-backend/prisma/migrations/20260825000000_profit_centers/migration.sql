-- Profit Centers (department-wise accounting)
--
-- Extends the existing P3.3 CostCenter dimension (20260607040000_p3_dimensions)
-- into a full department master:
--   * a PROFIT/COST/BOTH discriminator so one master serves both roles
--   * a parent link so departments can roll up into divisions
--   * per-centre document numbering (numberPrefix + nextNumber)
--   * soft delete, matching the rest of the schema
--
-- and extends dimension tagging to the five transactional documents that the
-- original migration skipped (Quotation, CreditNote, DebitNote, PurchaseOrder,
-- DeliveryChallan).
--
-- Every column is additive with a safe default, so existing rows and the
-- existing /reports/pnl-by-cost-center report are unaffected.

-- ============================================================
-- CostCenter: type / hierarchy / numbering / soft delete
-- ============================================================

CREATE TYPE "CostCenterType" AS ENUM ('PROFIT', 'COST', 'BOTH');

-- Default BOTH: pre-existing centres carry no type information, and BOTH is the
-- only value that keeps them eligible for every report they already appear in.
ALTER TABLE "CostCenter" ADD COLUMN "type"         "CostCenterType" NOT NULL DEFAULT 'BOTH';
ALTER TABLE "CostCenter" ADD COLUMN "description"  TEXT;
ALTER TABLE "CostCenter" ADD COLUMN "parentId"     TEXT;

-- Per-centre document numbering. NULL prefix => this centre has no series of
-- its own and its documents fall back to the install-wide sequence.
ALTER TABLE "CostCenter" ADD COLUMN "numberPrefix" TEXT;
ALTER TABLE "CostCenter" ADD COLUMN "nextNumber"   INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CostCenter" ADD COLUMN "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CostCenter_parentId_idx"        ON "CostCenter"("parentId");
CREATE INDEX "CostCenter_userId_isDeleted_idx" ON "CostCenter"("userId", "isDeleted");

-- Two centres in the same tenant must not share a document prefix, or their
-- sequences would collide into the globally-unique document number columns.
-- Postgres treats NULLs as distinct in a unique index, so any number of
-- unprefixed centres (the common case) coexist without a partial index —
-- which matters because Prisma cannot express a WHERE clause here and would
-- report one as drift.
CREATE UNIQUE INDEX "CostCenter_userId_numberPrefix_key"
    ON "CostCenter"("userId", "numberPrefix");

-- ============================================================
-- Dimension columns on the remaining transactional documents
-- ============================================================

ALTER TABLE "Quotation"       ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "CreditNote"      ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "DebitNote"       ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "PurchaseOrder"   ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "costCenterId" TEXT;

ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Quotation_costCenterId_idx"       ON "Quotation"("costCenterId");
CREATE INDEX "CreditNote_costCenterId_idx"      ON "CreditNote"("costCenterId");
CREATE INDEX "DebitNote_costCenterId_idx"       ON "DebitNote"("costCenterId");
CREATE INDEX "PurchaseOrder_costCenterId_idx"   ON "PurchaseOrder"("costCenterId");
CREATE INDEX "DeliveryChallan_costCenterId_idx" ON "DeliveryChallan"("costCenterId");

-- The original p3_dimensions migration indexed costCenterId on JournalLine only.
-- Departmental list filtering reads these three directly, so index them too.
CREATE INDEX "Invoice_costCenterId_idx"  ON "Invoice"("costCenterId");
CREATE INDEX "Expense_costCenterId_idx"  ON "Expense"("costCenterId");
CREATE INDEX "Purchase_costCenterId_idx" ON "Purchase"("costCenterId");
