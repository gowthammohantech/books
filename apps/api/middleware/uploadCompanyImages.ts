import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { persistUploads } from './persistUploads';

// Held in memory until persistUploads writes it to the `company/` prefix in
// blob storage. Nothing lands on this container's filesystem.
const companyStorage = multer.memoryStorage();

const companyFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type for ${file.fieldname}. Only JPG, PNG, WEBP, and ICO (for favicon) are allowed.`,
      ),
    );
  }
};

const uploadCompany = multer({
  storage: companyStorage,
  fileFilter: companyFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Handle multiple company image fields
export const uploadCompanyFields = [
  uploadCompany.fields([
    { name: 'siteLogo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'companyLogo', maxCount: 1 },
    { name: 'companyBanner', maxCount: 1 },
  ]),
  persistUploads('company'),
];

/**
 * Per-route upload error handler, kept for the routes that wire it explicitly.
 * The app-wide handler in middleware/uploadError.ts covers everything else.
 */
export const handleUploadError = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.',
      });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({
        success: false,
        message: 'Too many files uploaded.',
      });
      return;
    }
    res.status(400).json({
      success: false,
      message: 'File upload error: ' + err.message,
    });
    return;
  }

  // The JS original did `err.message.includes(...)` unguarded, which threw a
  // TypeError for any error without a message. Guarded here.
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.includes('Invalid file type')) {
    res.status(400).json({ success: false, message });
    return;
  }

  next(err);
};
