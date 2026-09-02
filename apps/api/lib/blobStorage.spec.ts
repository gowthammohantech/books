/**
 * The parts of blobStorage that are pure enough to pin down without a live
 * storage account: URL signing and the endpoint rewrite.
 *
 * Azurite's development account key is a published constant, not a secret, so
 * these run against it and assert the SHAPE of what comes back rather than any
 * particular signature.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const AZURITE_CONN =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://azurite:10000/devstoreaccount1;';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.AZURE_STORAGE_CONNECTION_STRING = AZURITE_CONN;
  process.env.AZURE_STORAGE_CONTAINER = 'uploads';
  delete process.env.AZURE_STORAGE_PUBLIC_ENDPOINT;
  delete process.env.AZURE_STORAGE_SAS_TTL_MINUTES;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('signedUrlFor', () => {
  it('returns null for an absent key, so callers keep their `value ? url : null` shape', async () => {
    const { signedUrlFor } = await import('./blobStorage');
    expect(signedUrlFor(null)).toBeNull();
    expect(signedUrlFor(undefined)).toBeNull();
    expect(signedUrlFor('')).toBeNull();
  });

  it('signs a read-only URL carrying an expiry', async () => {
    const { signedUrlFor } = await import('./blobStorage');
    const url = new URL(signedUrlFor('t/tenant-a/company/1-2.png')!);
    expect(url.pathname).toBe('/devstoreaccount1/uploads/t/tenant-a/company/1-2.png');
    expect(url.searchParams.get('sp')).toBe('r'); // read, nothing else
    expect(url.searchParams.get('sig')).toBeTruthy();
    expect(url.searchParams.get('se')).toBeTruthy(); // expiry
  });

  it('honours AZURE_STORAGE_SAS_TTL_MINUTES', async () => {
    process.env.AZURE_STORAGE_SAS_TTL_MINUTES = '5';
    const { signedUrlFor } = await import('./blobStorage');
    const expiry = new URL(signedUrlFor('t/a/x.png')!).searchParams.get('se')!;
    const minutesOut = (Date.parse(expiry) - Date.now()) / 60_000;
    expect(minutesOut).toBeGreaterThan(3);
    expect(minutesOut).toBeLessThan(7);
  });

  it('rewrites the origin onto AZURE_STORAGE_PUBLIC_ENDPOINT, leaving the signature intact', async () => {
    // Under compose the API reaches Azurite at `azurite:10000`, a name only
    // resolvable inside the docker network, while the browser needs localhost.
    // The signature covers the blob resource rather than the host, so the swap
    // is safe -- and the query must survive it verbatim.
    process.env.AZURE_STORAGE_PUBLIC_ENDPOINT = 'http://localhost:10000/devstoreaccount1';
    const { signedUrlFor } = await import('./blobStorage');
    const url = new URL(signedUrlFor('t/a/x.png')!);
    expect(url.host).toBe('localhost:10000');
    expect(url.searchParams.get('sig')).toBeTruthy();
  });

  it('percent-encodes each key segment without escaping the separators', async () => {
    const { signedUrlFor } = await import('./blobStorage');
    const url = new URL(signedUrlFor('t/a/company/my logo.png')!);
    expect(url.pathname).toBe('/devstoreaccount1/uploads/t/a/company/my%20logo.png');
  });
});

describe('configuration', () => {
  it('fails loudly when no connection string is set', async () => {
    // There is no degraded mode: with no storage, no upload in the product can
    // succeed, so the cause should surface where it is still readable.
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    const { signedUrlFor } = await import('./blobStorage');
    expect(() => signedUrlFor('t/a/x.png')).toThrow(/AZURE_STORAGE_CONNECTION_STRING/);
  });

  it('refuses to sign with a connection string that carries no account key', async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING =
      'BlobEndpoint=https://acct.blob.core.windows.net;SharedAccessSignature=sv=2022-11-02&sig=x';
    const { signedUrlFor } = await import('./blobStorage');
    expect(() => signedUrlFor('t/a/x.png')).toThrow(/AccountKey/);
  });
});
