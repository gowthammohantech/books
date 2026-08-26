/**
 * Backfill GAIN_ON_DISPOSAL and LOSS_ON_DISPOSAL ledger roles for existing tenants.
 *
 * For every owner that already has at least one LedgerAccountMapping row but is
 * MISSING either of the two new disposal role mappings, this script idempotently:
 *   1. Resolves their pack via CompanySettings.countryCode (fallback GB).
 *   2. Finds the pack account by role to get its code/name/type.
 *   3. Upserts the Account row.
 *   4. Upserts the LedgerAccountMapping row.
 *
 * Idempotent: re-running produces no-ops for already-complete owners.
 *
 * Run:  npx ts-node prisma/backfillDisposalAccounts.ts
 */

import { PrismaClient } from '@prisma/client';
import { getPack } from '../lib/ledger/packs';
import { resolvePackCode } from '../lib/ledger/resolvePackCode';
import { COUNTRY_CODES } from '../lib/ledger/packs/index';
import type { LedgerRole } from '../lib/ledger/roles';

const prisma = new PrismaClient();

const DISPOSAL_ROLES: LedgerRole[] = ['GAIN_ON_DISPOSAL', 'LOSS_ON_DISPOSAL'];

async function backfillDisposalAccounts(): Promise<void> {
  // All owners: users whose ownerId is null (i.e. they ARE the owner row).
  const owners = await prisma.user.findMany({
    where: { ownerId: null },
    select: {
      id: true,
      email: true,
      companySettings: {
        select: {
          countryCode: true,
          functionalCurrency: true,
          countryRef: {
            select: { iso2: true },
          },
        },
      },
    },
  });

  let backfilled = 0;
  let skipped = 0;
  let errors = 0;

  for (const owner of owners) {
    // Only process owners that have an initialized ledger (>0 mappings).
    const existingCount = await prisma.ledgerAccountMapping.count({
      where: { userId: owner.id },
    });
    if (existingCount === 0) {
      console.log(`[SKIP] ${owner.email} (${owner.id}) — no ledger mappings yet; run backfillLedgerInit first`);
      skipped += 1;
      continue;
    }

    // Resolve pack code from CompanySettings.countryCode first, then ISO-2 fallback.
    const settingsCountryCode = owner.companySettings?.countryCode ?? null;
    const packCode = settingsCountryCode && COUNTRY_CODES.includes(settingsCountryCode.toUpperCase())
      ? settingsCountryCode.toUpperCase()
      : resolvePackCode(owner.companySettings?.countryRef?.iso2 ?? null);

    const pack = getPack(packCode);
    if (!pack) {
      console.error(`[ERR]  ${owner.email} (${owner.id}) — could not resolve pack for code "${packCode}"`);
      errors += 1;
      continue;
    }

    const functionalCurrency = owner.companySettings?.functionalCurrency ?? pack.defaultFunctionalCurrency;
    let ownerBackfilled = false;

    try {
      for (const roleKey of DISPOSAL_ROLES) {
        // Check if this role mapping already exists.
        const existingMapping = await prisma.ledgerAccountMapping.findUnique({
          where: { userId_roleKey: { userId: owner.id, roleKey } },
        });
        if (existingMapping) {
          console.log(`[SKIP] ${owner.email} — role ${roleKey} already mapped`);
          continue;
        }

        // Find the pack account for this role.
        const packAccount = pack.accounts.find((a) => a.role === roleKey);
        if (!packAccount) {
          console.error(`[ERR]  ${owner.email} — pack ${packCode} has no account for role ${roleKey}`);
          errors += 1;
          continue;
        }

        // Upsert the Account row (create if missing; no-op on update).
        const account = await prisma.account.upsert({
          where: { userId_code: { userId: owner.id, code: packAccount.code } },
          create: {
            userId: owner.id,
            code: packAccount.code,
            name: packAccount.name,
            accountType: packAccount.accountType,
            currencyCode: functionalCurrency,
            roleProtected: true,
          },
          update: {},
        });

        // Upsert the LedgerAccountMapping row.
        await prisma.ledgerAccountMapping.upsert({
          where: { userId_roleKey: { userId: owner.id, roleKey } },
          create: { userId: owner.id, roleKey, accountId: account.id },
          update: { accountId: account.id },
        });

        console.log(`[OK]   ${owner.email} — added role ${roleKey} -> account ${packAccount.code} (${packAccount.name})`);
        ownerBackfilled = true;
      }

      if (ownerBackfilled) backfilled += 1;
      else skipped += 1;
    } catch (err) {
      console.error(`[ERR]  ${owner.email} (${owner.id}): ${(err as Error).message}`);
      errors += 1;
    }
  }

  console.log(
    `\nBackfill complete: ${backfilled} owner(s) updated, ${skipped} already done/skipped, ${errors} error(s) (of ${owners.length} owners total).`,
  );
  if (errors > 0) process.exitCode = 1;
}

backfillDisposalAccounts()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error('Fatal error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
