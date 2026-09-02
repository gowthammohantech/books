/**
 * The seam between multer and blob storage.
 *
 * What matters here is that EVERY file multer parsed gets written and gets its
 * key stamped onto `file.path` — that property is what ~25 controllers and
 * lib/customFieldValues read to find out where a file went, so a shape multer
 * produces but this middleware misses is an upload that silently vanishes.
 */
import type { Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPutObject } = vi.hoisted(() => ({ mockPutObject: vi.fn() }));

vi.mock('../lib/blobStorage', () => ({
  mockPutObject,
  putObject: mockPutObject,
  blobKeyFor: (category: string | undefined, name: string) =>
    `t/tenant-a/${category ? category + '/' : ''}key-for-${name}`,
}));

import { persistUploads } from './persistUploads';

function fileNamed(originalname: string, fieldname = 'f'): Express.Multer.File {
  return {
    fieldname,
    originalname,
    mimetype: 'image/png',
    buffer: Buffer.from(originalname),
    size: originalname.length,
  } as Express.Multer.File;
}

const run = async (req: Partial<Request>) => {
  const next = vi.fn();
  await persistUploads('company')(req as Request, {} as Response, next);
  return next;
};

beforeEach(() => {
  mockPutObject.mockReset();
  mockPutObject.mockResolvedValue(undefined);
});

describe('persistUploads', () => {
  it('handles .single() — req.file', async () => {
    const req = { file: fileNamed('logo.png') };
    const next = await run(req);

    expect(next).toHaveBeenCalledWith();
    expect(mockPutObject).toHaveBeenCalledWith(
      't/tenant-a/company/key-for-logo.png',
      Buffer.from('logo.png'),
      'image/png',
    );
    expect(req.file.path).toBe('t/tenant-a/company/key-for-logo.png');
    expect(req.file.filename).toBe('key-for-logo.png');
  });

  it('handles .any()/.array() — req.files as a flat array', async () => {
    const req = { files: [fileNamed('a.png'), fileNamed('b.png')] };
    await run(req);

    expect(mockPutObject).toHaveBeenCalledTimes(2);
    expect(req.files.map((f) => f.path)).toEqual([
      't/tenant-a/company/key-for-a.png',
      't/tenant-a/company/key-for-b.png',
    ]);
  });

  it('handles .fields() — req.files keyed by field name', async () => {
    const req = {
      files: {
        siteLogo: [fileNamed('site.png', 'siteLogo')],
        favicon: [fileNamed('fav.ico', 'favicon')],
      },
    };
    await run(req);

    expect(mockPutObject).toHaveBeenCalledTimes(2);
    expect(req.files.siteLogo[0].path).toBe('t/tenant-a/company/key-for-site.png');
    expect(req.files.favicon[0].path).toBe('t/tenant-a/company/key-for-fav.ico');
  });

  it('is a no-op when the request carried no file', async () => {
    const next = await run({});
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('passes an upload failure to next() instead of letting the controller run', async () => {
    // A controller that ran anyway would write a row pointing at a blob that
    // does not exist — worse than the 500 this produces.
    const boom = new Error('storage unreachable');
    mockPutObject.mockRejectedValue(boom);
    const next = await run({ file: fileNamed('logo.png') });
    expect(next).toHaveBeenCalledWith(boom);
  });
});
