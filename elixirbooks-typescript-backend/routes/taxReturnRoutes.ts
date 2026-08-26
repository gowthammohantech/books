// routes/taxReturnRoutes.ts
//
// Country tax-return SUMMARY endpoints (Task 2): UK VAT 9-box, AU BAS (GST
// portion), NZ GST. Mounted under /api/admin via routes/adminRoutes.js (same
// pattern as exportRoutes.ts / timeTrackingRoutes.ts).
//
// Every route is gated by protect + requirePermission('accounting-reports',
// 'view') and is tenant-scoped inside the controller (requireUserId =
// ownerId ?? id). Each return has a JSON endpoint plus a `.csv` variant; the
// JSON endpoint also accepts `?format=csv` to stream the same CSV.

import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import {
  ukVatReturn,
  auBasReturn,
  nzGstReturn,
  euVatReturn,
  euEcSalesList,
  euOssReturn,
  euOssThreshold,
} from '../controllers/taxReturnController';

const router = Router();

// All tax-return routes require authentication.
router.use(protect);

const view = requirePermission('accounting-reports', 'view');

// ---- UK VAT (9-box) ----
router.get('/tax-returns/uk-vat', view, ukVatReturn);
router.get('/tax-returns/uk-vat.csv', view, ukVatReturn);

// ---- AU BAS (GST portion) ----
router.get('/tax-returns/au-bas', view, auBasReturn);
router.get('/tax-returns/au-bas.csv', view, auBasReturn);

// ---- NZ GST ----
router.get('/tax-returns/nz-gst', view, nzGstReturn);
router.get('/tax-returns/nz-gst.csv', view, nzGstReturn);

// ---- EU VAT summary ----
router.get('/tax-returns/eu-vat', view, euVatReturn);
router.get('/tax-returns/eu-vat.csv', view, euVatReturn);

// ---- EU EC Sales List (reverse-charge cross-border B2B sales) ----
router.get('/tax-returns/eu-ec-sales-list', view, euEcSalesList);
router.get('/tax-returns/eu-ec-sales-list.csv', view, euEcSalesList);

// ---- EU OSS return (B2C cross-border sales, VAT due per destination country) ----
// NOTE: register the /threshold sub-path BEFORE the .csv/base routes so it is not
// shadowed; Express matches in declaration order.
router.get('/tax-returns/eu-oss/threshold', view, euOssThreshold);
router.get('/tax-returns/eu-oss', view, euOssReturn);
router.get('/tax-returns/eu-oss.csv', view, euOssReturn);

export default router;
// CommonJS export so `require('./routes/taxReturnRoutes')` under ts-node returns
// the router directly (matches exportRoutes.ts / timeTrackingRoutes.ts).
module.exports = router;
