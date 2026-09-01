/**
 * prisma/checkTenantIntegrity.ts
 *
 * Verifies the invariant that lib/tenantGuard.ts CANNOT enforce and depends on:
 *
 *     a foreign key never crosses a tenant boundary.
 *
 * The guard filters top-level queries. It does not filter relation reads
 * (`include: { payments: true }` returns whatever the FK points at, limitation
 * 2) and it cannot tell whether a `connect: { id }` names a row belonging to
 * someone else (limitation 3). Both are safe if — and only if — every FK
 * between two tenant-scoped rows joins rows in the SAME workspace. That is a
 * property of the data, so it is checked against the data.
 *
 * WHAT IT CHECKS. Every foreign key in the schema whose owning model and target
 * model are both in TENANT_MODELS. The pairs are derived from Prisma's DMMF
 * rather than hand-listed, so a relation added next year is covered the day it
 * is added — the same reason tenantGuard.coverage.test.ts reads the schema
 * instead of a curated list.
 *
 * It also checks the two DENORMALIZED columns P2 introduced (a child carrying
 * its own tenantId alongside a parent that has one), because those are exactly
 * where a copy can drift out of step with its source.
 *
 * Run:  npx ts-node prisma/checkTenantIntegrity.ts
 * Exit: 0 clean, 1 if any violation was found.
 */

import { Prisma, PrismaClient } from '@prisma/client';

import { TENANT_MODELS } from '../lib/tenantGuard';

const prisma = new PrismaClient();

export interface CrossTenantViolation {
  /** e.g. "InvoicePayment.invoiceId -> Invoice" */
  relation: string;
  childModel: string;
  parentModel: string;
  /** How many rows join a parent in a different workspace. */
  count: number;
  /** A handful of offending child ids, to make the report actionable. */
  sampleIds: string[];
}

export interface IntegrityReport {
  checked: number;
  violations: CrossTenantViolation[];
}

interface FkPair {
  childModel: string;
  parentModel: string;
  childColumn: string;
  parentColumn: string;
  nullable: boolean;
}

/**
 * Every FK from one tenant-scoped model to another, straight out of the DMMF.
 *
 * Only the OWNING side of a relation carries `relationFromFields`, so each pair
 * is discovered exactly once and there is no need to dedupe the back-relation.
 */
export function tenantForeignKeys(): FkPair[] {
  const out: FkPair[] = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    if (!TENANT_MODELS.has(model.name)) continue;
    for (const field of model.fields) {
      if (field.kind !== 'object') continue;
      if (!TENANT_MODELS.has(field.type)) continue;
      const from = field.relationFromFields ?? [];
      const to = field.relationToFields ?? [];
      // Composite FKs are not used anywhere in this schema; skip rather than
      // guess at a join condition.
      if (from.length !== 1 || to.length !== 1) continue;
      // Self-relations (Invoice.parentInvoice, User.owner) still have to hold.
      const scalar = model.fields.find((f) => f.name === from[0]);
      out.push({
        childModel: model.name,
        parentModel: field.type,
        childColumn: from[0],
        parentColumn: to[0],
        nullable: !(scalar?.isRequired ?? true),
      });
    }
  }
  return out.sort((a, b) =>
    `${a.childModel}.${a.childColumn}`.localeCompare(`${b.childModel}.${b.childColumn}`),
  );
}

/** Postgres identifiers are quoted; nothing here comes from user input. */
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function checkPair(pair: FkPair): Promise<CrossTenantViolation | null> {
  const { childModel, parentModel, childColumn, parentColumn } = pair;
  const sql =
    `SELECT c."id"::text AS id ` +
    `FROM ${q(childModel)} c ` +
    `JOIN ${q(parentModel)} p ON p.${q(parentColumn)} = c.${q(childColumn)} ` +
    `WHERE c."tenantId" IS DISTINCT FROM p."tenantId" ` +
    `LIMIT 6`;

  const rows = (await prisma.$queryRawUnsafe(sql)) as Array<{ id: string }>;
  if (rows.length === 0) return null;

  // Only count when something is actually wrong — the count is the expensive
  // half and a clean database should never pay for it.
  const countSql =
    `SELECT count(*)::int AS n ` +
    `FROM ${q(childModel)} c ` +
    `JOIN ${q(parentModel)} p ON p.${q(parentColumn)} = c.${q(childColumn)} ` +
    `WHERE c."tenantId" IS DISTINCT FROM p."tenantId"`;
  const [{ n }] = (await prisma.$queryRawUnsafe(countSql)) as Array<{ n: number }>;

  return {
    relation: `${childModel}.${childColumn} -> ${parentModel}`,
    childModel,
    parentModel,
    count: n,
    sampleIds: rows.slice(0, 5).map((r) => r.id),
  };
}

export async function checkTenantIntegrity(): Promise<IntegrityReport> {
  const pairs = tenantForeignKeys();
  const violations: CrossTenantViolation[] = [];

  for (const pair of pairs) {
    try {
      const v = await checkPair(pair);
      if (v) violations.push(v);
    } catch (err) {
      // A relation whose SQL will not run (an unusual mapping, a table this
      // build does not have) is reported rather than skipped silently — an
      // unrunnable check is indistinguishable from a passing one otherwise.
      violations.push({
        relation: `${pair.childModel}.${pair.childColumn} -> ${pair.parentModel}`,
        childModel: pair.childModel,
        parentModel: pair.parentModel,
        count: -1,
        sampleIds: [`CHECK FAILED: ${err instanceof Error ? err.message : String(err)}`],
      });
    }
  }

  return { checked: pairs.length, violations };
}

export function formatReport(report: IntegrityReport): string {
  if (report.violations.length === 0) {
    return `Tenant integrity: OK — ${report.checked} foreign keys checked, none cross a workspace boundary.`;
  }
  const lines = [
    `Tenant integrity: ${report.violations.length} VIOLATION(S) across ${report.checked} foreign keys checked.`,
    '',
    'A foreign key pointing at another workspace means the tenant guard can be',
    'walked around through a relation read (include/select) — see limitations 2',
    'and 3 in lib/tenantGuard.ts. Every row below needs repairing or deleting.',
    '',
  ];
  for (const v of report.violations) {
    lines.push(
      `  ${v.relation}: ${v.count < 0 ? 'CHECK ERROR' : `${v.count} row(s)`}`,
      `    sample: ${v.sampleIds.join(', ')}`,
    );
  }
  return lines.join('\n');
}

if (require.main === module) {
  checkTenantIntegrity()
    .then((report) => {
      console.log(formatReport(report));
      return prisma.$disconnect().then(() => {
        process.exit(report.violations.length === 0 ? 0 : 1);
      });
    })
    .catch(async (e) => {
      console.error('checkTenantIntegrity error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
