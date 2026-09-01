-- Recurring engine v2: non-posting RecurringInvoiceSchedule entity.
-- Additive/non-breaking: 1 new enum + 1 new table + 1 nullable FK column on Invoice.
-- A schedule NEVER posts to GL or touches inventory; only the generated child invoices
-- (linked via Invoice.recurringScheduleId) do. Existing Invoice recurring columns are untouched.

-- Enum
CREATE TYPE "RecurringScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'COMPLETED');

-- RecurringInvoiceSchedule
CREATE TABLE "RecurringInvoiceSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT,
  "contactId" TEXT,
  "currencyCode" TEXT,
  "taxTreatment" "TaxTreatment",
  "items" JSONB NOT NULL,
  "taxableAmount" DECIMAL(18,4) NOT NULL,
  "totalDiscount" DECIMAL(18,4),
  "totalTax" DECIMAL(18,4),
  "roundOff" DECIMAL(18,4),
  "TotalAmount" DECIMAL(18,4) NOT NULL,
  "notes" TEXT,
  "termsAndCondition" TEXT,
  "signatureId" TEXT,
  "billFrom" TEXT,
  "repeatEvery" "RecurrenceFrequency" NOT NULL DEFAULT 'month',
  "customIntervalNumber" INTEGER,
  "customIntervalType" "RecurrenceCustomIntervalType",
  "startOn" TIMESTAMP(3) NOT NULL,
  "endsOn" TIMESTAMP(3),
  "neverExpire" BOOLEAN NOT NULL DEFAULT false,
  "maxOccurrences" INTEGER,
  "status" "RecurringScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
  "nextRunDate" TIMESTAMP(3),
  "lastRunDate" TIMESTAMP(3),
  "occurrencesCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringInvoiceSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecurringInvoiceSchedule_userId_idx" ON "RecurringInvoiceSchedule"("userId");
CREATE INDEX "RecurringInvoiceSchedule_status_idx" ON "RecurringInvoiceSchedule"("status");
ALTER TABLE "RecurringInvoiceSchedule" ADD CONSTRAINT "RecurringInvoiceSchedule_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invoice: link generated occurrences to their schedule (nullable, additive)
ALTER TABLE "Invoice" ADD COLUMN "recurringScheduleId" TEXT;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringScheduleId_fkey"
  FOREIGN KEY ("recurringScheduleId") REFERENCES "RecurringInvoiceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
