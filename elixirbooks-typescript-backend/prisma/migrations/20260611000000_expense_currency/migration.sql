-- per-expense currency: add currencyCode + exchangeRate to Expense
-- null currencyCode = company base currency (preserves existing behaviour)
-- null exchangeRate = 1 (no conversion)
ALTER TABLE "Expense" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "Expense" ADD COLUMN "exchangeRate" DECIMAL(18,8);
