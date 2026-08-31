import path from 'path';

import multer from 'multer';

import { destinationFor } from '../lib/uploadPaths';

// Per-workspace: uploads/t/<tenantId>/company/. This is the company logo
// uploaded during /setup, so it is the FIRST file a new workspace writes.
const storage = multer.diskStorage({
  destination: destinationFor('company'),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // unique name
  },
});

const upload = multer({ storage });

export default upload;

// CommonJS interop: the JS routers require() this module directly.
module.exports = upload;
module.exports.default = upload;
