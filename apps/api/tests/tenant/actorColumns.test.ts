/**
 * tests/tenant/actorColumns.test.ts
 *
 * "Who did this" and "which company owns this" are different questions, and for
 * years they had the same answer: a tenant id WAS the owner's `User.id`, so
 * `createdBy: tenantId` stored a real user row and nothing complained.
 *
 * It stops being true for any workspace created through POST /api/auth/tenants,
 * which gets an ordinary uuid. No `User` row carries that id, so an insert into
 * a column that is a foreign key to User dies on the constraint — creating an
 * expense in such a workspace returned 500. That is what this guards.
 *
 * THE COLUMN LIST IS DERIVED FROM THE SCHEMA, not hand-written: a relation to
 * User added next year is covered the day it is added. Same reasoning as
 * prisma/checkTenantIntegrity.ts.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

const ROOT = path.resolve(__dirname, '../..');

/** Every scalar column in the schema that is a foreign key to User. */
function userForeignKeyColumns(): string[] {
  const cols = new Set<string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    for (const field of model.fields) {
      if (field.kind !== 'object' || field.type !== 'User') continue;
      for (const fk of field.relationFromFields ?? []) cols.add(fk);
    }
  }
  return [...cols].sort();
}

const ACTOR_COLUMNS = userForeignKeyColumns();

/**
 * prisma/** is excluded deliberately. seed-demo-full.ts writes the demo
 * workspace's id into these columns, which is correct there because the demo
 * tenant reuses the demo admin's User.id — an invariant that file now asserts
 * at startup rather than assumes.
 */
const SEARCH_DIRS = ['controllers', 'lib', 'middleware', 'routes', 'services', 'utils'];

const SKIP = new Set(['node_modules', 'dist', '.git']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|js)$/.test(entry.name) && !/\.(spec|test)\.[tj]s$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FILES = SEARCH_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d))).map((file) => ({
  rel: path.relative(ROOT, file).split(path.sep).join('/'),
  code: stripComments(fs.readFileSync(file, 'utf8')),
}));

describe('the scan itself works', () => {
  it('derives a plausible set of User foreign-key columns from the schema', () => {
    expect(ACTOR_COLUMNS.length).toBeGreaterThan(8);
    // Spot-check the ones that actually crashed, so a broken DMMF walk cannot
    // make every assertion below pass by looking at nothing.
    for (const known of ['createdBy', 'changedBy', 'received_by', 'billFrom', 'voidedById']) {
      expect(ACTOR_COLUMNS).toContain(known);
    }
  });

  it('reads a plausible number of source files', () => {
    expect(FILES.length).toBeGreaterThan(150);
  });
});

describe('no column that is a foreign key to User is given a tenant id', () => {
  it.each(ACTOR_COLUMNS)('%s', (column) => {
    // Matches `column: tenantId`, `column: tenantUserId`, `column:
    // requireTenantId(req)` — the three spellings that existed.
    const pattern = new RegExp(
      `\\b${column}\\s*:\\s*(tenantId|tenantUserId|requireTenantId\\s*\\()`,
    );
    const offenders = FILES.filter(({ code }) => pattern.test(code)).map((f) => f.rel);

    expect(
      offenders,
      `"${column}" is a foreign key to User. A tenant id is not a user id — in a ` +
        'workspace created through POST /api/auth/tenants it matches no User row and ' +
        'the write fails the constraint. Use requireActingUserId(req) for who DID it, ' +
        'or tenantOwnerUserId(tenantId) for the "this company" party columns ' +
        '(billFrom/billTo). See lib/actor.ts.',
    ).toEqual([]);
  });
});

describe('lib/actor.ts is the documented answer', () => {
  it('exports the two resolvers the fix depends on', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/actor.ts'), 'utf8');
    expect(src).toMatch(/export function currentActorId/);
    expect(src).toMatch(/export async function tenantOwnerUserId/);
    expect(src).toMatch(/export async function resolveActorId/);
  });
});
