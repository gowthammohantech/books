-- P3.3 — Cost Centers / Job Costing: dimension tables + nullable FK columns on transactional documents

-- ============================================================
-- Create CostCenter table
-- ============================================================

CREATE TABLE "CostCenter" (
    "id"        TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "code"      TEXT        NOT NULL,
    "name"      TEXT        NOT NULL,
    "isActive"  BOOLEAN     NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostCenter_userId_code_key" ON "CostCenter"("userId", "code");
CREATE INDEX "CostCenter_userId_idx" ON "CostCenter"("userId");

-- ============================================================
-- Create Project table
-- ============================================================

CREATE TABLE "Project" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "code"      TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "status"    TEXT         NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Project_userId_code_key" ON "Project"("userId", "code");
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- ============================================================
-- Add nullable dimension columns to JournalLine
-- ============================================================

ALTER TABLE "JournalLine" ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "JournalLine" ADD COLUMN "projectId"    TEXT;

CREATE INDEX "JournalLine_costCenterId_idx" ON "JournalLine"("costCenterId");
CREATE INDEX "JournalLine_projectId_idx"    ON "JournalLine"("projectId");

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Add nullable dimension columns to Invoice
-- ============================================================

ALTER TABLE "Invoice" ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "projectId"    TEXT;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Add nullable dimension columns to Expense
-- ============================================================

ALTER TABLE "Expense" ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "projectId"    TEXT;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Add nullable dimension columns to Purchase
-- ============================================================

ALTER TABLE "Purchase" ADD COLUMN "costCenterId" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "projectId"    TEXT;

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
