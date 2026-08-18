CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "Invoice"  ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED', ADD COLUMN "approvedById" TEXT, ADD COLUMN "approvedAt" TIMESTAMP(3), ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Expense"  ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED', ADD COLUMN "approvedById" TEXT, ADD COLUMN "approvedAt" TIMESTAMP(3), ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED', ADD COLUMN "approvedById" TEXT, ADD COLUMN "approvedAt" TIMESTAMP(3), ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "approvalsEnabled" BOOLEAN NOT NULL DEFAULT false;
