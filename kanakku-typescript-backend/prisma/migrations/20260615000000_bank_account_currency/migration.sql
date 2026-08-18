-- BC.1: add currencyCode to BankDetail (bank account) master
ALTER TABLE "BankDetail" ADD COLUMN "currencyCode" TEXT;
