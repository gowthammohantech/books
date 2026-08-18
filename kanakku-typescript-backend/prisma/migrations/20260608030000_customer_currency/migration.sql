-- Migration: CC.1 — add currencyCode to Customer
ALTER TABLE "Customer" ADD COLUMN "currencyCode" TEXT;
