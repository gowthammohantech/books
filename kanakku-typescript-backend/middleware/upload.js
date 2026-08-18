const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Save to 'uploads/' folder
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // unique name
  }
});

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

// Reject anything that is not an allowed type BEFORE it is written to disk, so a
// wrong file type surfaces as a clean 400 (via middleware/uploadError.js) instead
// of a saved junk file that later 404s or renders broken. The "Invalid file type"
// prefix is what the global upload-error handler matches to return 400.
function fileFilter(req, file, cb) {
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
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — surfaces as 400 "File too large."
});

module.exports = upload;
