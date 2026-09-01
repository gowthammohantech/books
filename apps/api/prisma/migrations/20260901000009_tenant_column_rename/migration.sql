-- P3 / M10: rename the tenant column userId -> tenantId across 60 tables and
-- repoint it from User to Tenant.
--
-- WHY THIS IS PURE DDL WITH NO DATA MOVEMENT: tenant #1 was created in
-- 20260901000000_tenant_core with `id` = the primary owner's User.id, and every
-- one of these columns already held `ownerId ?? id`. So every existing value is
-- ALREADY a valid Tenant.id. There is not a single UPDATE on a business table
-- below -- only DROP CONSTRAINT / RENAME COLUMN / ADD CONSTRAINT.
--
-- WHY RENAME AT ALL, rather than keep the name and repoint the FK: the column
-- meant "the owner user" and now means "the workspace". Keeping `userId` would
-- give a tiny diff and zero compiler help, on a codebase where exactly this
-- ambiguity is the live bug class -- lib/tenantScope.ts already documents that
-- `requireUserId` returns a tenant id, and reminderController is what that debt
-- bought (it compared the tenant id against `createdBy` and hid staff-created
-- reminders from the whole company). After the rename, `tsc` names every site
-- that confused the two.
--
-- NOT RENAMED -- these userId columns name a PERSON, not a workspace:
--   LoginActivity.userId    (who signed in)
--   AuditLog.userId         (who made the change)
--   TenantMembership.userId (who the member is)
-- ...along with every createdBy / billFrom / billTo / approvedBy / salesPerson /
-- received_by / voidedBy / reconciledBy / employeeUserId / paidByUserId column.

-- Guard: a pre-20260612000000_user_owner install could have business rows
-- stamped with a STAFF user id rather than the owner id, because the
-- `ownerId ?? id` rule did not exist yet. Those values are not Tenant ids and
-- would fail the foreign keys below. Coerce them to the install's tenant first,
-- matching what backfill (4) of 20260702000001_pettycash_tenant_scope does and
-- what the P2 child-table migrations already did.

UPDATE "AIChatSession" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AIConfiguration" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AIPromptLog" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AIPromptTemplate" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Account" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AccountCreditEntry" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AccountingIntegration" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AccountingPeriod" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AiChatSession" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AiConfig" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AiExtractionJob" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "AiUsageLog" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "BankDetail" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Budget" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "CompanySettings" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Contact" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Conversation" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "CostCenter" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "CreditNote" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Customer" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "DebitNote" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "DeliveryChallan" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "EInvoiceRecord" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "EmailSettings" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "ExchangeRate" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Expense" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "ExplanationHint" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "FixedAsset" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "GatewayConfig" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Holiday" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Inventory" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "InventoryCostLayer" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Invoice" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "InvoiceTemplate" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "JournalEntry" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "LeaveAllocation" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "LeaveRequest" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "LeaveType" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "LedgerAccountMapping" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Localization" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "MessagingConfig" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "MtdConfig" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "PayRun" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "PaymentLinkMethod" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "PaymentTransaction" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "PayrollProfile" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "PettyCash" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Project" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "ProjectMember" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Purchase" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "PurchaseOrder" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Quotation" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "RecurringInvoiceSchedule" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Refund" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Signature" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Supplier" SET "user_id" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "user_id" IS NOT NULL AND "user_id" NOT IN (SELECT id FROM "Tenant");
UPDATE "TaxRate" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Timesheet" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "TransactionCategory" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");
UPDATE "Vehicle" SET "userId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "Tenant");

-- The rename itself.

-- AIChatSession
ALTER TABLE "AIChatSession" DROP CONSTRAINT IF EXISTS "AIChatSession_userId_fkey";
ALTER TABLE "AIChatSession" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AIChatSession" ADD CONSTRAINT "AIChatSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AIConfiguration
ALTER TABLE "AIConfiguration" DROP CONSTRAINT IF EXISTS "AIConfiguration_userId_fkey";
ALTER TABLE "AIConfiguration" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AIConfiguration" ADD CONSTRAINT "AIConfiguration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AIPromptLog
ALTER TABLE "AIPromptLog" DROP CONSTRAINT IF EXISTS "AIPromptLog_userId_fkey";
ALTER TABLE "AIPromptLog" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AIPromptLog" ADD CONSTRAINT "AIPromptLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AIPromptTemplate
ALTER TABLE "AIPromptTemplate" DROP CONSTRAINT IF EXISTS "AIPromptTemplate_userId_fkey";
ALTER TABLE "AIPromptTemplate" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AIPromptTemplate" ADD CONSTRAINT "AIPromptTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Account
ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_userId_fkey";
ALTER TABLE "Account" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Account" ADD CONSTRAINT "Account_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AccountCreditEntry
ALTER TABLE "AccountCreditEntry" DROP CONSTRAINT IF EXISTS "AccountCreditEntry_userId_fkey";
ALTER TABLE "AccountCreditEntry" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AccountCreditEntry" ADD CONSTRAINT "AccountCreditEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AccountingIntegration
ALTER TABLE "AccountingIntegration" DROP CONSTRAINT IF EXISTS "AccountingIntegration_userId_fkey";
ALTER TABLE "AccountingIntegration" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AccountingIntegration" ADD CONSTRAINT "AccountingIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AccountingPeriod
ALTER TABLE "AccountingPeriod" DROP CONSTRAINT IF EXISTS "AccountingPeriod_userId_fkey";
ALTER TABLE "AccountingPeriod" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AiChatSession
ALTER TABLE "AiChatSession" DROP CONSTRAINT IF EXISTS "AiChatSession_userId_fkey";
ALTER TABLE "AiChatSession" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AiChatSession" ADD CONSTRAINT "AiChatSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AiConfig
ALTER TABLE "AiConfig" DROP CONSTRAINT IF EXISTS "AiConfig_userId_fkey";
ALTER TABLE "AiConfig" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AiConfig" ADD CONSTRAINT "AiConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AiExtractionJob
ALTER TABLE "AiExtractionJob" DROP CONSTRAINT IF EXISTS "AiExtractionJob_userId_fkey";
ALTER TABLE "AiExtractionJob" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AiExtractionJob" ADD CONSTRAINT "AiExtractionJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AiUsageLog
ALTER TABLE "AiUsageLog" DROP CONSTRAINT IF EXISTS "AiUsageLog_userId_fkey";
ALTER TABLE "AiUsageLog" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BankDetail
ALTER TABLE "BankDetail" DROP CONSTRAINT IF EXISTS "BankDetail_userId_fkey";
ALTER TABLE "BankDetail" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "BankDetail" ADD CONSTRAINT "BankDetail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Budget
ALTER TABLE "Budget" DROP CONSTRAINT IF EXISTS "Budget_userId_fkey";
ALTER TABLE "Budget" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CompanySettings
ALTER TABLE "CompanySettings" DROP CONSTRAINT IF EXISTS "CompanySettings_userId_fkey";
ALTER TABLE "CompanySettings" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contact
ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_userId_fkey";
ALTER TABLE "Contact" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Conversation
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userId_fkey";
ALTER TABLE "Conversation" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CostCenter
ALTER TABLE "CostCenter" DROP CONSTRAINT IF EXISTS "CostCenter_userId_fkey";
ALTER TABLE "CostCenter" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreditNote
ALTER TABLE "CreditNote" DROP CONSTRAINT IF EXISTS "CreditNote_userId_fkey";
ALTER TABLE "CreditNote" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Customer
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_userId_fkey";
ALTER TABLE "Customer" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DebitNote
ALTER TABLE "DebitNote" DROP CONSTRAINT IF EXISTS "DebitNote_userId_fkey";
ALTER TABLE "DebitNote" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DeliveryChallan
ALTER TABLE "DeliveryChallan" DROP CONSTRAINT IF EXISTS "DeliveryChallan_userId_fkey";
ALTER TABLE "DeliveryChallan" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EInvoiceRecord
ALTER TABLE "EInvoiceRecord" DROP CONSTRAINT IF EXISTS "EInvoiceRecord_userId_fkey";
ALTER TABLE "EInvoiceRecord" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "EInvoiceRecord" ADD CONSTRAINT "EInvoiceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EmailSettings
ALTER TABLE "EmailSettings" DROP CONSTRAINT IF EXISTS "EmailSettings_userId_fkey";
ALTER TABLE "EmailSettings" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "EmailSettings" ADD CONSTRAINT "EmailSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ExchangeRate
ALTER TABLE "ExchangeRate" DROP CONSTRAINT IF EXISTS "ExchangeRate_userId_fkey";
ALTER TABLE "ExchangeRate" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Expense
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_userId_fkey";
ALTER TABLE "Expense" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ExplanationHint
ALTER TABLE "ExplanationHint" DROP CONSTRAINT IF EXISTS "ExplanationHint_userId_fkey";
ALTER TABLE "ExplanationHint" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "ExplanationHint" ADD CONSTRAINT "ExplanationHint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FixedAsset
ALTER TABLE "FixedAsset" DROP CONSTRAINT IF EXISTS "FixedAsset_userId_fkey";
ALTER TABLE "FixedAsset" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- GatewayConfig
ALTER TABLE "GatewayConfig" DROP CONSTRAINT IF EXISTS "GatewayConfig_userId_fkey";
ALTER TABLE "GatewayConfig" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "GatewayConfig" ADD CONSTRAINT "GatewayConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Holiday
ALTER TABLE "Holiday" DROP CONSTRAINT IF EXISTS "Holiday_userId_fkey";
ALTER TABLE "Holiday" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Inventory
ALTER TABLE "Inventory" DROP CONSTRAINT IF EXISTS "Inventory_userId_fkey";
ALTER TABLE "Inventory" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventoryCostLayer
ALTER TABLE "InventoryCostLayer" DROP CONSTRAINT IF EXISTS "InventoryCostLayer_userId_fkey";
ALTER TABLE "InventoryCostLayer" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "InventoryCostLayer" ADD CONSTRAINT "InventoryCostLayer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invoice
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_userId_fkey";
ALTER TABLE "Invoice" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InvoiceTemplate
ALTER TABLE "InvoiceTemplate" DROP CONSTRAINT IF EXISTS "InvoiceTemplate_userId_fkey";
ALTER TABLE "InvoiceTemplate" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- JournalEntry
ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_userId_fkey";
ALTER TABLE "JournalEntry" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LeaveAllocation
ALTER TABLE "LeaveAllocation" DROP CONSTRAINT IF EXISTS "LeaveAllocation_userId_fkey";
ALTER TABLE "LeaveAllocation" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LeaveRequest
ALTER TABLE "LeaveRequest" DROP CONSTRAINT IF EXISTS "LeaveRequest_userId_fkey";
ALTER TABLE "LeaveRequest" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LeaveType
ALTER TABLE "LeaveType" DROP CONSTRAINT IF EXISTS "LeaveType_userId_fkey";
ALTER TABLE "LeaveType" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LedgerAccountMapping
ALTER TABLE "LedgerAccountMapping" DROP CONSTRAINT IF EXISTS "LedgerAccountMapping_userId_fkey";
ALTER TABLE "LedgerAccountMapping" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "LedgerAccountMapping" ADD CONSTRAINT "LedgerAccountMapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Localization
ALTER TABLE "Localization" DROP CONSTRAINT IF EXISTS "Localization_userId_fkey";
ALTER TABLE "Localization" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Localization" ADD CONSTRAINT "Localization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MessagingConfig
ALTER TABLE "MessagingConfig" DROP CONSTRAINT IF EXISTS "MessagingConfig_userId_fkey";
ALTER TABLE "MessagingConfig" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "MessagingConfig" ADD CONSTRAINT "MessagingConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MtdConfig
ALTER TABLE "MtdConfig" DROP CONSTRAINT IF EXISTS "MtdConfig_userId_fkey";
ALTER TABLE "MtdConfig" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "MtdConfig" ADD CONSTRAINT "MtdConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayRun
ALTER TABLE "PayRun" DROP CONSTRAINT IF EXISTS "PayRun_userId_fkey";
ALTER TABLE "PayRun" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PaymentLinkMethod
ALTER TABLE "PaymentLinkMethod" DROP CONSTRAINT IF EXISTS "PaymentLinkMethod_userId_fkey";
ALTER TABLE "PaymentLinkMethod" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "PaymentLinkMethod" ADD CONSTRAINT "PaymentLinkMethod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PaymentTransaction
ALTER TABLE "PaymentTransaction" DROP CONSTRAINT IF EXISTS "PaymentTransaction_userId_fkey";
ALTER TABLE "PaymentTransaction" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayrollProfile
ALTER TABLE "PayrollProfile" DROP CONSTRAINT IF EXISTS "PayrollProfile_userId_fkey";
ALTER TABLE "PayrollProfile" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "PayrollProfile" ADD CONSTRAINT "PayrollProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PettyCash
ALTER TABLE "PettyCash" DROP CONSTRAINT IF EXISTS "PettyCash_userId_fkey";
ALTER TABLE "PettyCash" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "PettyCash" ADD CONSTRAINT "PettyCash_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Project
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_userId_fkey";
ALTER TABLE "Project" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ProjectMember
ALTER TABLE "ProjectMember" DROP CONSTRAINT IF EXISTS "ProjectMember_userId_fkey";
ALTER TABLE "ProjectMember" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Purchase
ALTER TABLE "Purchase" DROP CONSTRAINT IF EXISTS "Purchase_userId_fkey";
ALTER TABLE "Purchase" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PurchaseOrder
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_userId_fkey";
ALTER TABLE "PurchaseOrder" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quotation
ALTER TABLE "Quotation" DROP CONSTRAINT IF EXISTS "Quotation_userId_fkey";
ALTER TABLE "Quotation" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RecurringInvoiceSchedule
ALTER TABLE "RecurringInvoiceSchedule" DROP CONSTRAINT IF EXISTS "RecurringInvoiceSchedule_userId_fkey";
ALTER TABLE "RecurringInvoiceSchedule" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "RecurringInvoiceSchedule" ADD CONSTRAINT "RecurringInvoiceSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Refund
ALTER TABLE "Refund" DROP CONSTRAINT IF EXISTS "Refund_userId_fkey";
ALTER TABLE "Refund" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Signature
ALTER TABLE "Signature" DROP CONSTRAINT IF EXISTS "Signature_userId_fkey";
ALTER TABLE "Signature" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supplier
ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "Supplier_user_id_fkey";
ALTER TABLE "Supplier" RENAME COLUMN "user_id" TO "tenantId";
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TaxRate
ALTER TABLE "TaxRate" DROP CONSTRAINT IF EXISTS "TaxRate_userId_fkey";
ALTER TABLE "TaxRate" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Timesheet
ALTER TABLE "Timesheet" DROP CONSTRAINT IF EXISTS "Timesheet_userId_fkey";
ALTER TABLE "Timesheet" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TransactionCategory
ALTER TABLE "TransactionCategory" DROP CONSTRAINT IF EXISTS "TransactionCategory_userId_fkey";
ALTER TABLE "TransactionCategory" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Vehicle
ALTER TABLE "Vehicle" DROP CONSTRAINT IF EXISTS "Vehicle_userId_fkey";
ALTER TABLE "Vehicle" RENAME COLUMN "userId" TO "tenantId";
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rename every index and unique constraint that carries the old column name.
--
-- Driven off the catalog rather than a hand-written list: Prisma derives the
-- expected name from the column names ("Account_userId_code_key" ->
-- "Account_tenantId_code_key"), so ANY missed index shows up forever as schema
-- drift on the next `prisma migrate dev`. Enumerating by hand across 60 tables
-- is exactly the kind of list that goes stale. Indexes with an explicit map()
-- name (e.g. customer_email_per_user_idx) contain no "userId" token and are
-- deliberately left alone -- their DB name does not depend on the column.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS idxname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND n.nspname = current_schema()
      AND (c.relname LIKE '%\_userId\_%' OR c.relname LIKE '%\_user\_id\_%')
      -- ...but NOT on the three tables whose userId names a PERSON. Their
      -- indexes are about the actor and keep their names; renaming
      -- TenantMembership_userId_status_idx would also collide head-on with the
      -- real TenantMembership_tenantId_status_idx created in tenant_core.
      AND c.relname NOT LIKE 'TenantMembership\_%'
      AND c.relname NOT LIKE 'LoginActivity\_%'
      AND c.relname NOT LIKE 'AuditLog\_%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.idxname,
                   replace(replace(r.idxname, '_user_id_', '_tenantId_'), '_userId_', '_tenantId_'));
  END LOOP;
END $$;

-- AuditLog gains a tenant of its own. It stays NULLABLE: system work (seeds,
-- boot backfills, anything under runAsSystem) legitimately has no tenant, and
-- the audit row is still worth keeping. AuditLog.userId is untouched -- it is
-- the actor.
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" TEXT;

UPDATE "AuditLog"
SET "tenantId" = (SELECT t.id FROM "Tenant" t ORDER BY t."createdAt" ASC, t.id ASC LIMIT 1)
WHERE "tenantId" IS NULL;

CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
