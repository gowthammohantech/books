-- Phase B2: Learning store — ExplanationHint
-- Stores a normalised payee key → (transactionTypeKey, categoryId, payToUserId)
-- mapping so that repeating payees auto-fill the category/type on future
-- bank transactions. hitCount and lastUsedAt track recency/frequency so the
-- UI can surface the most-used hint when multiple candidates exist.

CREATE TABLE "ExplanationHint" (
  "id"                 TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "payeeKey"           TEXT NOT NULL,
  "transactionTypeKey" TEXT NOT NULL,
  "categoryId"         TEXT,
  "payToUserId"        TEXT,
  "hitCount"           INTEGER NOT NULL DEFAULT 1,
  "lastUsedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExplanationHint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExplanationHint_userId_payeeKey_key" ON "ExplanationHint"("userId", "payeeKey");
CREATE INDEX "ExplanationHint_userId_idx" ON "ExplanationHint"("userId");
