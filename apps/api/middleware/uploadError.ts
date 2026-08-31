import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

/**
 * Global upload error handler.
 *
 * Registered app-wide (after all routes, before the Prisma error handler) so
 * that ANY route using a multer upload middleware returns a clean 400 for client
 * mistakes — a rejected file type or a multer limit breach — instead of falling
 * through to the generic 500 in the global error handler.
 *
 * Historically only a couple of upload routes wired their own per-route handler;
 * the rest surfaced wrong-file-type uploads as 500s. This catches them all in
 * one place. Any error that is not upload-related is passed through unchanged.
 */
export function handleUploadError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!err) {
    next();
    return;
  }

  // Multer's own errors (size/count/unexpected field) from any multer instance.
  if (err instanceof multer.MulterError) {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: 'File too large.',
      LIMIT_FILE_COUNT: 'Too many files uploaded.',
      LIMIT_UNEXPECTED_FILE: `Unexpected file field${err.field ? ` "${err.field}"` : ''}.`,
    };
    res.status(400).json({
      success: false,
      message: messages[err.code] || `File upload error: ${err.message}`,
    });
    return;
  }

  // fileFilter rejections throw a plain Error whose message starts with
  // "Invalid file type" (see uploadProductImages / uploadCompanyImages /
  // uploadAiJobs). Guard err.message: as a global handler this also sees
  // non-upload errors, whose message may be absent.
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string' && /invalid file type/i.test(message)) {
    res.status(400).json({ success: false, message });
    return;
  }

  next(err);
}

// CommonJS interop: server.js and the JS routers require() this module.
module.exports = { handleUploadError };
module.exports.handleUploadError = handleUploadError;
