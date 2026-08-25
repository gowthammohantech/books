// controllers/dimensionReportController.ts
// P3.3 — Cost Centers / Job Costing
// CRUD for CostCenter + Project (tenant-scoped) and P&L-by-dimension reports.

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

// =============================================================================
// Shared helpers
// =============================================================================

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// =============================================================================
// CostCenter CRUD
// =============================================================================

/** GET /cost-centers */
export async function listCostCenters(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const items = await prisma.costCenter.findMany({
      where: { userId },
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: items });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listCostCenters error:', err);
    res.status(500).json({ success: false, message: 'Failed to list cost centers' });
  }
}

/** POST /cost-centers */
export async function createCostCenter(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { code, name, isActive } = req.body as { code?: string; name?: string; isActive?: boolean };

    if (!code || !name) {
      res.status(400).json({ success: false, message: 'code and name are required' });
      return;
    }

    const item = await prisma.costCenter.create({
      data: { userId, code, name, isActive: isActive ?? true },
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      res.status(409).json({ success: false, message: 'A cost center with that code already exists' });
      return;
    }
    console.error('createCostCenter error:', err);
    res.status(500).json({ success: false, message: 'Failed to create cost center' });
  }
}

/** PUT /cost-centers/:id */
export async function updateCostCenter(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.costCenter.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Cost center not found' });
      return;
    }

    const { code, name, isActive } = req.body as { code?: string; name?: string; isActive?: boolean };

    const item = await prisma.costCenter.update({
      where: { id },
      data: {
        ...(code != null && { code }),
        ...(name != null && { name }),
        ...(isActive != null && { isActive }),
      },
    });
    res.json({ success: true, data: item });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      res.status(409).json({ success: false, message: 'A cost center with that code already exists' });
      return;
    }
    console.error('updateCostCenter error:', err);
    res.status(500).json({ success: false, message: 'Failed to update cost center' });
  }
}

/** DELETE /cost-centers/:id */
export async function deleteCostCenter(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.costCenter.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Cost center not found' });
      return;
    }

    await prisma.costCenter.delete({ where: { id } });
    res.json({ success: true, message: 'Cost center deleted' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('deleteCostCenter error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete cost center' });
  }
}

// =============================================================================
// Project CRUD
// =============================================================================

/** GET /projects */
export async function listProjects(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const items = await prisma.project.findMany({
      where: { userId },
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: items });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listProjects error:', err);
    res.status(500).json({ success: false, message: 'Failed to list projects' });
  }
}

/** GET /projects/:id */
export async function getProject(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        status: true,
        billingRate: true,
        startDate: true,
        endDate: true,
        contactId: true,
      },
    });

    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    res.json({ success: true, data: project });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('getProject error:', err);
    res.status(500).json({ success: false, message: 'Failed to get project' });
  }
}

/** POST /projects */
export async function createProject(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { code, name, description, status } = req.body as { code?: string; name?: string; description?: string; status?: string };

    if (!code || !name) {
      res.status(400).json({ success: false, message: 'code and name are required' });
      return;
    }

    const item = await prisma.project.create({
      data: { userId, code, name, description: description ?? null, status: status ?? 'active' },
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      res.status(409).json({ success: false, message: 'A project with that code already exists' });
      return;
    }
    console.error('createProject error:', err);
    res.status(500).json({ success: false, message: 'Failed to create project' });
  }
}

/** PUT /projects/:id */
export async function updateProject(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.project.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const { code, name, description, status } = req.body as { code?: string; name?: string; description?: string; status?: string };

    const item = await prisma.project.update({
      where: { id },
      data: {
        ...(code != null && { code }),
        ...(name != null && { name }),
        ...(description !== undefined && { description }),
        ...(status != null && { status }),
      },
    });
    res.json({ success: true, data: item });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      res.status(409).json({ success: false, message: 'A project with that code already exists' });
      return;
    }
    console.error('updateProject error:', err);
    res.status(500).json({ success: false, message: 'Failed to update project' });
  }
}

/** DELETE /projects/:id */
export async function deleteProject(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.project.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    await prisma.project.delete({ where: { id } });
    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('deleteProject error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete project' });
  }
}

// =============================================================================
// P&L by dimension reports
// =============================================================================

/**
 * Aggregate BASE journal-line amounts for INCOME/EXPENSE accounts
 * filtered by the given dimension field, for the given date range.
 *
 * Returns: { revenue: string; expenses: string; net: string }
 */
async function pnlForDimension(
  userId: string,
  dimField: 'costCenterId' | 'projectId',
  dimId: string | undefined,
  from: Date,
  to: Date,
): Promise<{ revenue: string; expenses: string; net: string }> {
  // Load INCOME accounts with their filtered journal lines
  const accounts = await prisma.account.findMany({
    where: { userId, isDeleted: false, accountType: { in: ['INCOME', 'EXPENSE'] } },
    select: {
      accountType: true,
      journalLines: {
        where: {
          ...(dimId ? { [dimField]: dimId } : { [dimField]: null }),
          journalEntry: {
            userId,
            isDeleted: false,
            entryDate: { gte: from, lte: to },
          },
        },
        select: { baseDebit: true, baseCredit: true },
      },
    },
  });

  let revenue = new Prisma.Decimal(0);
  let expenses = new Prisma.Decimal(0);

  for (const a of accounts) {
    const sumDebit = a.journalLines.reduce((s, l) => s.plus(l.baseDebit), new Prisma.Decimal(0));
    const sumCredit = a.journalLines.reduce((s, l) => s.plus(l.baseCredit), new Prisma.Decimal(0));
    if (a.accountType === 'INCOME') {
      revenue = revenue.plus(sumCredit.minus(sumDebit));
    } else {
      expenses = expenses.plus(sumDebit.minus(sumCredit));
    }
  }

  const net = revenue.minus(expenses);
  return { revenue: revenue.toFixed(4), expenses: expenses.toFixed(4), net: net.toFixed(4) };
}

/**
 * GET /reports/pnl-by-cost-center
 * Query: from?, to?, costCenterId? (if omitted: returns per-center summary)
 */
export async function pnlByCostCenter(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const toDateRaw = parseDate(req.query.to);
    const toDate = toDateRaw ?? new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDateRaw = parseDate(req.query.from);
    const fromDate = fromDateRaw ?? new Date(toDate.getFullYear(), 0, 1);
    fromDate.setHours(0, 0, 0, 0);

    const filterCostCenterId = req.query.costCenterId as string | undefined;

    if (filterCostCenterId) {
      // Single cost center P&L
      const cc = await prisma.costCenter.findFirst({ where: { id: filterCostCenterId, userId } });
      if (!cc) {
        res.status(404).json({ success: false, message: 'Cost center not found' });
        return;
      }
      const pnl = await pnlForDimension(userId, 'costCenterId', filterCostCenterId, fromDate, toDate);
      res.json({ success: true, data: { period: { from: fromDate, to: toDate }, costCenter: { id: cc.id, code: cc.code, name: cc.name }, ...pnl } });
      return;
    }

    // All cost centers summary
    const costCenters = await prisma.costCenter.findMany({
      where: { userId },
      orderBy: { code: 'asc' },
    });

    const rows = await Promise.all(
      costCenters.map(async (cc) => {
        const pnl = await pnlForDimension(userId, 'costCenterId', cc.id, fromDate, toDate);
        return { id: cc.id, code: cc.code, name: cc.name, ...pnl };
      }),
    );

    res.json({ success: true, data: { period: { from: fromDate, to: toDate }, rows } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('pnlByCostCenter error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute P&L by cost center' });
  }
}

/**
 * GET /reports/pnl-by-project
 * Query: from?, to?, projectId? (if omitted: returns per-project summary)
 */
export async function pnlByProject(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const toDateRaw = parseDate(req.query.to);
    const toDate = toDateRaw ?? new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDateRaw = parseDate(req.query.from);
    const fromDate = fromDateRaw ?? new Date(toDate.getFullYear(), 0, 1);
    fromDate.setHours(0, 0, 0, 0);

    const filterProjectId = req.query.projectId as string | undefined;

    if (filterProjectId) {
      // Single project P&L
      const project = await prisma.project.findFirst({ where: { id: filterProjectId, userId } });
      if (!project) {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }
      const pnl = await pnlForDimension(userId, 'projectId', filterProjectId, fromDate, toDate);
      res.json({ success: true, data: { period: { from: fromDate, to: toDate }, project: { id: project.id, code: project.code, name: project.name, status: project.status }, ...pnl } });
      return;
    }

    // All projects summary
    const projects = await prisma.project.findMany({
      where: { userId },
      orderBy: { code: 'asc' },
    });

    const rows = await Promise.all(
      projects.map(async (project) => {
        const pnl = await pnlForDimension(userId, 'projectId', project.id, fromDate, toDate);
        return { id: project.id, code: project.code, name: project.name, status: project.status, ...pnl };
      }),
    );

    res.json({ success: true, data: { period: { from: fromDate, to: toDate }, rows } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('pnlByProject error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute P&L by project' });
  }
}
