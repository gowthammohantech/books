-- Time Tracking — Phase 1
-- Additive/non-breaking: new nullable Project columns + 3 new tables + 2 enums.
-- Existing Project rows and GL-dimension references are unaffected.

-- Enums
CREATE TYPE "ProjectMemberRole" AS ENUM ('MEMBER', 'MANAGER');
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- Project: additive billing/date/customer columns (all nullable)
ALTER TABLE "Project" ADD COLUMN "billingRate" DECIMAL(12,2);
ALTER TABLE "Project" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "contactId" TEXT;

-- ProjectMember
CREATE TABLE "ProjectMember" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "employeeUserId" TEXT NOT NULL,
  "role" "ProjectMemberRole" NOT NULL DEFAULT 'MEMBER',
  "billingRate" DECIMAL(12,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectMember_projectId_employeeUserId_key" ON "ProjectMember"("projectId", "employeeUserId");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");
CREATE INDEX "ProjectMember_employeeUserId_idx" ON "ProjectMember"("employeeUserId");
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_employeeUserId_fkey"
  FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Timesheet
CREATE TABLE "Timesheet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeUserId" TEXT NOT NULL,
  "weekStartDate" TIMESTAMP(3) NOT NULL,
  "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Timesheet_employeeUserId_weekStartDate_key" ON "Timesheet"("employeeUserId", "weekStartDate");
CREATE INDEX "Timesheet_userId_idx" ON "Timesheet"("userId");
CREATE INDEX "Timesheet_status_idx" ON "Timesheet"("status");
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_employeeUserId_fkey"
  FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TimeEntry
CREATE TABLE "TimeEntry" (
  "id" TEXT NOT NULL,
  "timesheetId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "hours" DECIMAL(5,2) NOT NULL,
  "billable" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimeEntry_timesheetId_idx" ON "TimeEntry"("timesheetId");
CREATE INDEX "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");
CREATE INDEX "TimeEntry_date_idx" ON "TimeEntry"("date");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_timesheetId_fkey"
  FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT prevents deleting a Project that still has time entries (per spec).
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
