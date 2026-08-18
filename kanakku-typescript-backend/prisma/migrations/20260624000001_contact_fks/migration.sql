-- Migration: add nullable contactId / billToContactId / targetContactId FK columns
-- across all 11 party models. OLD columns (customerId, supplierId, billTo, etc.)
-- are left intact — this migration is ADDITIVE ONLY.
--
-- Pattern per column:
--   1. ADD COLUMN (nullable TEXT)
--   2. ADD CONSTRAINT FK → Contact(id) ON DELETE SET NULL ON UPDATE CASCADE
--   3. CREATE INDEX on the new FK column

-- =============================================================================
-- Invoice
-- =============================================================================
ALTER TABLE "Invoice" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "billToContactId" TEXT;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billToContactId_fkey" FOREIGN KEY ("billToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Invoice_contactId_idx" ON "Invoice"("contactId");
CREATE INDEX "Invoice_billToContactId_idx" ON "Invoice"("billToContactId");

-- =============================================================================
-- Quotation
-- =============================================================================
ALTER TABLE "Quotation" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "billToContactId" TEXT;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_billToContactId_fkey" FOREIGN KEY ("billToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Quotation_contactId_idx" ON "Quotation"("contactId");
CREATE INDEX "Quotation_billToContactId_idx" ON "Quotation"("billToContactId");

-- =============================================================================
-- CreditNote
-- =============================================================================
ALTER TABLE "CreditNote" ADD COLUMN "contactId" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "billToContactId" TEXT;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_billToContactId_fkey" FOREIGN KEY ("billToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CreditNote_contactId_idx" ON "CreditNote"("contactId");
CREATE INDEX "CreditNote_billToContactId_idx" ON "CreditNote"("billToContactId");

-- =============================================================================
-- DeliveryChallan
-- =============================================================================
ALTER TABLE "DeliveryChallan" ADD COLUMN "contactId" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "billToContactId" TEXT;
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_billToContactId_fkey" FOREIGN KEY ("billToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "DeliveryChallan_contactId_idx" ON "DeliveryChallan"("contactId");
CREATE INDEX "DeliveryChallan_billToContactId_idx" ON "DeliveryChallan"("billToContactId");

-- =============================================================================
-- Reminder
-- =============================================================================
ALTER TABLE "Reminder" ADD COLUMN "targetContactId" TEXT;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_targetContactId_fkey" FOREIGN KEY ("targetContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Reminder_targetContactId_idx" ON "Reminder"("targetContactId");

-- =============================================================================
-- Vehicle
-- =============================================================================
ALTER TABLE "Vehicle" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Vehicle_contactId_idx" ON "Vehicle"("contactId");

-- =============================================================================
-- Purchase
-- =============================================================================
ALTER TABLE "Purchase" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Purchase_contactId_idx" ON "Purchase"("contactId");

-- =============================================================================
-- PurchaseOrder
-- =============================================================================
ALTER TABLE "PurchaseOrder" ADD COLUMN "contactId" TEXT;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PurchaseOrder_contactId_idx" ON "PurchaseOrder"("contactId");

-- =============================================================================
-- SupplierPayment
-- =============================================================================
ALTER TABLE "SupplierPayment" ADD COLUMN "contactId" TEXT;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SupplierPayment_contactId_idx" ON "SupplierPayment"("contactId");

-- =============================================================================
-- DebitNote
-- =============================================================================
ALTER TABLE "DebitNote" ADD COLUMN "contactId" TEXT;
ALTER TABLE "DebitNote" ADD COLUMN "billToContactId" TEXT;
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_billToContactId_fkey" FOREIGN KEY ("billToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "DebitNote_contactId_idx" ON "DebitNote"("contactId");
CREATE INDEX "DebitNote_billToContactId_idx" ON "DebitNote"("billToContactId");

-- =============================================================================
-- Expense
-- =============================================================================
ALTER TABLE "Expense" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Expense_contactId_idx" ON "Expense"("contactId");
