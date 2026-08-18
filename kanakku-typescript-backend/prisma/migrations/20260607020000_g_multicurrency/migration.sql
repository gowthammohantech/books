-- Spec G — Multi-Currency: add currencyCode + exchangeRate to documents and payments

-- Invoice
ALTER TABLE "Invoice" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "exchangeRate" DECIMAL(18,8);

-- InvoicePayment
ALTER TABLE "InvoicePayment" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN "exchangeRate" DECIMAL(18,8);

-- Purchase
ALTER TABLE "Purchase" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "exchangeRate" DECIMAL(18,8);

-- SupplierPayment
ALTER TABLE "SupplierPayment" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN "exchangeRate" DECIMAL(18,8);

-- ExchangeRate table
CREATE TABLE "ExchangeRate" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency"   TEXT NOT NULL,
    "rate"         DECIMAL(18,8) NOT NULL,
    "asOfDate"     TIMESTAMP(3) NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExchangeRate_userId_fromCurrency_toCurrency_asOfDate_idx"
    ON "ExchangeRate"("userId", "fromCurrency", "toCurrency", "asOfDate");

ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
