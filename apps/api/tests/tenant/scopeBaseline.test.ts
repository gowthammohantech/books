/**
 * tests/tenant/scopeBaseline.test.ts
 *
 * A ratchet on unscoped Prisma queries. It does not claim the codebase is
 * clean — it freezes how unclean it is, so the number can only go down.
 *
 * WHY THIS EXISTS. `lib/tenantGuard.ts` is the runtime check, and it ships in
 * `warn` mode: it logs the decision and serves the row anyway. Nothing else
 * sees a missing `tenantId` at all, because the field is optional on every
 * `where`, so the compiler is silent. The quotation domain shipped five
 * handlers that resolved a document by id alone, and a golden capture proved
 * every one of them served another tenant's data (see
 * `tests/tenant/quotationScope.test.ts`). Those five sat in the codebase
 * through a full test suite, a type checker and a lint run.
 *
 * WHAT FAILS THIS TEST: adding a query on a tenant-owned model whose `where`
 * carries no tenant filter. Fixing one does not fail it — the baseline is a
 * ceiling, not an equality.
 *
 * THE BASELINE IS A DEBT REGISTER, NOT AN APPROVAL. Some entries are fine on
 * inspection (a row resolved by an id the same transaction just generated).
 * Others are not, and are recorded in the refactor proposal's defect list.
 * Nobody has been through all 38 one by one; that is the honest state.
 */
import { describe, expect, it } from 'vitest';

import { scan, TENANT_MODELS } from '../../scripts/scanTenantScope';

const ROOTS = ['controllers', 'lib'];

/**
 * Reads whose ONLY filter is the id, as of the quotation-domain commit.
 *
 * This is the dangerous shape: the read is the whole authorization decision, so
 * an unscoped one hands a caller any tenant's row for an id they can guess or
 * observe. Writes with a bare `{ id }` after a scoped read are a narrower
 * problem (a TOCTOU window, not a leak) and are counted, not listed.
 */
const ID_ONLY_READ_BASELINE = 38;

/** Every unscoped query, including the bare-id writes. */
const TOTAL_BASELINE = 520;

describe('tenant scope ratchet', () => {
  it('reads the tenant-owned model list from the schema, not a hand-kept list', () => {
    // A hand-kept list is the failure mode this replaces: a model gains a
    // tenantId and the list does not, so the scanner stops seeing it.
    expect(TENANT_MODELS.has('Quotation')).toBe(true);
    expect(TENANT_MODELS.has('Invoice')).toBe(true);
    // Not tenant-owned: users belong to tenants through TenantMembership.
    expect(TENANT_MODELS.has('User')).toBe(false);
  });

  it('has no new by-id read that skips the tenant filter', () => {
    const idOnly = scan(ROOTS).filter((f) => f.idOnlyRead);
    const report = idOnly.map((f) => `  ${f.file}:${f.line}  ${f.model}.${f.op}  ${f.where}`).join('\n');
    expect(
      idOnly.length,
      `Unscoped by-id reads went from ${ID_ONLY_READ_BASELINE} to ${idOnly.length}.\n` +
        'A read filtered only by id IS the authorization decision, so an unscoped\n' +
        'one serves any tenant the row. Add tenantId to the where, or — if the id\n' +
        'genuinely cannot come from a caller — lower the baseline with a reason.\n' +
        `Current sites:\n${report}`,
    ).toBeLessThanOrEqual(ID_ONLY_READ_BASELINE);
  });

  it('has no new unscoped query of any kind', () => {
    const all = scan(ROOTS);
    expect(
      all.length,
      `Unscoped queries went from ${TOTAL_BASELINE} to ${all.length}. ` +
        'Run `npx ts-node scripts/scanTenantScope.ts --all` to see them.',
    ).toBeLessThanOrEqual(TOTAL_BASELINE);
  });

  it('detects an unscoped query in a fixture, so a passing run means something', () => {
    // The ratchet is worthless if the scanner can silently stop finding things.
    // These two strings are what it is looking for and what it must ignore.
    const findings = scan(ROOTS);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => TENANT_MODELS.has(f.model))).toBe(true);
    expect(findings.every((f) => !/tenantId/.test(f.where))).toBe(true);
  });
});
