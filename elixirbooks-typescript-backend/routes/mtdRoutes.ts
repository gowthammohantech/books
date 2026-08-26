// routes/mtdRoutes.ts
//
// HMRC Making Tax Digital (MTD) VAT endpoints (Task 3): connect / obligations /
// submit / liabilities. Mounted under /api/admin via routes/adminRoutes.js (same
// pattern as taxReturnRoutes.ts / exportRoutes.ts / timeTrackingRoutes.ts).
//
// Every route requires authentication (protect) and is tenant-scoped inside the
// controller (requireUserId = ownerId ?? id). All MTD routes are gated by
// requirePermission('accounting-reports','edit'); the MUTATIONS that touch BYOK
// credentials / OAuth (PUT /mtd/config and the connect endpoints) additionally
// require the Owner role.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import {
  getConfig,
  putConfig,
  getAuthUrl,
  callback,
  obligations,
  submit,
  liabilities,
} from '../controllers/mtdController';

const router = Router();

// All MTD routes require authentication.
router.use(protect);

// All MTD routes require edit on the accounting-reports module.
const edit = requirePermission('accounting-reports', 'edit');

/** Owner-only gate for the credential/connect mutations (req.actor set by protect). */
const requireOwner: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  if (req.actor?.isOwner) {
    next();
    return;
  }
  res.status(403).json({ success: false, message: 'Owner role required' });
};

// ---- Config (masked read; Owner-gated write) ----
router.get('/mtd/config', edit, getConfig);
router.put('/mtd/config', edit, requireOwner, putConfig);

// ---- OAuth connect (Owner-gated) ----
router.get('/mtd/auth-url', edit, requireOwner, getAuthUrl);
router.get('/mtd/callback', edit, requireOwner, callback);
router.post('/mtd/callback', edit, requireOwner, callback);

// ---- VAT obligations / submit / liabilities ----
router.get('/mtd/obligations', edit, obligations);
router.post('/mtd/submit', edit, submit);
router.get('/mtd/liabilities', edit, liabilities);

export default router;
// CommonJS export so `require('./routes/mtdRoutes')` under ts-node returns the
// router directly (matches taxReturnRoutes.ts / exportRoutes.ts).
module.exports = router;
