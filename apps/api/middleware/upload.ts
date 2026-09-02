import multer from 'multer';

import { persistUploads } from './persistUploads';

// Files are held in memory only until middleware/persistUploads.ts writes them
// to blob storage, which is where they actually live. Nothing this process runs
// on ever touches the local filesystem, so there is no temp file to clean up
// when validation later rejects the request.
const storage = multer.memoryStorage();

// Allowed MIME types. Most fields on the shared uploader are images (profile
// pictures, logos, signatures); a few fields carry documents (bill/expense
// attachments) that may also be PDFs.
const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const DOCUMENT_MIME = new Set([...IMAGE_MIME, 'application/pdf']);

// Fields that legitimately accept a PDF in addition to images.
const DOCUMENT_FIELDS = new Set(['attachment']);

// Reject anything that is not an allowed type BEFORE it reaches blob storage, so
// a wrong file type surfaces as a clean 400 (via middleware/uploadError.ts)
// instead of a stored junk blob that later renders broken. The "Invalid file
// type" prefix is what the global upload-error handler matches to return 400.
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowsDocuments = DOCUMENT_FIELDS.has(file.fieldname);
  const allowed = allowsDocuments ? DOCUMENT_MIME : IMAGE_MIME;
  if (allowed.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  const label = allowsDocuments
    ? 'JPG, PNG, WEBP, GIF, or PDF'
    : 'JPG, PNG, WEBP, or GIF images';
  cb(new Error(`Invalid file type for "${file.fieldname}". Only ${label} are allowed.`));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — surfaces as 400 "File too large."
});

/**
 * Parse one field, then persist it.
 *
 * Routes use these rather than `upload.single(...)` directly so that no upload
 * endpoint can exist without the blob write that follows it — pairing the two
 * here is what keeps a controller from ever seeing a file that went nowhere.
 * Express accepts an array of handlers wherever it accepts one, so these drop
 * into the route table in place of the bare multer call.
 */
export const uploadSingle = (field: string) => [upload.single(field), persistUploads()];

/** Parse whatever fields the form carried (including customField_<id>), then persist. */
export const uploadAny = () => [upload.any(), persistUploads()];

export default upload;
