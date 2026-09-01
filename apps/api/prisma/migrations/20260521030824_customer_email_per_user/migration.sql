-- Drop the global email unique constraint
DROP INDEX IF EXISTS "Customer_email_key";

-- Add per-user email uniqueness
CREATE UNIQUE INDEX "customer_email_per_user_idx" ON "Customer"("userId", "email");
