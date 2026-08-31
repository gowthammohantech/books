/**
 * tests/tenant/clearDemoInventory.test.ts
 *
 * prisma/clear-demo.ts holds a HAND-MAINTAINED list of tables to purge, in
 * hand-maintained foreign-key order. Every tenant-scoped model it forgets is a
 * row that survives the purge — demo data that reappears in a "clean" install,
 * and, since this script is the seed of a future "delete workspace" feature,
 * one company's data left behind after they asked for it to be gone.
 *
 * A hand-maintained list next to a machine-readable one (TENANT_MODELS) should
 * be checked against it rather than trusted, which is what this does.
 *
 * Every gap is either fixed in clear-demo.ts or listed in DELIBERATELY_KEPT
 * below with a reason. There is no third option — an unexplained gap fails.
 *
 * TenantMembership is absent from both lists on purpose: it is an EXPLICIT
 * model rather than a TENANT_MODEL, and the purge removes it anyway by deleting
 * the demo User rows it cascades from.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

import { TENANT_MODELS } from '../../lib/tenantGuard';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../prisma/clear-demo.ts'),
  'utf8',
);

/** `tx.foo.deleteMany(` / `prisma.foo.deleteMany(` → the model name Prisma uses. */
function purgedDelegates(): Set<string> {
  const out = new Set<string>();
  const re = /(?:tx|prisma|px)\.(\w+)\.deleteMany/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC)) !== null) out.add(m[1]);
  return out;
}

/** TENANT_MODELS is PascalCase; Prisma delegates are camelCase. */
const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Models the purge deliberately does not touch, each for a reason that would
 * otherwise have to be rediscovered by whoever next reads the diff.
 */
const DELIBERATELY_KEPT: Record<string, string> = {
  // Per-tenant RBAC. seedRoles recreates these on the next boot, and deleting
  // them would strip the demo admin of every permission mid-purge.
  Role: 'recreated by seedRoles on the next boot',
  Permission: 'recreated by seedRoles on the next boot',
  // Per-tenant catalogs the demo seed reuses rather than recreates. The demo
  // seeder is idempotent against them (ensureBrand/ensureCategory/ensureUnit).
  Brand: 'reused by seed-demo-full via ensureBrand',
  Category: 'reused by seed-demo-full via ensureCategory',
  Unit: 'reused by seed-demo-full via ensureUnit',
  TaxGroup: 'reused by seed-demo-full via ensureTaxGroup',
  Currency: 'stocked once per workspace by seedTenant; not demo data',
  EmailTemplate: 'stocked once per workspace by seedTenant; not demo data',
  GeneralSetting: 'user preferences, not demo data',
  CustomField: 'schema-like configuration, not demo data',
  CustomFieldValue: 'goes with the records it annotates, which ARE purged',
  CustomFieldDataType: 'schema-like configuration, not demo data',
  // Credentials and integration config: purging demo ROWS should not revoke a
  // key an operator issued.
  TenantApiKey: 'a credential, not demo data',
  EmailSettings: 'operator-configured transport, not demo data',
  MtdConfig: 'operator-configured integration, not demo data',
  // Time tracking, payroll and signatures: the demo seed does not create them,
  // so there is nothing of its to remove.
  Timesheet: 'not created by the demo seed',
  TimeEntry: 'not created by the demo seed',
  ProjectMember: 'not created by the demo seed',
  Holiday: 'not created by the demo seed',
  LeaveType: 'not created by the demo seed',
  LeaveRequest: 'not created by the demo seed',
  LeaveRequestDay: 'not created by the demo seed',
  LeaveAllocation: 'not created by the demo seed',
  PayrollProfile: 'not created by the demo seed',
  PayRun: 'not created by the demo seed',
  PayRunLine: 'not created by the demo seed',
  Signature: 'not created by the demo seed',
  InvoiceTemplate: 'not created by the demo seed',
  RecurringInvoiceSchedule: 'not created by the demo seed',
  AccountCreditEntry: 'not created by the demo seed',
  InventoryCostLayer: 'not created by the demo seed',
  ExplanationHint: 'not created by the demo seed',
  Contact: 'purged via the Customer/Supplier rows it was derived from',
  Conversation: 'not created by the demo seed',
  AIChatSession: 'not created by the demo seed',
  AIPromptLog: 'not created by the demo seed',
  AIPromptTemplate: 'not created by the demo seed',
  AIConfiguration: 'not created by the demo seed',
};

describe('clear-demo purge inventory', () => {
  const purged = purgedDelegates();

  it('parses a plausible number of deleteMany targets', () => {
    // If the regex drifts, every assertion below passes by looking at nothing.
    expect(purged.size).toBeGreaterThan(40);
  });

  it('covers every tenant-scoped model, or says why not', () => {
    const unexplained: string[] = [];
    for (const model of TENANT_MODELS) {
      if (purged.has(delegateName(model))) continue;
      if (model in DELIBERATELY_KEPT) continue;
      unexplained.push(model);
    }
    expect(
      unexplained,
      'These tenant-scoped models are neither purged by prisma/clear-demo.ts nor ' +
        'listed in DELIBERATELY_KEPT with a reason. Add the deleteMany, or add ' +
        'the model here explaining why its rows should survive a purge.',
    ).toEqual([]);
  });

  it('keeps the exemption list honest — no stale entries', () => {
    // An exemption for a model that IS purged, or that no longer exists, is a
    // comment that has stopped being true.
    const stale = Object.keys(DELIBERATELY_KEPT).filter(
      (m) => !TENANT_MODELS.has(m) || purged.has(delegateName(m)),
    );
    expect(stale, 'these exemptions no longer describe reality').toEqual([]);
  });

  it('purges nothing that is not tenant-scoped, except User', () => {
    // User is the one model with no tenantId (one person, N workspaces); the
    // purge removes the demo accounts by id. Anything ELSE outside
    // TENANT_MODELS would be platform reference data that other workspaces
    // share — deleting it would break them.
    const byModelName = new Map([...TENANT_MODELS].map((m) => [delegateName(m), m]));
    const offenders = [...purged].filter((d) => d !== 'user' && !byModelName.has(d));
    expect(offenders, 'clear-demo purges non-tenant tables').toEqual([]);
  });
});
