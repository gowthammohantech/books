-- P3.2 — Budgeting: per-account budget entries per period

CREATE TABLE "Budget" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "accountId"   TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd"   TIMESTAMP(3) NOT NULL,
    "amount"      DECIMAL(18,4) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Budget_userId_accountId_periodStart_idx"
    ON "Budget"("userId", "accountId", "periodStart");

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
