/**
 * Multer middleware for AI extraction job uploads (Cluster H, slice H.2).
 *
 * Accepts PDF / JPG / PNG / WEBP bills up to 10MB, written to
 * `uploads/t/<tenantId>/ai-jobs/`. The file is read back into memory by the controller
 * and handed off to the configured `AiProvider`. The disk copy is kept so
 * the user can re-view the bill from the extraction history page.
 */
import path from 'path';

import multer from 'multer';

import { destinationFor } from '../lib/uploadPaths';

// Per-workspace: uploads/t/<tenantId>/ai-jobs/. These are the SOURCE DOCUMENTS
// a company feeds to extraction - supplier invoices and bills - so they are the
// last thing that should share a directory with another company's.
const aiJobStorage = multer.diskStorage({
  destination: destinationFor('ai-jobs'),
  filename: function (_req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  },
});

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

export default uploadAiJobs;

// CommonJS interop: the JS routers require() this module directly.
module.exports = uploadAiJobs;
module.exports.default = uploadAiJobs;
