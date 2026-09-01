-- FixedAsset disposal fields (disposal date, proceeds, link to the disposal journal entry).
ALTER TABLE "FixedAsset" ADD COLUMN "disposalDate" TIMESTAMP(3);
ALTER TABLE "FixedAsset" ADD COLUMN "disposalProceeds" DECIMAL(18,4);
ALTER TABLE "FixedAsset" ADD COLUMN "disposalJournalEntryId" TEXT;
