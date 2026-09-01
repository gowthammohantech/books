-- P4 / M11: install-wide document-number uniques become tenant-scoped.
--
-- Every one of these columns is an app-generated sequence (INV-000001,
-- PUR-000001, ...) counted PER TENANT but constrained UNIQUE ACROSS THE
-- INSTALL. That contradiction is the reason lib/documentNumbering.ts exists:
-- a young tenant computing its own next number could land on a number another
-- tenant already held, so the helper carried a 46-line comment and an
-- install-wide fallback that quietly skipped the second tenant forward. With
-- (tenantId, number) that whole mechanism becomes unnecessary, and the
-- fallback is deleted in the same commit as this migration.
--
-- Supplier.supplier_email is here for the same reason wearing different
-- clothes: two companies cannot both record the same supplier without one of
-- them getting a 409.
--
-- SAFE BY CONSTRUCTION. There is one tenant at migration time, so a composite
-- (tenantId, X) cannot collide anywhere the single column X did not. The new
-- constraint is strictly weaker than the one it replaces -- this migration can
-- only ever ACCEPT rows the old schema rejected.
--
-- NULLS. All but supplier_email are nullable, and Postgres treats NULLs as
-- distinct in a unique index, so unnumbered drafts stay unaffected exactly as
-- they were before.
--
-- INDEX NAMES MATTER HERE. lib/documentNumbering.ts's isNumberFieldConflict
-- inspects P2002.meta.target by substring, so the new target
-- ["tenantId","invoiceNumber"] must still contain the field name -- it does,
-- and lib/documentNumbering.spec.ts asserts it.
--
-- No IF EXISTS on the DROPs: if one of these names were wrong the old
-- install-wide unique would silently survive and defeat the entire point of
-- the migration. Fail loudly instead.

DROP INDEX "Invoice_invoiceNumber_key";
DROP INDEX "Quotation_quotationId_key";
DROP INDEX "CreditNote_creditNoteNumber_key";
DROP INDEX "DebitNote_debitNoteId_key";
DROP INDEX "DeliveryChallan_challanNumber_key";
DROP INDEX "Purchase_purchaseId_key";
DROP INDEX "PurchaseOrder_purchaseOrderId_key";
DROP INDEX "Expense_expenseId_key";
DROP INDEX "SupplierPayment_paymentId_key";
DROP INDEX "Supplier_supplier_email_key";
DROP INDEX "AIChatSession_sessionId_key";
DROP INDEX "AIPromptLog_promptId_key";

CREATE UNIQUE INDEX "Invoice_tenantId_invoiceNumber_key" ON "Invoice"("tenantId", "invoiceNumber");
CREATE UNIQUE INDEX "Quotation_tenantId_quotationId_key" ON "Quotation"("tenantId", "quotationId");
CREATE UNIQUE INDEX "CreditNote_tenantId_creditNoteNumber_key" ON "CreditNote"("tenantId", "creditNoteNumber");
CREATE UNIQUE INDEX "DebitNote_tenantId_debitNoteId_key" ON "DebitNote"("tenantId", "debitNoteId");
CREATE UNIQUE INDEX "DeliveryChallan_tenantId_challanNumber_key" ON "DeliveryChallan"("tenantId", "challanNumber");
CREATE UNIQUE INDEX "Purchase_tenantId_purchaseId_key" ON "Purchase"("tenantId", "purchaseId");
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_purchaseOrderId_key" ON "PurchaseOrder"("tenantId", "purchaseOrderId");
CREATE UNIQUE INDEX "Expense_tenantId_expenseId_key" ON "Expense"("tenantId", "expenseId");
CREATE UNIQUE INDEX "SupplierPayment_tenantId_paymentId_key" ON "SupplierPayment"("tenantId", "paymentId");
CREATE UNIQUE INDEX "Supplier_tenantId_supplier_email_key" ON "Supplier"("tenantId", "supplier_email");
CREATE UNIQUE INDEX "AIChatSession_tenantId_sessionId_key" ON "AIChatSession"("tenantId", "sessionId");
CREATE UNIQUE INDEX "AIPromptLog_tenantId_promptId_key" ON "AIPromptLog"("tenantId", "promptId");
