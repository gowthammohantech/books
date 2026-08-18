// routes/exportRoutes.ts
// "Own your data" — machine-readable CSV exports per module + a one-click
// full-tenant backup zip. Mounted under /api/admin via routes/adminRoutes.js
// (same pattern as routes/timeTrackingRoutes.ts).
//
// Every handler is tenant-scoped inside the controller (requireUserId =
// ownerId ?? id), so a caller can only ever pull their own tenant's rows.

import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import {
  exportJournalEntries,
  exportChartOfAccounts,
  exportInvoices,
  exportInvoiceItems,
  exportProducts,
  exportBankTransactions,
  exportCustomers,
  exportTrialBalance,
  exportBalanceSheet,
  exportProfitAndLoss,
  exportArAging,
  exportApAging,
  exportBackupZip,
} from '../controllers/exportController';

/**
 * Strictest sensible gate for the full-tenant backup: the caller must hold
 * settings,view AND be the workspace Owner. A backup dumps every tenant table,
 * so we don't let a non-owner staff member with settings access exfiltrate it.
 */
function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.actor?.isOwner) {
    next();
    return;
  }
  res.status(403).json({ success: false, message: 'Owner access required' });
}

const router = Router();

// All export routes require authentication.
router.use(protect);

// ---- General Ledger ----
router.get('/export/journal-entries.csv', requirePermission('journal-entries', 'view'), exportJournalEntries);
router.get('/export/chart-of-accounts.csv', requirePermission('chart-of-accounts', 'view'), exportChartOfAccounts);

// ---- Sales ----
router.get('/export/invoices.csv', requirePermission('invoices', 'view'), exportInvoices);
router.get('/export/invoice-items.csv', requirePermission('invoices', 'view'), exportInvoiceItems);
router.get('/export/customers.csv', requirePermission('customers', 'view'), exportCustomers);

// ---- Catalogue / Banking ----
router.get('/export/products.csv', requirePermission('product-services', 'view'), exportProducts);
router.get('/export/bank-transactions.csv', requirePermission('banking', 'view'), exportBankTransactions);

// ---- Accounting reports ----
router.get('/export/trial-balance.csv', requirePermission('accounting-reports', 'view'), exportTrialBalance);
router.get('/export/balance-sheet.csv', requirePermission('accounting-reports', 'view'), exportBalanceSheet);
router.get('/export/profit-and-loss.csv', requirePermission('accounting-reports', 'view'), exportProfitAndLoss);
router.get('/export/ar-aging.csv', requirePermission('accounting-reports', 'view'), exportArAging);
router.get('/export/ap-aging.csv', requirePermission('accounting-reports', 'view'), exportApAging);

// ---- Full-tenant backup (owner-only) ----
router.get('/export/backup.zip', requirePermission('settings', 'view'), requireOwner, exportBackupZip);

export default router;
// CommonJS export so `require('./routes/exportRoutes')` under ts-node returns
// the router directly (matches timeTrackingRoutes.ts / dimensionRoutes.ts).
module.exports = router;
