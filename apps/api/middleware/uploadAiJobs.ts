/**
 * Multer middleware for AI extraction job uploads (Cluster H, slice H.2).
 *
 * Accepts PDF / JPG / PNG / WEBP bills up to 10MB, stored under the
 * `t/<tenantId>/ai-jobs/` prefix in blob storage. The controller hands the
 * in-memory buffer straight to the configured `AiProvider`; the stored copy is
 * kept so the user can re-view the bill from the extraction history page.
 *
 * These are the SOURCE DOCUMENTS a company feeds to extraction - supplier
 * invoices and bills - so they are the last thing that should share a prefix
 * with another company's.
 */
import multer from 'multer';

import { persistUploads } from './persistUploads';

const aiJobStorage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const aiJobFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG, PNG, and WEBP are allowed.'));
  }
};

const uploadAiJobs = multer({
  storage: aiJobStorage,
  fileFilter: aiJobFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

/** Parse the bill field, then persist it to blob storage. */
export const uploadAiJobSingle = (field: string) => [
  uploadAiJobs.single(field),
  persistUploads('ai-jobs'),
];

export default uploadAiJobs;
