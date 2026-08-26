-- BC.2: add bankCodeType to BankDetail to support regional bank-code formats
-- (IFSC, SORT_CODE, ROUTING, IBAN, SWIFT, BSB, OTHER). The code value itself
-- continues to live in the existing IFSCCode column.
ALTER TABLE "BankDetail" ADD COLUMN "bankCodeType" TEXT;
