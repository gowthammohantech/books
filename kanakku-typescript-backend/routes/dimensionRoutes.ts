// routes/dimensionRoutes.ts
// P3.3 — Cost Centers / Job Costing routes

import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import {
  listCostCenters,
  createCostCenter,
  updateCostCenter,
  deleteCostCenter,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  pnlByCostCenter,
  pnlByProject,
} from '../controllers/dimensionReportController';

const router = Router();

// All routes require authentication
router.use(protect);

// ---- Cost Centers ----
router.get('/cost-centers', requirePermission('accounting', 'view'), listCostCenters);
router.post('/cost-centers', requirePermission('accounting', 'create'), createCostCenter);
router.put('/cost-centers/:id', requirePermission('accounting', 'edit'), updateCostCenter);
router.delete('/cost-centers/:id', requirePermission('accounting', 'delete'), deleteCostCenter);

// ---- Projects ----
router.get('/projects', requirePermission('accounting', 'view'), listProjects);
router.get('/projects/:id', requirePermission('accounting', 'view'), getProject);
router.post('/projects', requirePermission('accounting', 'create'), createProject);
router.put('/projects/:id', requirePermission('accounting', 'edit'), updateProject);
router.delete('/projects/:id', requirePermission('accounting', 'delete'), deleteProject);

// ---- P&L reports ----
router.get('/reports/pnl-by-cost-center', requirePermission('accounting-reports', 'view'), pnlByCostCenter);
router.get('/reports/pnl-by-project', requirePermission('accounting-reports', 'view'), pnlByProject);

export default router;
// CommonJS export so `require('./routes/dimensionRoutes')` under ts-node returns
// the router directly (matches authRoutes.ts / publicRoutes.ts). Without this,
// require() yields `{ default: router }` and `app.use(...)` throws
// "argument handler must be a function" — crashing the whole API on boot.
module.exports = router;
