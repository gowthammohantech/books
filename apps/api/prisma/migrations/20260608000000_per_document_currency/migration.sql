-- C.1: per-document currency (no FX conversion)
-- Add currencyCode to the four document types that didn't have it yet.
-- Invoice and Purchase already carry currencyCode from Spec G (migration 20260607020000_g_multicurrency).

ALTER TABLE "Quotation" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "DebitNote" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "currencyCode" TEXT;
