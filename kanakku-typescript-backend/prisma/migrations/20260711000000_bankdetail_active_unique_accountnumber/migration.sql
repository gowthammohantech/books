-- Bank accounts are soft-deleted (isDeleted = true), but the old unique index on
-- accountNumber spanned deleted rows too. That reserved a deleted account's number
-- forever: recreating it hit a unique violation and 500'd. The app already intends
-- uniqueness among *active* accounts only (createBankDetailValidator checks
-- `{ accountNumber, isDeleted: false }`), so align the DB with that intent by making
-- the unique index partial over non-deleted rows.
DROP INDEX IF EXISTS "BankDetail_accountNumber_key";

CREATE UNIQUE INDEX "BankDetail_accountNumber_active_key"
  ON "BankDetail" ("accountNumber")
  WHERE "isDeleted" = false;
