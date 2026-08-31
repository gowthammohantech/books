/**
 * Where an uploaded file goes on disk.
 *
 * Everything used to land in one flat `uploads/` tree, and `server.js` serves
 * that tree as UNAUTHENTICATED static content. On a single-company install that
 * was a weakness — a guessable filename is world-readable. With many companies
 * on one deployment it is a cross-workspace one: company logos, expense
 * attachments and the source documents fed to AI extraction all sit in the same
 * directory, indistinguishable by name.
 *
 * Files are now written under `uploads/t/<tenantId>/<category>/`, which
 * separates them by workspace and gives the authenticated file route this plan
 * defers something to authorize against: a request for a path whose `<tenantId>`
 * segment is not the caller's is refusable in one comparison. Until that route
 * exists this is not yet an access control — the static mount still serves the
 * tree — but it is the prerequisite for one, and it stops a filename collision
 * or a directory listing from mixing two companies' documents together.
 *
 * EXISTING FILES DO NOT MOVE. Rows store the relative path they were written
 * with (`uploads/1234.png`), the static mount still resolves it, and nothing
 * rewrites those values. New files only — so there is no data migration and no
 * window in which a stored path points at nothing.
 *
 * The tenant comes from the request-scoped context that `protect` populates
 * from the verified membership, never from anything the client sends.
 */
import fs from 'fs';
import path from 'path';

import { getTenantId } from './tenantContext';

/** Root of the served upload tree, relative to the process working directory. */
export const UPLOAD_ROOT = 'uploads';

/** Subdirectory that holds the per-workspace trees. */
export const TENANT_SEGMENT = 't';

/**
 * A tenant id is a uuid we generated, so this should never reject anything
 * real. It is here because the value becomes a PATH SEGMENT: if this function
 * is ever reached with a value from somewhere less trustworthy than the ALS
 * context, `../` in it would escape the upload root. Refusing the id costs one
 * upload; accepting it costs the filesystem.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * The directory for `category` in the current workspace, created if missing.
 *
 * Falls back to the un-namespaced `uploads/<category>` when there is no tenant
 * in context. That happens for genuinely tenant-less uploads and would
 * otherwise throw inside multer's destination callback, where an exception
 * surfaces as an opaque 500 rather than a useful message. A file in the shared
 * tree is exactly where files went before this change, so the fallback is the
 * old behaviour rather than a new failure mode.
 */
export function uploadDirFor(category?: string): string {
  const tenantId = getTenantId();
  const parts = [UPLOAD_ROOT];

  if (tenantId && SAFE_ID.test(tenantId)) {
    parts.push(TENANT_SEGMENT, tenantId);
  }
  if (category) parts.push(category);

  const dir = path.join(...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A multer `destination` callback for `category`.
 *
 * Resolved per request, not once at module load: the directory depends on who
 * is uploading, so computing it at startup — which is what every one of these
 * middlewares used to do — would pin every workspace to one folder.
 */
export function destinationFor(category?: string) {
  return function destination(
    _req: unknown,
    _file: unknown,
    cb: (error: Error | null, destination: string) => void,
  ): void {
    try {
      cb(null, uploadDirFor(category));
    } catch (err) {
      cb(err instanceof Error ? err : new Error(String(err)), '');
    }
  };
}

// CommonJS interop: all four multer middlewares are plain CJS.
module.exports = { UPLOAD_ROOT, TENANT_SEGMENT, uploadDirFor, destinationFor };
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
module.exports.TENANT_SEGMENT = TENANT_SEGMENT;
module.exports.uploadDirFor = uploadDirFor;
module.exports.destinationFor = destinationFor;
