// controllers/dimensionReportController.ts
// P3.3 — Cost Centers / Job Costing
// CRUD for CostCenter + Project (tenant-scoped) and P&L-by-dimension reports.

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireTenantId, UnauthorizedError } from '../lib/tenantScope';
import {
  pivotPnlByDimension,
  rollUpToParents,
  type DimGroupRow,
} from '../lib/reports/pnlByDimension';

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
//
// Surfaced in the UI as "Profit Center". The model, columns and routes keep the
// CostCenter name so existing P3.3 data, already-tagged documents and the
// shipped P&L-by-dimension report keep working untouched.
// =============================================================================

const COST_CENTER_TYPES = ['PROFIT', 'COST', 'BOTH'] as const;
type CostCenterTypeValue = (typeof COST_CENTER_TYPES)[number];

/** Prefix must start alphanumeric and end in a NON-digit. `SAL-` + `000001`
 *  round-trips; `SAL1` + `000001` would parse back as 1000001 through the
 *  trailing-digits regex every numbering helper here uses. */
const NUMBER_PREFIX_RE = /^[A-Z0-9][A-Z0-9._/-]*[^0-9]$/;

interface CostCenterBody {
  code?: string;
  name?: string;
  description?: string | null;
  type?: string;
  isActive?: boolean;
  parentId?: string | null;
  numberPrefix?: string | null;
  nextNumber?: number | string;
}

/** '' -> null, so clearing a form field releases the unique (tenantId, numberPrefix)
 *  slot instead of colliding with every other blank one. */
function normaliseOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** undefined = not supplied, null = supplied but invalid. */
function parseType(value: unknown): CostCenterTypeValue | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const upper = String(value).trim().toUpperCase();
  return (COST_CENTER_TYPES as readonly string[]).includes(upper)
    ? (upper as CostCenterTypeValue)
    : null;
}

/** Reject a parent that is missing, another tenant's, deleted, the centre
 *  itself, or one of its own descendants — any of which makes the roll-up
 *  hierarchy cyclic and would hang the report that walks it. */
async function validateParent(
  tenantId: string,
  parentId: string,
  selfId?: string,
): Promise<string | null> {
  if (selfId && parentId === selfId) return 'A profit center cannot be its own parent';

  const parent = await prisma.costCenter.findFirst({
    where: { id: parentId, tenantId, isDeleted: false },
    select: { id: true },
  });
  if (!parent) return 'Parent profit center not found';

  if (selfId) {
    // Walk up from the proposed parent; reaching selfId means this would cycle.
    const seen = new Set<string>([parentId]);
    let cursor: string | null = parentId;
    while (cursor) {
      const row: { parentId: string | null } | null = await prisma.costCenter.findFirst({
        where: { id: cursor, tenantId },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
      if (!cursor) break;
      if (cursor === selfId) return 'That parent would create a circular hierarchy';
      if (seen.has(cursor)) break; // pre-existing cycle in data — stop rather than spin
      seen.add(cursor);
    }
  }
  return null;
}

function costCenterConflictMessage(err: Prisma.PrismaClientKnownRequestError): string {
  const raw = err.meta?.target;
  const target = Array.isArray(raw) ? (raw as string[]).join(',') : String(raw ?? '');
  return target.includes('numberPrefix')
    ? 'Another profit center already uses that document prefix'
    : 'A profit center with that code already exists';
}

/** Shared field validation for create + update. Returns an error message or null. */
function validateNumbering(
  numberPrefix: string | null | undefined,
  nextNumber: number | undefined,
): string | null {
  if (numberPrefix && !NUMBER_PREFIX_RE.test(numberPrefix)) {
    return 'Document prefix may use A-Z, 0-9, dot, dash, slash or underscore, and must not end in a digit (e.g. SAL-)';
  }
  if (nextNumber !== undefined && (!Number.isInteger(nextNumber) || nextNumber < 1)) {
    return 'nextNumber must be a whole number of 1 or more';
  }
  return null;
}

/**
 * GET /cost-centers
 *
 * Query: `search`, `page`, `limit`, `includeInactive=true`,
 *        `type=PROFIT|COST|BOTH`, `all=1`.
 *
 * `all=1` returns every match unpaginated — the pickers on the document forms
 * need the full list to resolve a saved id to a label, and silently paginating
 * that would make older centres look deleted.
 */
export async function listCostCenters(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);

    const includeInactive = String(req.query.includeInactive ?? '') === 'true';
    const returnAll = String(req.query.all ?? '') === '1' || String(req.query.all ?? '') === 'true';
    const typeFilter = parseType(req.query.type);
    if (typeFilter === null) {
      res.status(400).json({
        success: false,
        message: `type must be one of ${COST_CENTER_TYPES.join(', ')}`,
      });
      return;
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where: Prisma.CostCenterWhereInput = {
      tenantId,
      isDeleted: false,
      ...(includeInactive ? {} : { isActive: true }),
      // A PROFIT or COST filter must still return BOTH centres — they play either role.
      ...(typeFilter ? { type: { in: [typeFilter, 'BOTH'] } } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const include = { parent: { select: { id: true, code: true, name: true } } };

    if (returnAll) {
      const items = await prisma.costCenter.findMany({ where, include, orderBy: { code: 'asc' } });
      res.json({ success: true, data: items });
      return;
    }

    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 10) || 10));

    const [total, items] = await Promise.all([
      prisma.costCenter.count({ where }),
      prisma.costCenter.findMany({
        where,
        include,
        orderBy: { code: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // `pagination` sits at the top level because that is where the existing
    // Profit Centers page already looks for it.
    res.json({
      success: true,
      data: items,
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listCostCenters error:', err);
    res.status(500).json({ success: false, message: 'Failed to list profit centers' });
  }
}

/** POST /cost-centers */
export async function createCostCenter(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const body = req.body as CostCenterBody;

    const code = normaliseOptionalText(body.code);
    const name = normaliseOptionalText(body.name);
    if (!code || !name) {
      res.status(400).json({ success: false, message: 'code and name are required' });
      return;
    }

    const type = parseType(body.type);
    if (type === null) {
      res.status(400).json({
        success: false,
        message: `type must be one of ${COST_CENTER_TYPES.join(', ')}`,
      });
      return;
    }

    const parentId = normaliseOptionalText(body.parentId);
    if (parentId) {
      const parentError = await validateParent(tenantId, parentId);
      if (parentError) {
        res.status(400).json({ success: false, message: parentError });
        return;
      }
    }

    const numberPrefix = normaliseOptionalText(body.numberPrefix);
    const nextNumber = body.nextNumber === undefined ? undefined : Number(body.nextNumber);
    const numberingError = validateNumbering(numberPrefix, nextNumber);
    if (numberingError) {
      res.status(400).json({ success: false, message: numberingError });
      return;
    }

    const item = await prisma.costCenter.create({
      data: {
        tenantId,
        code,
        name,
        description: normaliseOptionalText(body.description) ?? null,
        type: type ?? 'BOTH',
        isActive: body.isActive ?? true,
        parentId: parentId ?? null,
        numberPrefix: numberPrefix ?? null,
        ...(nextNumber !== undefined ? { nextNumber } : {}),
      },
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ success: false, message: costCenterConflictMessage(err) });
      return;
    }
    console.error('createCostCenter error:', err);
    res.status(500).json({ success: false, message: 'Failed to create profit center' });
  }
}

/** PUT /cost-centers/:id */
export async function updateCostCenter(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const id = String(req.params.id);

    const existing = await prisma.costCenter.findFirst({ where: { id, tenantId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Profit center not found' });
      return;
    }

    const body = req.body as CostCenterBody;

    const code = normaliseOptionalText(body.code);
    const name = normaliseOptionalText(body.name);
    if (body.code !== undefined && !code) {
      res.status(400).json({ success: false, message: 'code cannot be blank' });
      return;
    }
    if (body.name !== undefined && !name) {
      res.status(400).json({ success: false, message: 'name cannot be blank' });
      return;
    }

    const type = parseType(body.type);
    if (type === null) {
      res.status(400).json({
        success: false,
        message: `type must be one of ${COST_CENTER_TYPES.join(', ')}`,
      });
      return;
    }

    const parentId = normaliseOptionalText(body.parentId);
    if (parentId) {
      const parentError = await validateParent(tenantId, parentId, id);
      if (parentError) {
        res.status(400).json({ success: false, message: parentError });
        return;
      }
    }

    const numberPrefix = normaliseOptionalText(body.numberPrefix);
    const nextNumber = body.nextNumber === undefined ? undefined : Number(body.nextNumber);
    const numberingError = validateNumbering(numberPrefix, nextNumber);
    if (numberingError) {
      res.status(400).json({ success: false, message: numberingError });
      return;
    }
    // Rewinding the counter would re-issue numbers that are already on issued
    // documents, and every document-number column is globally unique.
    if (nextNumber !== undefined && nextNumber < existing.nextNumber) {
      res.status(400).json({
        success: false,
        message: `nextNumber cannot go backwards (current value is ${existing.nextNumber})`,
      });
      return;
    }

    // Unchecked variant: parentId is written as a scalar FK, not a nested relation.
    const data: Prisma.CostCenterUncheckedUpdateInput = {
      ...(code != null && { code }),
      ...(name != null && { name }),
      ...(body.description !== undefined && {
        description: normaliseOptionalText(body.description) ?? null,
      }),
      ...(type !== undefined && { type }),
      ...(body.isActive != null && { isActive: body.isActive }),
      ...(body.parentId !== undefined && { parentId: parentId ?? null }),
      ...(body.numberPrefix !== undefined && { numberPrefix: numberPrefix ?? null }),
      ...(nextNumber !== undefined && { nextNumber }),
    };

    const item = await prisma.costCenter.update({ where: { id }, data });
    res.json({ success: true, data: item });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ success: false, message: costCenterConflictMessage(err) });
      return;
    }
    console.error('updateCostCenter error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profit center' });
  }
}

/**
 * DELETE /cost-centers/:id — SOFT delete.
 *
 * A hard delete relies on `onDelete: SetNull`, which silently un-tags every
 * historical invoice, expense and journal line and destroys a department's
 * reporting history with no audit trail. Soft-deleting keeps those documents
 * reporting under the centre they were actually booked to.
 */
export async function deleteCostCenter(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const id = String(req.params.id);

    const existing = await prisma.costCenter.findFirst({ where: { id, tenantId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Profit center not found' });
      return;
    }

    const childCount = await prisma.costCenter.count({
      where: { parentId: id, tenantId, isDeleted: false },
    });
    if (childCount > 0) {
      res.status(409).json({
        success: false,
        message: 'Reassign or remove the child profit centers before deleting this one',
      });
      return;
    }

    // Release the unique (tenantId, code) and (tenantId, numberPrefix) slots so the
    // same code or document prefix can be reused after deletion. Prisma cannot
    // express a partial unique index, so freeing the slot beats making the
    // constraint conditional and living with permanent migrate-diff drift.
    await prisma.costCenter.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        code: `${existing.code}__deleted_${Date.now()}`,
        numberPrefix: null,
      },
    });
    res.json({ success: true, message: 'Profit center deleted' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('deleteCostCenter error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete profit center' });
  }
}

// =============================================================================
// Project CRUD
// =============================================================================

/** GET /projects */
export async function listProjects(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const items = await prisma.project.findMany({
      where: { tenantId },
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
    const tenantId = requireTenantId(req);
    const id = String(req.params.id);

    const project = await prisma.project.findFirst({
      where: { id, tenantId },
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
    const tenantId = requireTenantId(req);
    const { code, name, description, status } = req.body as { code?: string; name?: string; description?: string; status?: string };

    if (!code || !name) {
      res.status(400).json({ success: false, message: 'code and name are required' });
      return;
    }

    const item = await prisma.project.create({
      data: { tenantId, code, name, description: description ?? null, status: status ?? 'active' },
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
    const tenantId = requireTenantId(req);
    const id = String(req.params.id);

    const existing = await prisma.project.findFirst({ where: { id, tenantId } });
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
    const tenantId = requireTenantId(req);
    const id = String(req.params.id);

    const existing = await prisma.project.findFirst({ where: { id, tenantId } });
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
  tenantId: string,
  dimField: 'costCenterId' | 'projectId',
  dimId: string | undefined,
  from: Date,
  to: Date,
): Promise<{ revenue: string; expenses: string; net: string }> {
  // Load INCOME accounts with their filtered journal lines
  const accounts = await prisma.account.findMany({
    where: { tenantId, isDeleted: false, accountType: { in: ['INCOME', 'EXPENSE'] } },
    select: {
      accountType: true,
      journalLines: {
        where: {
          ...(dimId ? { [dimField]: dimId } : { [dimField]: null }),
          journalEntry: {
            tenantId,
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
    const tenantId = requireTenantId(req);

    const toDateRaw = parseDate(req.query.to);
    const toDate = toDateRaw ?? new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDateRaw = parseDate(req.query.from);
    const fromDate = fromDateRaw ?? new Date(toDate.getFullYear(), 0, 1);
    fromDate.setHours(0, 0, 0, 0);

    const filterCostCenterId = req.query.costCenterId as string | undefined;

    if (filterCostCenterId) {
      // Single cost center P&L
      const cc = await prisma.costCenter.findFirst({ where: { id: filterCostCenterId, tenantId } });
      if (!cc) {
        res.status(404).json({ success: false, message: 'Cost center not found' });
        return;
      }
      const pnl = await pnlForDimension(tenantId, 'costCenterId', filterCostCenterId, fromDate, toDate);
      res.json({ success: true, data: { period: { from: fromDate, to: toDate }, costCenter: { id: cc.id, code: cc.code, name: cc.name }, ...pnl } });
      return;
    }

    // All cost centers summary
    const costCenters = await prisma.costCenter.findMany({
      where: { tenantId, isDeleted: false },
      orderBy: { code: 'asc' },
    });

    const rows = await Promise.all(
      costCenters.map(async (cc) => {
        const pnl = await pnlForDimension(tenantId, 'costCenterId', cc.id, fromDate, toDate);
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
    const tenantId = requireTenantId(req);

    const toDateRaw = parseDate(req.query.to);
    const toDate = toDateRaw ?? new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDateRaw = parseDate(req.query.from);
    const fromDate = fromDateRaw ?? new Date(toDate.getFullYear(), 0, 1);
    fromDate.setHours(0, 0, 0, 0);

    const filterProjectId = req.query.projectId as string | undefined;

    if (filterProjectId) {
      // Single project P&L
      const project = await prisma.project.findFirst({ where: { id: filterProjectId, tenantId } });
      if (!project) {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }
      const pnl = await pnlForDimension(tenantId, 'projectId', filterProjectId, fromDate, toDate);
      res.json({ success: true, data: { period: { from: fromDate, to: toDate }, project: { id: project.id, code: project.code, name: project.name, status: project.status }, ...pnl } });
      return;
    }

    // All projects summary
    const projects = await prisma.project.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });

    const rows = await Promise.all(
      projects.map(async (project) => {
        const pnl = await pnlForDimension(tenantId, 'projectId', project.id, fromDate, toDate);
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

// =============================================================================
// Columnar P&L by department
// =============================================================================

/**
 * GET /reports/pnl-by-department?from=&to=&rollup=parent
 *
 * Departments across the columns, accounts down the rows, plus a
 * Common / Unallocated column for untagged lines.
 *
 * Deliberately a SEPARATE endpoint from /reports/pnl-by-cost-center: that one
 * is already consumed by the shipped P&L-by-dimension page and returns a
 * per-centre summary. This one replaces its per-centre Promise.all loop (an
 * N+1 over centres) with a single grouped query.
 */
export async function pnlByDepartment(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);

    const toDateRaw = parseDate(req.query.to);
    const toDate = toDateRaw ?? new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDateRaw = parseDate(req.query.from);
    const fromDate = fromDateRaw ?? new Date(toDate.getFullYear(), 0, 1);
    fromDate.setHours(0, 0, 0, 0);

    // Three queries total, regardless of how many departments exist.
    const [grouped, accounts, centres] = await Promise.all([
      prisma.journalLine.groupBy({
        by: ['accountId', 'costCenterId'],
        where: {
          account: { tenantId, isDeleted: false, accountType: { in: ['INCOME', 'EXPENSE'] } },
          journalEntry: { tenantId, isDeleted: false, entryDate: { gte: fromDate, lte: toDate } },
        },
        _sum: { baseDebit: true, baseCredit: true },
      }),
      prisma.account.findMany({
        where: { tenantId, isDeleted: false, accountType: { in: ['INCOME', 'EXPENSE'] } },
        select: { id: true, code: true, name: true, accountType: true },
        orderBy: { code: 'asc' },
      }),
      prisma.costCenter.findMany({
        where: { tenantId, isDeleted: false },
        select: { id: true, code: true, name: true, parentId: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    const rows: DimGroupRow[] = grouped.map((g) => ({
      accountId: g.accountId,
      costCenterId: g.costCenterId ?? null,
      debit: String(g._sum.baseDebit ?? 0),
      credit: String(g._sum.baseCredit ?? 0),
    }));

    let result = pivotPnlByDimension(rows, accounts, centres);

    if (String(req.query.rollup ?? '') === 'parent') {
      result = rollUpToParents(
        result,
        new Map(centres.map((c) => [c.id, c.parentId ?? null])),
        new Map(centres.map((c) => [c.id, { code: c.code, name: c.name }])),
      );
    }

    res.json({
      success: true,
      data: { period: { from: fromDate, to: toDate }, ...result },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('pnlByDepartment error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute P&L by department' });
  }
}
