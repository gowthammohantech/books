/**
 * Multer middleware for AI extraction job uploads (Cluster H, slice H.2).
 *
 * Accepts PDF / JPG / PNG / WEBP bills up to 10MB, written to
 * `uploads/ai-jobs/`. The file is read back into memory by the controller
 * and handed off to the configured `AiProvider`. The disk copy is kept so
 * the user can re-view the bill from the extraction history page.
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads/ai-jobs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const aiJobStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
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

const aiJobFileFilter = (req, file, cb) => {
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

module.exports = uploadAiJobs;
module.exports.default = uploadAiJobs;
