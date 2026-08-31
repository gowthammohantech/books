const multer = require('multer');
const path = require('path');
const { destinationFor } = require('../lib/uploadPaths');

// Per-workspace: uploads/t/<tenantId>/company/. This is the company logo
// uploaded during /setup, so it is the FIRST file a new workspace writes.
const storage = multer.diskStorage({
    destination: destinationFor('company'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // unique name
    }
});

const upload = multer({ storage });

module.exports = upload;
