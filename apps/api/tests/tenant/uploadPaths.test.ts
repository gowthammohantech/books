/**
 * tests/tenant/uploadPaths.test.ts
 *
 * `server.js` serves the whole `uploads/` tree as UNAUTHENTICATED static
 * content. That was already a weakness on a single-company install — a
 * guessable filename is world-readable — and with several companies sharing a
 * deployment it becomes a cross-workspace one: logos, expense attachments and
 * the supplier invoices fed to AI extraction all landed in one flat directory,
 * indistinguishable by name.
 *
 * Splitting the tree by workspace does not by itself authorize anything (the
 * static mount is still open); it is the prerequisite for the authenticated
 * file route, which can then refuse a path whose tenant segment is not the
 * caller's in a single comparison.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, afterAll } from 'vitest';

import { runAsSystem, runAsTenant } from '../../lib/tenantContext';
import { TENANT_SEGMENT, UPLOAD_ROOT, destinationFor, uploadDirFor } from '../../lib/uploadPaths';

// uploadDirFor creates directories relative to the process cwd. Run from a
// scratch cwd so the test never writes into the repo's real uploads/ tree.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-uploads-'));
const originalCwd = process.cwd();
process.chdir(scratch);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(scratch, { recursive: true, force: true });
});

const TENANT = 'tenant-a';

describe('uploadDirFor', () => {
  it('puts a file under the acting workspace', async () => {
    const dir = await runAsTenant(TENANT, async () => uploadDirFor('products'));
    expect(dir).toBe(path.join(UPLOAD_ROOT, TENANT_SEGMENT, TENANT, 'products'));
  });

  it('separates two workspaces that upload the same category', async () => {
    const a = await runAsTenant('tenant-a', async () => uploadDirFor('company'));
    const b = await runAsTenant('tenant-b', async () => uploadDirFor('company'));
    expect(a).not.toBe(b);
  });

  it('creates the directory, so multer never fails on a missing path', async () => {
    const dir = await runAsTenant(TENANT, async () => uploadDirFor('ai-jobs'));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('is resolved per call, not fixed at module load', async () => {
    // The bug this guards: every one of the five multer middlewares used to
    // compute its destination once, at require() time, which cannot depend on
    // who is uploading.
    const first = await runAsTenant('tenant-a', async () => uploadDirFor());
    const second = await runAsTenant('tenant-b', async () => uploadDirFor());
    expect(first).toContain('tenant-a');
    expect(second).toContain('tenant-b');
  });

  it('falls back to the shared tree when there is no workspace in context', async () => {
    // Old behaviour, deliberately: throwing inside multer's destination
    // callback surfaces as an opaque 500, and a file in the shared tree is
    // exactly where every file went before this change.
    const dir = await runAsSystem(async () => uploadDirFor('company'));
    expect(dir).toBe(path.join(UPLOAD_ROOT, 'company'));
  });

  it('refuses a tenant id that would escape the upload root', async () => {
    // The id is a uuid from the verified ALS context, so this should never
    // fire on real input. It is here because the value becomes a PATH SEGMENT:
    // if it ever arrived from somewhere less trustworthy, `../` in it would
    // write outside uploads/. Falling back to the shared tree costs one
    // misfiled upload; honouring it costs the filesystem.
    const dir = await runAsTenant('../../etc', async () => uploadDirFor('company'));
    expect(dir).toBe(path.join(UPLOAD_ROOT, 'company'));
    expect(dir).not.toContain('..');
  });
});

describe('destinationFor', () => {
  it('hands multer the workspace directory', async () => {
    const cb = destinationFor('products');
    const dest = await runAsTenant(TENANT, async () =>
      new Promise<string>((resolve, reject) => {
        cb(null, null, (err, d) => (err ? reject(err) : resolve(d)));
      }),
    );
    expect(dest).toBe(path.join(UPLOAD_ROOT, TENANT_SEGMENT, TENANT, 'products'));
  });

  it('reports a failure through the callback rather than throwing', async () => {
    // multer swallows a synchronous throw from a destination callback into an
    // unhelpful 500; an error passed to `cb` reaches middleware/uploadError.js.
    const cb = destinationFor('company');
    const dir = path.join(UPLOAD_ROOT, 'company');
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    // A FILE where the directory should be: mkdirSync then fails with EEXIST.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, 'not a directory');

    const err = await runAsSystem(async () =>
      new Promise<Error | null>((resolve) => {
        cb(null, null, (e) => resolve(e));
      }),
    );
    expect(err).toBeInstanceOf(Error);

    fs.rmSync(dir, { force: true });
  });
});
