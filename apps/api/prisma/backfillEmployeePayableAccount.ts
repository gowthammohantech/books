/**
 * Backfill the 9250 "Amounts Owed to Employees" (LIABILITY) account for every
 * existing owner that has an initialized ledger (>=1 LedgerAccountMapping).
 *
 * 9250 is a code-based EXTRA_ACCOUNT (the 9200-family), NOT a LedgerRole, so
 * there is NO LedgerAccountMapping row — only an Account row resolved by code
 * at posting time (resolveAccountByCode / postExpenseLedger). This mirrors how
 * 9200-9240 are created, and parallels backfillDisposalAccounts.ts for the
 * role-based disposal accounts.
 *
 * Idempotent: account.upsert on (tenantId, code) is a no-op for owners that
 * already have 9250.
 *
 * Run:  npx ts-node prisma/backfillEmployeePayableAccount.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CODE = '9250';
const NAME = 'Amounts Owed to Employees';

async function backfillEmployeePayableAccount(): Promise<void> {
  const owners = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, companySettings: { select: { functionalCurrency: true } } },
  });

  let backfilled = 0;
  let skipped = 0;
  let errors = 0;

  for (const owner of owners) {
    const existingCount = await prisma.ledgerAccountMapping.count({ where: { tenantId: owner.id } });
    if (existingCount === 0) {
      console.log(`[SKIP] ${owner.name} (${owner.id}) — no ledger mappings yet`);
      skipped += 1;
      continue;
    }

    try {
      const before = await prisma.account.findUnique({
        where: { tenantId_code: { tenantId: owner.id, code: CODE } },
      });
      const currencyCode = owner.companySettings?.functionalCurrency ?? 'GBP';
      await prisma.account.upsert({
        where: { tenantId_code: { tenantId: owner.id, code: CODE } },
        create: {
          tenantId: owner.id,
          code: CODE,
          name: NAME,
          accountType: 'LIABILITY',
          currencyCode,
          roleProtected: true,
        },
        update: {},
      });
      if (before) {
        console.log(`[SKIP] ${owner.name} — ${CODE} already present`);
        skipped += 1;
      } else {
        console.log(`[OK]   ${owner.name} — created ${CODE} (${NAME})`);
        backfilled += 1;
      }
    } catch (err) {
      console.error(`[ERR]  ${owner.name} (${owner.id}): ${(err as Error).message}`);
      errors += 1;
    }
  }

  console.log(`\nBackfill complete: ${backfilled} created, ${skipped} skipped, ${errors} error(s) (of ${owners.length} owners).`);
  if (errors > 0) process.exitCode = 1;
}

backfillEmployeePayableAccount()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error('Fatal error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
