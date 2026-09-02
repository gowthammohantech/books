import multer from 'multer';

import { persistUploads } from './persistUploads';

// Held in memory until persistUploads writes it to the `products/` prefix in
// blob storage. Nothing lands on this container's filesystem.
const storage = multer.memoryStorage();

// File filter remains the same
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and WEBP are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Use .any() so product_image, gallery_images, and dynamic customField_<id>
// file uploads all pass through to the controller.
export const uploadProductFields = [upload.any(), persistUploads('products')];
