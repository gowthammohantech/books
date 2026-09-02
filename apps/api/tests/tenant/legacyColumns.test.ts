/**
 * tests/tenant/legacyColumns.test.ts
 *
 * P9 dropped `User.ownerId` and `User.roleId` and deleted the `requireUserId`
 * alias. Each of the three was a single-workspace assumption that
 * TenantMembership replaced, and each is the kind of thing that comes back:
 * `ownerId` reads like an obvious way to say "this person's company",
 * `User.roleId` reads like an obvious place for a role, and `requireUserId`
 * reads like it returns a user id (it returned a TENANT id, which is exactly
 * the confusion that produced the reminderController bug).
 *
 * A source scan is the right instrument here because the failure it prevents is
 * someone writing a NEW line that looks like the old ones — the columns are
 * gone, so Prisma would reject a query, but a raw SQL string or a
 * `as unknown as` cast would not be caught by anything else. Several of the
 * sites P9 fixed were hidden behind exactly such a cast.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

const SEARCH_DIRS = ['controllers', 'lib', 'middleware', 'routes', 'utils', 'validators', 'prisma'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'migrations', '.git']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|js)$/.test(entry.name) && !/\.(spec|test)\.[tj]s$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments so prose explaining a removed column is not a hit. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FILES = SEARCH_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d))).map((file) => ({
  rel: path.relative(ROOT, file).split(path.sep).join('/'),
  code: stripComments(fs.readFileSync(file, 'utf8')),
}));

// Comments stripped for the same reason the sources are: the schema now
// carries a note explaining where `roleId` and `ownerId` went, and prose about
// a removed column must not read as the column still being there.
const SCHEMA = fs
  .readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the scan itself works', () => {
  it('reads a plausible number of source files', () => {
    // Without this, a broken walk makes every assertion below pass vacuously.
    expect(FILES.length).toBeGreaterThan(150);
  });
});

describe('User.ownerId is gone', () => {
  it('is absent from the schema', () => {
    // The `staff`/`owner` self-relation goes with it.
    expect(SCHEMA).not.toMatch(/^\s*ownerId\s+String/m);
    expect(SCHEMA).not.toContain('"UserOwner"');
  });

  it('is not referenced by any application or seed source', () => {
    const offenders = FILES.filter(({ code }) => /\bownerId\b/.test(code)).map((f) => f.rel);
    expect(
      offenders,
      'User.ownerId was dropped in P9. "Which company is this person in?" is a ' +
        'question about TenantMembership — use lib/tenantMembers.ts.',
    ).toEqual([]);
  });
});

describe('User.roleId is gone', () => {
  it('is absent from the User model in the schema', () => {
    const userModel = /^model User \{([\s\S]*?)^\}/m.exec(SCHEMA)?.[1] ?? '';
    expect(userModel).not.toMatch(/\broleId\b/);
    expect(userModel).not.toMatch(/\brole\s+Role/);
  });

  it('leaves no `users` back-relation on Role', () => {
    const roleModel = /^model Role \{([\s\S]*?)^\}/m.exec(SCHEMA)?.[1] ?? '';
    expect(roleModel).not.toContain('"UserRole"');
  });

  it('is never read off a user object in application source', () => {
    // Narrow on purpose: `roleId` is a perfectly good field on Role,
    // Permission and TenantMembership. What must not come back is reading it
    // from a USER — a single global role for a person who holds a different
    // one in each workspace.
    const offenders = FILES.filter(({ code }) =>
      /\buser\??\.roleId\b/.test(code) || /\buser:\s*\{[^}]*\broleId\b/.test(code),
    ).map((f) => f.rel);
    expect(
      offenders,
      'A role is held through a TenantMembership, not by a User: the same ' +
        'person is an Owner in one workspace and a Viewer in another.',
    ).toEqual([]);
  });
});

describe('the requireUserId alias is gone', () => {
  it('is no longer exported by lib/tenantScope.ts', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/tenantScope.ts'), 'utf8');
    expect(src).not.toMatch(/export\s+(const|function)\s+requireUserId/);
  });

  it('has no remaining call sites', () => {
    const offenders = FILES.filter(({ code }) => /\brequireUserId\b/.test(code)).map((f) => f.rel);
    expect(
      offenders,
      'requireUserId returned a TENANT id despite its name — the ambiguity that ' +
        'made reminderController compare it against `createdBy`, an actor column. ' +
        'Use requireTenantId, or requireActingUserId when you want the person.',
    ).toEqual([]);
  });

  it('still exports the two unambiguous names', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/tenantScope.ts'), 'utf8');
    expect(src).toMatch(/export function requireTenantId/);
    expect(src).toMatch(/export function requireActingUserId/);
  });
});

describe('uploads go to blob storage, per workspace', () => {
  it('no multer middleware writes to disk', () => {
    // All five uploaders use memoryStorage and hand the buffer to
    // middleware/persistUploads, which writes it under the caller's workspace
    // prefix. diskStorage here is a file on an ephemeral container filesystem
    // that no other instance can see -- and one served, if at all, without auth.
    const offenders = FILES.filter(
      ({ rel, code }) => rel.startsWith('middleware/') && /diskStorage/.test(code),
    ).map((f) => f.rel);
    expect(offenders, 'use multer.memoryStorage() + persistUploads()').toEqual([]);
  });

  it('every multer parser is paired with the blob write that follows it', () => {
    // A parser exported on its own is an upload endpoint whose bytes are
    // dropped on the floor: the controller reads file.path and finds nothing.
    const parsers = FILES.filter(
      ({ rel, code }) => rel.startsWith('middleware/') && /multer\(/.test(code),
    );
    const offenders = parsers
      .filter(({ code }) => !/persistUploads\(/.test(code))
      .map((f) => f.rel);
    expect(parsers.length).toBeGreaterThan(0);
    expect(offenders, 'pair the multer instance with persistUploads()').toEqual([]);
  });
});
