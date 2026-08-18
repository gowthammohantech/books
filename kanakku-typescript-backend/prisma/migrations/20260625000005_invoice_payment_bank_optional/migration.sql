-- QA #9/#30: a CASH invoice receipt must not require a bank account.
-- Make InvoicePayment.bankId nullable so cash payments can persist bankId = NULL.
-- Re-runnable: DROP NOT NULL is a no-op once the column is already nullable.

ALTER TABLE "InvoicePayment" ALTER COLUMN "bankId" DROP NOT NULL;
