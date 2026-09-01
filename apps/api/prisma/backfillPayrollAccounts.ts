/**
 * Backfill 9260 "Net Wages Payable" + 9270 "Payroll Deductions Payable"
 * (both LIABILITY) for every existing owner with an initialized ledger.
 *
 * Code-based EXTRA_ACCOUNTS (9200-family), NOT LedgerRoles — no
 * LedgerAccountMapping, resolved by code at posting time. Mirrors
 * backfillEmployeePayableAccount.ts. Idempotent: account.upsert on (tenantId, code).
 *
 * Run:  npx ts-node prisma/backfillPayrollAccounts.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ACCOUNTS: { code: string; name: string }[] = [
  { code: '9260', name: 'Net Wages Payable' },
  { code: '9270', name: 'Payroll Deductions Payable' },
];

async function backfillPayrollAccounts(): Promise<void> {
  const owners = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, companySettings: { select: { functionalCurrency: true } } },
  });

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const owner of owners) {
    const mappingCount = await prisma.ledgerAccountMapping.count({ where: { tenantId: owner.id } });
    if (mappingCount === 0) {
      console.log(`[SKIP] ${owner.name} (${owner.id}) — no ledger mappings yet`);
      skipped += 1;
      continue;
    }
    const currencyCode = owner.companySettings?.functionalCurrency ?? 'GBP';
    for (const acct of ACCOUNTS) {
      try {
        const before = await prisma.account.findUnique({
          where: { tenantId_code: { tenantId: owner.id, code: acct.code } },
        });
        await prisma.account.upsert({
          where: { tenantId_code: { tenantId: owner.id, code: acct.code } },
          create: {
            tenantId: owner.id,
            code: acct.code,
            name: acct.name,
            accountType: 'LIABILITY',
            currencyCode,
            roleProtected: true,
          },
          update: {},
        });
        if (before) {
          console.log(`[SKIP] ${owner.name} — ${acct.code} already present`);
          skipped += 1;
        } else {
          console.log(`[OK]   ${owner.name} — created ${acct.code} (${acct.name})`);
          created += 1;
        }
      } catch (err) {
        console.error(`[ERR]  ${owner.name} (${owner.id}) ${acct.code}: ${(err as Error).message}`);
        errors += 1;
      }
    }
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} skipped, ${errors} error(s) (of ${owners.length} owners).`);
  if (errors > 0) process.exitCode = 1;
}

backfillPayrollAccounts()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error('Fatal error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
