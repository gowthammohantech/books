/**
 * Where an uploaded file goes: Azure Blob Storage.
 *
 * Files used to be written to the container's own filesystem and served back by
 * `express.static('uploads')`. That survived docker compose, where a named
 * volume outlives the container, and nothing else. The deployment target is
 * Azure App Service, whose disk is ephemeral and per-instance: every redeploy
 * dropped every uploaded file, and a second instance could not see the first
 * one's uploads. It was also served unauthenticated, so a guessable filename
 * was readable by anyone, across workspaces.
 *
 * Both problems have the same fix. Files now live in a PRIVATE blob container
 * and reach the browser only as read-only SAS URLs minted per response, valid
 * for AZURE_STORAGE_SAS_TTL_MINUTES. Nothing is ever served by this API, and a
 * URL that leaks stops working within the hour rather than never.
 *
 * WHAT IS STORED IN THE DATABASE IS THE BLOB KEY -- `t/<tenantId>/company/1-2.png`
 * -- never a URL. A signed URL embeds an expiry, so persisting one would persist
 * something that stops being true; `signedUrlFor` is called at response time, at
 * the edge of the controller, and the result is thrown away with the response.
 *
 * Keys keep the per-workspace prefix the filesystem layout had. The blob
 * container is flat -- `/` in a key is a naming convention, not a directory --
 * but the prefix is still what makes a request for another workspace's file
 * refusable in one comparison, and what keeps two companies' documents from
 * colliding on a name.
 *
 * The tenant comes from the request-scoped context that `protect` populates
 * from the verified membership, never from anything the client sends.
 */
import path from 'path';

import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';

import { getTenantId } from './tenantContext';

/** Subdirectory-style prefix that holds the per-workspace keys. */
export const TENANT_SEGMENT = 't';

/**
 * A tenant id is a uuid we generated, so this should never reject anything
 * real. It is here because the value becomes a KEY SEGMENT: if this function is
 * ever reached with a value from somewhere less trustworthy than the ALS
 * context, `../` in it would address a blob outside this workspace's prefix.
 * Refusing the id costs one upload; accepting it costs the isolation.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Container that holds every uploaded file. One per deployment, not per tenant. */
export const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || 'uploads';

/**
 * How long a minted URL stays valid. Short enough that a leaked URL expires on
 * its own, long enough that a page open in a tab keeps rendering its images.
 */
function ttlMinutes(): number {
  const raw = process.env.AZURE_STORAGE_SAS_TTL_MINUTES;
  if (!raw) return 60;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/**
 * The blob endpoint the BROWSER can reach, when that differs from the one this
 * process uses.
 *
 * Under compose the API talks to Azurite at `http://azurite:10000/...`, a name
 * that only resolves inside the docker network; the browser has to use
 * `http://localhost:10000/...`. A SAS is signed over the canonicalized resource
 * (`/blob/<account>/<container>/<blob>`), NOT over the host, so re-pointing the
 * origin leaves the signature valid. Unset in Azure, where the endpoint this
 * process uses is already the public one.
 */
function publicEndpoint(): string | null {
  const raw = (process.env.AZURE_STORAGE_PUBLIC_ENDPOINT || '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

function connectionString(): string {
  const raw = (process.env.AZURE_STORAGE_CONNECTION_STRING || '').trim();
  if (!raw) {
    // Unlike the optional AI providers there is no degraded mode here: without
    // storage no upload in the product can succeed, so fail where the cause is
    // still visible rather than on the first user's file.
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING is not set. The API stores all uploads in ' +
        'Azure Blob Storage (Azurite locally) and cannot start without it.',
    );
  }
  return raw;
}

let cachedService: BlobServiceClient | null = null;

/**
 * Built lazily rather than at module load so that importing this module — which
 * the test suite and every controller do — does not require the environment to
 * be configured. The first real call is where a missing setting should surface.
 */
function service(): BlobServiceClient {
  if (!cachedService) {
    cachedService = BlobServiceClient.fromConnectionString(connectionString());
  }
  return cachedService;
}

function container() {
  return service().getContainerClient(CONTAINER_NAME);
}

/**
 * The account key, for signing SAS tokens.
 *
 * `fromConnectionString` leaves a `StorageSharedKeyCredential` on the client
 * whenever the connection string carries an AccountKey, which both a real
 * account's string and Azurite's well-known dev string do. Anything else (a
 * SAS-only or token-credential string) cannot sign, and would otherwise fail
 * later with a confusing type error.
 */
function signingCredential(): StorageSharedKeyCredential {
  const cred = service().credential;
  if (!(cred instanceof StorageSharedKeyCredential)) {
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING has no AccountKey, so read URLs cannot be ' +
        'signed. Use a connection string that includes AccountKey=.',
    );
  }
  return cred;
}

/**
 * The key for a new upload of `originalName` in the current workspace.
 *
 * Resolved per request, not once at module load: the answer depends on who is
 * uploading. Falls back to an un-prefixed `<category>/<name>` when there is no
 * tenant in context — that happens for genuinely tenant-less uploads (the
 * first-run setup logo, before a workspace exists) and is exactly where those
 * files went before, so it is the old behaviour rather than a new failure mode.
 */
export function blobKeyFor(category: string | undefined, originalName: string): string {
  const tenantId = getTenantId();
  const parts: string[] = [];

  if (tenantId && SAFE_ID.test(tenantId)) {
    parts.push(TENANT_SEGMENT, tenantId);
  }
  if (category) parts.push(category);

  const ext = path.extname(originalName || '');
  parts.push(`${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);

  return parts.join('/');
}

/**
 * Create the container if it is missing, without public access.
 *
 * Called once from boot. Azurite does not create containers implicitly, so
 * without this the very first upload of a fresh dev stack fails with a 404 that
 * reads like a bug in the upload code.
 */
export async function ensureContainer(): Promise<void> {
  await container().createIfNotExists();
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await container()
    .getBlockBlobClient(key)
    .uploadData(body, { blobHTTPHeaders: { blobContentType: contentType } });
}

/**
 * Remove a blob, tolerating one that is already gone.
 *
 * Callers are replacing or discarding a record and pass whatever the column
 * held, which may be empty, or a legacy filesystem path from before this
 * module, or a key whose blob was already deleted. None of those should turn a
 * successful update into a failed request, so this never throws.
 */
export async function deleteObject(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await container().getBlockBlobClient(key).deleteIfExists();
  } catch (err) {
    console.error('blobStorage.deleteObject failed for', key, err);
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  return container().getBlockBlobClient(key).downloadToBuffer();
}

/**
 * A read-only URL for `key`, valid for the configured TTL.
 *
 * Returns null for an absent key so it drops straight into the `value ? url :
 * null` shape the controllers already have. The overload keeps a call inside an
 * already-narrowed branch (`x ? signedUrlFor(x) : ''`) typed as a plain string,
 * so those call sites do not have to grow a null check they cannot reach.
 * Synchronous on purpose:
 * `generateBlobSASQueryParameters` signs locally with the account key and talks
 * to nobody, which is what lets response decorators stay ordinary `.map`s
 * instead of becoming async throughout.
 */
export function signedUrlFor(key: string): string;
export function signedUrlFor(key: string | null | undefined): string | null;
export function signedUrlFor(key: string | null | undefined): string | null {
  if (!key) return null;

  const now = Date.now();
  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: key,
      permissions: BlobSASPermissions.parse('r'),
      // A few minutes of backdating so a small clock difference between this
      // process and the storage service does not reject a fresh URL.
      startsOn: new Date(now - 5 * 60 * 1000),
      expiresOn: new Date(now + ttlMinutes() * 60 * 1000),
    },
    signingCredential(),
  ).toString();

  const origin = publicEndpoint() ?? service().url.replace(/\/+$/, '');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  return `${origin}/${CONTAINER_NAME}/${encodedKey}?${sas}`;
}
