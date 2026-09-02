-- Setup wizard: record what kind of business a workspace is.
--
-- The post-signup screen became a four-step wizard, and its first question is
-- "what kind of business is this?" — manufacturing, trading/distribution, or
-- services. The answer seeds which modules the wizard pre-ticks on step 3.
--
-- erp-roadmap.md lists "target verticals" as the first of the open questions
-- that cannot be answered from the code. This column answers it per workspace,
-- which is the only place the answer is actually knowable.
--
-- NULLABLE, NO BACKFILL, NO DEFAULT. Every workspace that predates the wizard
-- was never asked, and null says exactly that — it is not the same as
-- "services" and must not be guessed. Nothing reads this column for access or
-- routing; it seeds a preset and labels the review step.
--
-- The module SELECTION that step 3 produces is deliberately NOT here. It is a
-- preference with a meaningful "never chosen" state, so it lives as a
-- GeneralSetting row (key 'enabledModules', groupSlug 'onboarding') where an
-- absent row says "no preference" honestly. A text[] column would default to
-- '{}' and make "unset" and "everything switched off" the same value.

CREATE TYPE "BusinessType" AS ENUM ('MANUFACTURING', 'TRADING', 'SERVICES');

ALTER TABLE "CompanySettings" ADD COLUMN "businessType" "BusinessType";
