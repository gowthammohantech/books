-- Migration: PC.1 — add currencyCode to Product
ALTER TABLE "Product" ADD COLUMN "currencyCode" TEXT;
