-- Migration: add currencyCode to PurchaseOrder (C.1 follow-up)
ALTER TABLE "PurchaseOrder" ADD COLUMN "currencyCode" TEXT;
