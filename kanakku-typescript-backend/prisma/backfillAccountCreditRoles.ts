/**
 * Backfill ACCOUNT_CREDIT and CUSTOMER_CREDIT_EXPENSE ledger roles for tenants
 * that already went live (CompanySettings.ledgerInitialized = true) BEFORE
 * these two roles existed.
 *
 * applyPack() (lib/ledger/applyPack.ts) refuses to re-run once a tenant's
 * ledger is initialized, so a self-hosted upgrade needs a one-shot backfill
 * to add the missing role -> account mappings. Mirrors backfillDisposalAccounts.ts
 * exactly, but keys off CompanySettings.ledgerInitialized (per the task spec)
 * rather than "has any LedgerAccountMapping row".
 *
 * For every already-initialized tenant missing either role mapping, this:
 *   1. Resolves their pack via CompanySettings.countryCode (fallback via ISO-2 / GB).
 *   2. Finds the pack account for that role to get its code/name/type.
 *   3. Upserts the Account row (idempotent — matches existing code if present).
 *   4. Upserts the LedgerAccountMapping row.
 *
 * Idempotent: re-running is a cheap no-op (single count-style existence check
 * per role, per tenant) once every tenant is caught up — safe to run on every
 * boot (see server.js BACKFILL_ON_BOOT wiring).
 *
 * Run:  npx ts-node prisma/backfillAccountCreditRoles.ts
 */

import { PrismaClient } from '@prisma/client';
import { getPack } from '../lib/ledger/packs';
import { resolvePackCode } from '../lib/ledger/resolvePackCode';
import { COUNTRY_CODES } from '../lib/ledger/packs/index';
import type { LedgerRole } from '../lib/ledger/roles';

const prisma = new PrismaClient();

const NEW_ROLES: LedgerRole[] = ['ACCOUNT_CREDIT', 'CUSTOMER_CREDIT_EXPENSE'];

export async function backfillAccountCreditRoles(): Promise<void> {
  const tenants = await prisma.companySettings.findMany({
    where: { ledgerInitialized: true },
    select: {
      userId: true,
      countryCode: true,
      functionalCurrency: true,
      countryRef: { select: { iso2: true } },
      user: { select: { email: true } },
    },
  });

  let backfilled = 0;
  let skipped = 0;
  let errors = 0;

  for (const tenant of tenants) {
    const label = tenant.user?.email ?? tenant.userId;
    const packCode = tenant.countryCode && COUNTRY_CODES.includes(tenant.countryCode.toUpperCase())
      ? tenant.countryCode.toUpperCase()
      : resolvePackCode(tenant.countryRef?.iso2 ?? null);

    const pack = getPack(packCode);
    if (!pack) {
      console.error(`[ERR]  ${label} — could not resolve pack for code "${packCode}"`);
      errors += 1;
      continue;
    }

    const functionalCurrency = tenant.functionalCurrency ?? pack.defaultFunctionalCurrency;
    let tenantBackfilled = false;

    try {
      for (const roleKey of NEW_ROLES) {
        const existingMapping = await prisma.ledgerAccountMapping.findUnique({
          where: { userId_roleKey: { userId: tenant.userId, roleKey } },
        });
        if (existingMapping) {
          continue;
        }

        const packAccount = pack.accounts.find((a) => a.role === roleKey);
        if (!packAccount) {
          console.error(`[ERR]  ${label} — pack ${packCode} has no account for role ${roleKey}`);
          errors += 1;
          continue;
        }

        const account = await prisma.account.upsert({
          where: { userId_code: { userId: tenant.userId, code: packAccount.code } },
          create: {
            userId: tenant.userId,
            code: packAccount.code,
            name: packAccount.name,
            accountType: packAccount.accountType,
            currencyCode: functionalCurrency,
            roleProtected: true,
          },
          update: {},
        });

        await prisma.ledgerAccountMapping.upsert({
          where: { userId_roleKey: { userId: tenant.userId, roleKey } },
          create: { userId: tenant.userId, roleKey, accountId: account.id },
          update: { accountId: account.id },
        });

        console.log(`[OK]   ${label} — added role ${roleKey} -> account ${packAccount.code} (${packAccount.name})`);
        tenantBackfilled = true;
      }

      if (tenantBackfilled) backfilled += 1;
      else skipped += 1;
    } catch (err) {
      console.error(`[ERR]  ${label}: ${(err as Error).message}`);
      errors += 1;
    }
  }

  console.log(
    `Account-credit role backfill complete: ${backfilled} tenant(s) updated, ${skipped} already done/skipped, ${errors} error(s) (of ${tenants.length} ledger-initialized tenants).`,
  );
  if (errors > 0) process.exitCode = 1;
}

// Only run when invoked directly (e.g. `ts-node prisma/backfillAccountCreditRoles.ts`),
// not when imported by the boot bootstrap or a test spec.
if (require.main === module) {
  backfillAccountCreditRoles()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(process.exitCode ?? 0))
    .catch(async (err) => {
      console.error('Fatal error:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
