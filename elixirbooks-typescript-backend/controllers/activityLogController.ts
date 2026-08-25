import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

const VALID_ACTIONS = new Set(['CREATE', 'UPDATE', 'DELETE']);

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export async function listActivityLogs(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const page = toPositiveInt(req.query.page, 1);
    const limit = toPositiveInt(req.query.limit, 10);
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = { userId };

    const { entityType, entityId, action, dateFrom, dateTo, search } = req.query as Record<string, string>;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) {
      if (!VALID_ACTIONS.has(action)) {
        res.status(400).json({ success: false, message: 'Invalid action value' });
        return;
      }
      where.action = action as Prisma.EnumAuditActionFilter['equals'];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { summary: { contains: search, mode: 'insensitive' } },
        { entityLabel: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Activity logs fetched successfully',
      data: {
        items,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: 'Not authorized' });
      return;
    }
    console.error('Error fetching activity logs:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching activity logs',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes.
module.exports = { listActivityLogs };
module.exports.listActivityLogs = listActivityLogs;
