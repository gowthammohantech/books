import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';


export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)));

    const where: Prisma.RefundWhereInput = { userId };
    const [rows, total] = await Promise.all([
      prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.refund.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        refunds: rows.map((r) => ({ ...r })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('refund list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list refunds' });
  }
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const row = await prisma.refund.findFirst({ where: { id, userId } });
    if (!row) {
      res.status(404).json({ success: false, message: 'Refund not found' });
      return;
    }
    res.json({ success: true, data: { refund: { ...row } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('refund getById error:', err);
    res.status(500).json({ success: false, message: 'Failed to load refund' });
  }
}

const handlers = { list, getById };
module.exports = handlers;
module.exports.default = handlers;
