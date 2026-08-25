const multer = require('multer');
const path = require('path');

// Configure storage
const uploadDir = path.join(__dirname, '../uploads/company');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir); // Save to 'uploads/' folder
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // unique name
    }
});

const upload = multer({ storage });

module.exports = upload;
