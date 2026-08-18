-- Enums
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOID');
CREATE TYPE "PayFrequency" AS ENUM ('MONTHLY');

-- PayrollProfile
CREATE TABLE "PayrollProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeUserId" TEXT NOT NULL,
  "defaultGross" DECIMAL(18,4),
  "payFrequency" "PayFrequency" NOT NULL DEFAULT 'MONTHLY',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollProfile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayrollProfile_userId_idx" ON "PayrollProfile"("userId");
CREATE INDEX "PayrollProfile_employeeUserId_idx" ON "PayrollProfile"("employeeUserId");
ALTER TABLE "PayrollProfile" ADD CONSTRAINT "PayrollProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollProfile" ADD CONSTRAINT "PayrollProfile_employeeUserId_fkey"
  FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayRun
CREATE TABLE "PayRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taxYearLabel" TEXT NOT NULL,
  "taxMonth" INTEGER NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
  "finalizedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayRun_userId_idx" ON "PayRun"("userId");
CREATE INDEX "PayRun_userId_taxYearLabel_taxMonth_idx" ON "PayRun"("userId", "taxYearLabel", "taxMonth");
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayRunLine
CREATE TABLE "PayRunLine" (
  "id" TEXT NOT NULL,
  "payRunId" TEXT NOT NULL,
  "employeeUserId" TEXT NOT NULL,
  "gross" DECIMAL(18,4) NOT NULL,
  "deductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "net" DECIMAL(18,4) NOT NULL,
  "deductionLines" JSONB,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayRunLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayRunLine_payRunId_idx" ON "PayRunLine"("payRunId");
CREATE INDEX "PayRunLine_employeeUserId_idx" ON "PayRunLine"("employeeUserId");
ALTER TABLE "PayRunLine" ADD CONSTRAINT "PayRunLine_payRunId_fkey"
  FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayRunLine" ADD CONSTRAINT "PayRunLine_employeeUserId_fkey"
  FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
