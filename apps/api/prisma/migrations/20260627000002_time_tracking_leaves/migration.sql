-- Time Tracking — Phase C (Leaves + Holidays)
-- Additive/non-breaking: 2 new enums + 5 new tables. No existing tables altered.

-- Enums
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "LeavePortion" AS ENUM ('FULL', 'AM', 'PM');

-- Holiday
CREATE TABLE "Holiday" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "recurringYearly" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Holiday_userId_date_key" ON "Holiday"("userId", "date");
CREATE INDEX "Holiday_userId_idx" ON "Holiday"("userId");

-- LeaveType
CREATE TABLE "LeaveType" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "paid" BOOLEAN NOT NULL DEFAULT true,
  "defaultAllocationDays" DECIMAL(5,1),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveType_userId_name_key" ON "LeaveType"("userId", "name");

-- LeaveAllocation
CREATE TABLE "LeaveAllocation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeUserId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "allocatedDays" DECIMAL(5,1) NOT NULL,
  "carriedOverDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveAllocation_employeeUserId_leaveTypeId_year_key" ON "LeaveAllocation"("employeeUserId", "leaveTypeId", "year");
CREATE INDEX "LeaveAllocation_userId_idx" ON "LeaveAllocation"("userId");
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_employeeUserId_fkey"
  FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_leaveTypeId_fkey"
  FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LeaveRequest
CREATE TABLE "LeaveRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeUserId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "totalDays" DECIMAL(5,1) NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeaveRequest_userId_idx" ON "LeaveRequest"("userId");
CREATE INDEX "LeaveRequest_employeeUserId_idx" ON "LeaveRequest"("employeeUserId");
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeUserId_fkey"
  FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey"
  FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LeaveRequestDay
CREATE TABLE "LeaveRequestDay" (
  "id" TEXT NOT NULL,
  "leaveRequestId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "portion" "LeavePortion" NOT NULL DEFAULT 'FULL',
  "portionDays" DECIMAL(2,1) NOT NULL,
  CONSTRAINT "LeaveRequestDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveRequestDay_leaveRequestId_date_key" ON "LeaveRequestDay"("leaveRequestId", "date");
CREATE INDEX "LeaveRequestDay_date_idx" ON "LeaveRequestDay"("date");
ALTER TABLE "LeaveRequestDay" ADD CONSTRAINT "LeaveRequestDay_leaveRequestId_fkey"
  FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
