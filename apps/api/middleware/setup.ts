import multer from 'multer';

import { persistUploads } from './persistUploads';

// The company logo uploaded during /setup, so it is the FIRST file a new
// workspace writes -- and it is written before the workspace exists, so
// blobKeyFor's no-tenant fallback puts it under a bare `company/` prefix.
const upload = multer({ storage: multer.memoryStorage() });

/** Parse the setup logo field, then persist it to blob storage. */
export const uploadSetupSingle = (field: string) => [
  upload.single(field),
  persistUploads('company'),
];

export default upload;
