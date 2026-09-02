/**
 * Moves what multer parsed into blob storage, before any controller sees it.
 *
 * Multer now uses memory storage everywhere: it hands us a Buffer and writes
 * nothing. This middleware is the step that makes the upload durable, and it
 * runs between multer and the controller so that by the time a controller reads
 * `req.file`, the bytes are already in the container and the file object names
 * where they landed.
 *
 * THE BLOB KEY IS STAMPED ONTO `file.path`. That is the property the ~25
 * controllers and `lib/customFieldValues` already read to find out where a file
 * went, so keeping the key there is what lets this migration change the storage
 * backend without rewriting every call site's shape.
 *
 * Failures propagate through `next(err)` to the global handlers rather than
 * being swallowed: a controller that ran on a file which never uploaded would
 * write a row pointing at a blob that does not exist, which is worse than a 500.
 */
import type { NextFunction, Request, Response } from 'express';

import { blobKeyFor, putObject } from '../lib/blobStorage';

/**
 * Multer puts the files in one of three shapes depending on whether the route
 * used `.single()`, `.array()`/`.any()`, or `.fields()`. Flattening here keeps
 * that detail out of the upload logic.
 */
function collectFiles(req: Request): Express.Multer.File[] {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') {
    return Object.values(req.files as Record<string, Express.Multer.File[]>).flat();
  }
  return [];
}

/**
 * Upload everything multer parsed into `category`, stamping each file's key.
 *
 * The category is bound where the middleware is composed rather than passed per
 * route, so the route table does not have to repeat it for all ~30 upload
 * endpoints.
 */
export function persistUploads(category?: string) {
  return async function persist(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const files = collectFiles(req);
      // Sequential rather than Promise.all: an upload form carries a handful of
      // files at most, and a failure part-way is easier to reason about when
      // the remaining uploads have not also been started.
      for (const file of files) {
        const key = blobKeyFor(category, file.originalname);
        await putObject(key, file.buffer, file.mimetype);
        file.path = key;
        file.filename = key.slice(key.lastIndexOf('/') + 1);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
