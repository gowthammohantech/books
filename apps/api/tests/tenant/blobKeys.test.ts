/**
 * tests/tenant/blobKeys.test.ts
 *
 * Uploads used to land in one flat `uploads/` tree that `server.ts` served as
 * UNAUTHENTICATED static content. That was already a weakness on a
 * single-company install — a guessable filename is world-readable — and with
 * several companies sharing a deployment it was a cross-workspace one: logos,
 * expense attachments and the supplier invoices fed to AI extraction all sat in
 * one directory, indistinguishable by name.
 *
 * Files now live in a private blob container, reachable only through a signed
 * URL the API mints per response, and the key carries the workspace prefix. The
 * prefix is no longer the *only* thing separating two companies' documents —
 * the container being private is — but it is still what keeps a request for
 * another workspace's blob refusable in one comparison, and what stops two
 * companies' files colliding on a name.
 */
import { describe, it, expect } from 'vitest';

import { blobKeyFor, TENANT_SEGMENT } from '../../lib/blobStorage';
import { runAsSystem, runAsTenant } from '../../lib/tenantContext';

const TENANT = 'tenant-a';

describe('blobKeyFor', () => {
  it('puts a file under the acting workspace', async () => {
    const key = await runAsTenant(TENANT, async () => blobKeyFor('products', 'photo.png'));
    expect(key.startsWith(`${TENANT_SEGMENT}/${TENANT}/products/`)).toBe(true);
  });

  it('keeps the original extension, so content type survives a round trip', async () => {
    const key = await runAsTenant(TENANT, async () => blobKeyFor('company', 'logo.WEBP'));
    expect(key.endsWith('.WEBP')).toBe(true);
  });

  it('separates two workspaces that upload the same category', async () => {
    const a = await runAsTenant('tenant-a', async () => blobKeyFor('company', 'l.png'));
    const b = await runAsTenant('tenant-b', async () => blobKeyFor('company', 'l.png'));
    expect(a).toContain('tenant-a');
    expect(b).toContain('tenant-b');
    expect(a).not.toBe(b);
  });

  it('is resolved per call, not fixed at module load', async () => {
    // The bug this guards: every one of the five multer middlewares used to
    // compute its destination once, at require() time, which cannot depend on
    // who is uploading.
    const first = await runAsTenant('tenant-a', async () => blobKeyFor(undefined, 'a.png'));
    const second = await runAsTenant('tenant-b', async () => blobKeyFor(undefined, 'a.png'));
    expect(first).toContain('tenant-a');
    expect(second).toContain('tenant-b');
  });

  it('does not collide when the same name is uploaded twice', async () => {
    const a = await runAsTenant(TENANT, async () => blobKeyFor('company', 'logo.png'));
    const b = await runAsTenant(TENANT, async () => blobKeyFor('company', 'logo.png'));
    expect(a).not.toBe(b);
  });

  it('falls back to an un-prefixed key when there is no workspace in context', async () => {
    // Old behaviour, deliberately: the first-run setup logo is uploaded before
    // a workspace exists, and throwing here would surface as an opaque 500.
    const key = await runAsSystem(async () => blobKeyFor('company', 'logo.png'));
    expect(key.startsWith('company/')).toBe(true);
    expect(key).not.toContain(TENANT_SEGMENT + '/');
  });

  it('refuses a tenant id that would escape the workspace prefix', async () => {
    // The id is a uuid from the verified ALS context, so this should never fire
    // on real input. It is here because the value becomes a KEY SEGMENT: if it
    // ever arrived from somewhere less trustworthy, `../` in it would address a
    // blob outside this workspace. Falling back costs one misfiled upload;
    // honouring it costs the isolation.
    const key = await runAsTenant('../../etc', async () => blobKeyFor('company', 'x.png'));
    expect(key.startsWith('company/')).toBe(true);
    expect(key).not.toContain('..');
  });
});
