-- Add EMPLOYEE_PAID to the ExpenseSourceType enum (Postgres requires ALTER TYPE).
ALTER TYPE "ExpenseSourceType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_PAID';

-- Per-user "paid by" marker for reimbursable expenses (out-of-pocket, owed back).
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "paidByUserId" TEXT;

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_paidByUserId_fkey"
  FOREIGN KEY ("paidByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
