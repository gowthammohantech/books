-- Money In/Out layer categorizes via TransactionCategory (stored on the bank txn),
-- not the legacy ExpenseCategory. Make Expense.expenseCategoryId nullable so the
-- generic_category behaviour can create an Expense without a legacy category FK.
ALTER TABLE "Expense" ALTER COLUMN "expenseCategoryId" DROP NOT NULL;
