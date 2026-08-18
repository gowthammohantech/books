const multer = require('multer');

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
function handleUploadError(err, req, res, next) {
  if (!err) return next();

  // Multer's own errors (size/count/unexpected field) from any multer instance.
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: 'File too large.',
      LIMIT_FILE_COUNT: 'Too many files uploaded.',
      LIMIT_UNEXPECTED_FILE: `Unexpected file field${err.field ? ` "${err.field}"` : ''}.`,
    };
    return res.status(400).json({
      success: false,
      message: messages[err.code] || `File upload error: ${err.message}`,
    });
  }

  // fileFilter rejections throw a plain Error whose message starts with
  // "Invalid file type" (see uploadProductImages / uploadCompanyImages /
  // uploadAiJobs). Guard err.message: as a global handler this also sees
  // non-upload errors, whose message may be absent.
  if (typeof err.message === 'string' && /invalid file type/i.test(err.message)) {
    return res.status(400).json({ success: false, message: err.message });
  }

  return next(err);
}

module.exports = { handleUploadError };
