-- Bank AUTO-POST tier for bank-transaction auto-matching.
--
-- Two additive, default-off/false columns. Backward-compatible: existing tenants
-- keep the current queue-only behaviour (bankAutoPostEnabled defaults false), and
-- every existing bank row is (correctly) not auto-posted (autoPosted defaults false).

-- Per-tenant opt-in toggle. OFF by default preserves the current behaviour where
-- an AUTO match only fills the approval queue (FOR_APPROVAL) and never posts.
ALTER TABLE "CompanySettings" ADD COLUMN "bankAutoPostEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Marks a bank transaction that the auto-post tier posted to the GL directly
-- (skipping the approval queue). Used for the FE badge, undo, and audit. Cleared
-- back to false by unexplain.
ALTER TABLE "BankTransaction" ADD COLUMN "autoPosted" BOOLEAN NOT NULL DEFAULT false;
