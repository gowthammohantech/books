/**
 * Backfill ledger initialization for existing company owners.
 *
 * For every owner (User with ownerId = null) that does NOT yet have any
 * LedgerAccountMapping rows, this script:
 *   1. Resolves the pack code: prefers CompanySettings.countryCode if it is a
 *      valid pack code (IN|GB|EU|US|AU|NZ); else falls back to the ISO-2 from
 *      the countryRef relation; else defaults to 'GB'.
 *   2. Handles partial init: if CompanySettings.ledgerInitialized is already
 *      true but there are zero mappings (stuck/broken state), the flag is
 *      temporarily cleared inside the same transaction so applyPack's guard
 *      does not throw, then restored to true after applyPack succeeds.
 *   3. Calls applyPack() inside a Prisma interactive transaction.
 *
 * Idempotent: determined by mapping count only — owners with >0 mappings are
 * skipped regardless of the ledgerInitialized flag.
 *
 * Run:  npx ts-node prisma/backfillLedgerInit.ts
 */

import { PrismaClient } from '@prisma/client';
import { applyPack, type ApplyPackTx } from '../lib/ledger/applyPack';
import { resolvePackCode } from '../lib/ledger/resolvePackCode';

const prisma = new PrismaClient();

async function backfillLedgerInit(): Promise<void> {
  // All owners: users whose ownerId is null (i.e. they ARE the owner row).
  const owners = await prisma.user.findMany({
    where: { ownerId: null },
    select: {
      id: true,
      firstName: true,
      email: true,
      companySettings: {
        select: {
          countryCode: true,
          ledgerInitialized: true,
          countryRef: {
            select: { iso2: true },
          },
        },
      },
    },
  });

  let initialized = 0;
  let skipped = 0;

  for (const owner of owners) {
    // Idempotency check: skip if mappings already exist (mapping count only —
    // do NOT use the ledgerInitialized flag for this decision).
    const existingCount = await prisma.ledgerAccountMapping.count({
      where: { userId: owner.id },
    });
    if (existingCount > 0) {
      console.log(`[SKIP] ${owner.email} (${owner.id}) — already has ${existingCount} ledger mapping(s)`);
      skipped += 1;
      continue;
    }

    // Resolve the tenant's REAL country ISO-2 (prefer saved 2-letter countryCode,
    // else the countryRef ISO-2), then derive the pack code. EU members route to
    // the generic 'EU' pack while the member ISO-2 is persisted + drives the rate.
    const settingsCountryCode = owner.companySettings?.countryCode ?? null;
    const memberIso2 =
      settingsCountryCode && /^[A-Z]{2}$/i.test(settingsCountryCode) && settingsCountryCode.toUpperCase() !== 'EU'
        ? settingsCountryCode.toUpperCase()
        : owner.companySettings?.countryRef?.iso2?.toUpperCase() ?? null;
    const packCode = resolvePackCode(memberIso2);

    // Detect partial init: ledgerInitialized=true yet zero mappings (broken state).
    const isPartialInit = owner.companySettings?.ledgerInitialized === true;

    try {
      await prisma.$transaction(async (tx) => {
        if (isPartialInit) {
          // Temporarily clear the flag so applyPack's guard does not throw.
          await tx.companySettings.update({
            where: { userId: owner.id },
            data: { ledgerInitialized: false },
          });
        }

        await applyPack(tx as unknown as ApplyPackTx, {
          userId: owner.id,
          countryCode: packCode,
          memberCountryCode: memberIso2,
          goLiveDate: new Date(),
        });

        if (isPartialInit) {
          // Restore the flag now that applyPack has succeeded.
          await tx.companySettings.update({
            where: { userId: owner.id },
            data: { ledgerInitialized: true },
          });
        }
      });
      const partialNote = isPartialInit ? ' (repaired partial init)' : '';
      console.log(`[OK]   ledger initialized for ${owner.email} (${packCode})${partialNote}`);
      initialized += 1;
    } catch (err) {
      console.error(`[ERR]  ${owner.email} (${owner.id}): ${(err as Error).message}`);
    }
  }

  console.log(`\nBackfill complete: ${initialized} initialized, ${skipped} already done (of ${owners.length} owners).`);
}

backfillLedgerInit()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Fatal error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
