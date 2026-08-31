/**
 * tests/tenant/tenantGuard.coverage.test.ts
 *
 * Every model in schema.prisma must be classified in EXACTLY ONE of the guard's
 * three lists.
 *
 * This is the test that makes the guard hold over time. A future feature adding
 * a model would otherwise land it in none of the lists, where it is passed
 * straight through — unguarded, silently, with nothing failing. Same spirit as
 * the existing tests/routeCoverage.test.ts, and the same regex-over-source
 * approach so it needs no new machinery.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  TENANT_MODELS,
  GLOBAL_MODELS,
  EXPLICIT_MODELS,
} from '../../lib/tenantGuard';

const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

/** `model Foo {` … up to the matching close, for every model in the schema. */
function schemaModels(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^model (\w+) \{\n([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SCHEMA)) !== null) out.set(m[1], m[2]);
  return out;
}

const MODELS = schemaModels();

describe('tenant guard model coverage', () => {
  it('finds a plausible number of models (the regex still works)', () => {
    expect(MODELS.size).toBeGreaterThan(90);
  });

  it('classifies every schema model exactly once', () => {
    const unclassified: string[] = [];
    const duplicated: string[] = [];

    for (const name of MODELS.keys()) {
      const hits = [
        TENANT_MODELS.has(name),
        GLOBAL_MODELS.has(name),
        EXPLICIT_MODELS.has(name),
      ].filter(Boolean).length;
      if (hits === 0) unclassified.push(name);
      if (hits > 1) duplicated.push(name);
    }

    expect(
      unclassified,
      'New models must be added to one of TENANT_MODELS / GLOBAL_MODELS / ' +
        'EXPLICIT_MODELS in lib/tenantGuard.ts. Anything missing from all three ' +
        'is passed through UNGUARDED.',
    ).toEqual([]);
    expect(duplicated, 'a model appears in more than one classification list').toEqual([]);
  });

  it('lists no model that the schema does not define', () => {
    const stale: string[] = [];
    for (const set of [TENANT_MODELS, GLOBAL_MODELS, EXPLICIT_MODELS]) {
      for (const name of set) if (!MODELS.has(name)) stale.push(name);
    }
    expect(stale, 'these are classified but no longer exist in schema.prisma').toEqual([]);
  });

  it('every TENANT_MODEL actually has a tenantId column to filter on', () => {
    // Without the column the guard would build a where clause Prisma rejects,
    // turning an isolation feature into a 500 on every request.
    const missing = [...TENANT_MODELS].filter(
      (name) => !/^\s+tenantId\s+String/m.test(MODELS.get(name) ?? ''),
    );
    expect(missing).toEqual([]);
  });

  it('no GLOBAL_MODEL has a tenantId column', () => {
    // A model with the column that is nonetheless passed through unfiltered is
    // almost certainly a misclassification.
    const suspicious = [...GLOBAL_MODELS].filter((name) =>
      /^\s+tenantId\s+String/m.test(MODELS.get(name) ?? ''),
    );
    expect(suspicious).toEqual([]);
  });

  it('keeps the four hand-scoped models explicit', () => {
    // Each is here for a specific, documented reason (see lib/tenantGuard.ts).
    // User in particular CANNOT be guarded — one person, many workspaces — and
    // is the one place the structural guarantee does not apply.
    expect([...EXPLICIT_MODELS].sort()).toEqual([
      'AuditLog', 'LoginActivity', 'TenantMembership', 'User',
    ]);
  });
});
