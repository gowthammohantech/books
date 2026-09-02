/**
 * Ledger integrity check — the sibling of checkTenantIntegrity.ts.
 *
 *   npm run prisma:check:ledger              # every workspace
 *   npx ts-node prisma/checkLedger.ts --tenant <id|slug>
 *
 * WHY. lib/ledger/buildLines.ts already refuses to write an unbalanced entry,
 * so in principle none can exist. Two things get past it:
 *
 *   1. Manual journal entries built by hand (prisma/seed-demo-full.ts writes
 *      three) go through journalEntry.create directly, not through buildLines.
 *
 *   2. Far more dangerous, lib/ledger/postingGate.ts `shouldPost()` returns
 *      FALSE — silently, with no error — for any document dated before the
 *      workspace's goLiveDate, or when ledgerInitialized is not set. The
 *      document is created and the ledger simply never hears about it. Nothing
 *      fails, nothing logs, and the books are quietly wrong. That is not
 *      hypothetical: it is how three of four seeded fixed assets came to be
 *      depreciated and disposed without ever having been capitalised.
 *
 * So this asserts the two things the writer cannot: that every entry balances,
 * and that documents which SHOULD have produced entries actually did.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface LedgerViolation {
  check: string;
  detail: string;
  count: number;
  sample: string[];
}

export interface LedgerReport {
  tenants: number;
  entriesChecked: number;
  violations: LedgerViolation[];
}

interface UnbalancedRow {
  id: string;
  diff: string;
}

interface MissingRow {
  id: string;
}

async function checkTenant(tenantId: string, out: LedgerViolation[]): Promise<number> {
  // --- 1. every entry balances, on both the transaction and base currency ---
  const unbalanced = await prisma.$queryRaw<UnbalancedRow[]>`
    SELECT je.id, (SUM(jl.debit) - SUM(jl.credit))::text AS diff
    FROM "JournalEntry" je
    JOIN "JournalLine" jl ON jl."journalEntryId" = je.id
    WHERE je."tenantId" = ${tenantId} AND je."isDeleted" = false
    GROUP BY je.id
    HAVING SUM(jl.debit) <> SUM(jl.credit)
    LIMIT 20`;
  if (unbalanced.length > 0) {
    out.push({
      check: 'unbalanced entry (debit vs credit)',
      detail: `tenant ${tenantId}`,
      count: unbalanced.length,
      sample: unbalanced.map((r) => `${r.id} (off by ${r.diff})`),
    });
  }

  const unbalancedBase = await prisma.$queryRaw<UnbalancedRow[]>`
    SELECT je.id, (SUM(jl."baseDebit") - SUM(jl."baseCredit"))::text AS diff
    FROM "JournalEntry" je
    JOIN "JournalLine" jl ON jl."journalEntryId" = je.id
    WHERE je."tenantId" = ${tenantId} AND je."isDeleted" = false
    GROUP BY je.id
    HAVING SUM(jl."baseDebit") <> SUM(jl."baseCredit")
    LIMIT 20`;
  if (unbalancedBase.length > 0) {
    out.push({
      check: 'unbalanced entry (base currency)',
      detail: `tenant ${tenantId}`,
      count: unbalancedBase.length,
      sample: unbalancedBase.map((r) => `${r.id} (off by ${r.diff})`),
    });
  }

  // --- 2. an entry with no lines at all -------------------------------------
  const empty = await prisma.$queryRaw<MissingRow[]>`
    SELECT je.id FROM "JournalEntry" je
    WHERE je."tenantId" = ${tenantId} AND je."isDeleted" = false
      AND NOT EXISTS (SELECT 1 FROM "JournalLine" jl WHERE jl."journalEntryId" = je.id)
    LIMIT 20`;
  if (empty.length > 0) {
    out.push({
      check: 'journal entry with no lines',
      detail: `tenant ${tenantId}`,
      count: empty.length,
      sample: empty.map((r) => r.id),
    });
  }

  // --- 3. documents that should have posted but did not ---------------------
  // Only documents dated on/after goLiveDate are in scope: anything earlier is
  // legitimately unposted (it predates the books) rather than a lost posting.
  const settings = await prisma.companySettings.findFirst({
    where: { tenantId },
    select: { ledgerInitialized: true, goLiveDate: true },
  });
  if (!settings?.ledgerInitialized || !settings.goLiveDate) {
    // Nothing should have posted, so there is nothing to reconcile.
    return prisma.journalEntry.count({ where: { tenantId, isDeleted: false } });
  }
  const goLive = settings.goLiveDate;

  const unpostedInvoices = await prisma.$queryRaw<MissingRow[]>`
    SELECT i.id FROM "Invoice" i
    WHERE i."tenantId" = ${tenantId}
      AND i."isDeleted" = false
      AND i."invoiceType" = 'INVOICE'
      AND i."invoiceDate" >= ${goLive}
      AND NOT EXISTS (
        SELECT 1 FROM "JournalEntry" je
        WHERE je."tenantId" = i."tenantId" AND je."sourceType" = 'Invoice'
          AND je."sourceId" = i.id AND je.event = 'issued' AND je."isDeleted" = false)
    LIMIT 20`;
  if (unpostedInvoices.length > 0) {
    out.push({
      check: 'invoice issued on/after go-live with no GL entry',
      detail: `tenant ${tenantId} — postingGate silently skipped these`,
      count: unpostedInvoices.length,
      sample: unpostedInvoices.map((r) => r.id),
    });
  }

  const unpostedPurchases = await prisma.$queryRaw<MissingRow[]>`
    SELECT p.id FROM "Purchase" p
    WHERE p."tenantId" = ${tenantId}
      AND p."isDeleted" = false
      AND p."purchaseDate" >= ${goLive}
      AND NOT EXISTS (
        SELECT 1 FROM "JournalEntry" je
        WHERE je."tenantId" = p."tenantId" AND je."sourceType" = 'Purchase'
          AND je."sourceId" = p.id AND je.event = 'received' AND je."isDeleted" = false)
    LIMIT 20`;
  if (unpostedPurchases.length > 0) {
    out.push({
      check: 'purchase received on/after go-live with no GL entry',
      detail: `tenant ${tenantId}`,
      count: unpostedPurchases.length,
      sample: unpostedPurchases.map((r) => r.id),
    });
  }

  // Fixed assets are the case that motivated this check: capitalisation is the
  // one posting whose absence still leaves every individual entry balanced.
  const uncapitalised = await prisma.$queryRaw<MissingRow[]>`
    SELECT f.id FROM "FixedAsset" f
    WHERE f."tenantId" = ${tenantId}
      AND f."isDeleted" = false
      AND f."acquisitionDate" >= ${goLive}
      AND NOT EXISTS (
        SELECT 1 FROM "JournalEntry" je
        WHERE je."tenantId" = f."tenantId" AND je."sourceType" = 'FixedAsset'
          AND je."sourceId" = f.id AND je.event = 'acquisition' AND je."isDeleted" = false)
    LIMIT 20`;
  if (uncapitalised.length > 0) {
    out.push({
      check: 'fixed asset acquired on/after go-live but never capitalised',
      detail: `tenant ${tenantId} — it can still be depreciated and disposed`,
      count: uncapitalised.length,
      sample: uncapitalised.map((r) => r.id),
    });
  }

  return prisma.journalEntry.count({ where: { tenantId, isDeleted: false } });
}

export async function checkLedger(only?: string): Promise<LedgerReport> {
  const where = only
    ? { deletedAt: null, OR: [{ id: only }, { slug: only }] }
    : { deletedAt: null };
  const tenants = await prisma.tenant.findMany({ where, select: { id: true, name: true } });

  const violations: LedgerViolation[] = [];
  let entriesChecked = 0;
  for (const t of tenants) {
    entriesChecked += await checkTenant(t.id, violations);
  }
  return { tenants: tenants.length, entriesChecked, violations };
}

function formatReport(r: LedgerReport): string {
  if (r.violations.length === 0) {
    return `Ledger integrity: OK — ${r.entriesChecked} journal entr(ies) across ${r.tenants} workspace(s), all balanced and accounted for.`;
  }
  const lines = [
    `Ledger integrity: ${r.violations.length} PROBLEM(S) across ${r.tenants} workspace(s).`,
    '',
    'An entry that does not balance, or a document that produced no entry at all,',
    'means the reports built on this ledger are wrong. See lib/ledger/postingGate.ts',
    'for why a posting can go missing without raising anything.',
    '',
  ];
  for (const v of r.violations) {
    lines.push(`  ${v.check}: ${v.count} row(s)`, `    ${v.detail}`, `    sample: ${v.sample.join(', ')}`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const idx = process.argv.indexOf('--tenant');
  const only = idx !== -1 ? process.argv[idx + 1] : undefined;
  checkLedger(only)
    .then((report) => {
      console.log(formatReport(report));
      return prisma.$disconnect().then(() => {
        process.exit(report.violations.length === 0 ? 0 : 1);
      });
    })
    .catch(async (e) => {
      console.error('checkLedger error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
