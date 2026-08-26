import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

// GET /admin/payment-link-methods?enabledOnly=true
export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const enabledOnly = req.query.enabledOnly === 'true';
    const rows = await prisma.paymentLinkMethod.findMany({
      where: { userId, isDeleted: false, ...(enabledOnly ? { enabled: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Failed to load payment methods' });
  }
}

// POST /admin/payment-link-methods
export async function create(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { name, defaultUrl, enabled, sortOrder } = req.body as {
      name?: string;
      defaultUrl?: string | null;
      enabled?: boolean;
      sortOrder?: number;
    };
    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'Name is required' });
      return;
    }
    const row = await prisma.paymentLinkMethod.create({
      data: {
        userId,
        name: name.trim(),
        defaultUrl: defaultUrl?.trim() || null,
        enabled: enabled ?? true,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Failed to create payment method' });
  }
}

// PUT /admin/payment-link-methods/:id
export async function update(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.paymentLinkMethod.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Payment method not found' });
      return;
    }
    const { name, defaultUrl, enabled, sortOrder } = req.body as {
      name?: string;
      defaultUrl?: string | null;
      enabled?: boolean;
      sortOrder?: number;
    };
    const row = await prisma.paymentLinkMethod.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(defaultUrl !== undefined ? { defaultUrl: defaultUrl?.trim() || null } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Failed to update payment method' });
  }
}

// DELETE /admin/payment-link-methods/:id
export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.paymentLinkMethod.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Payment method not found' });
      return;
    }
    await prisma.paymentLinkMethod.update({ where: { id }, data: { isDeleted: true } });
    res.json({ success: true, message: 'Payment method deleted' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Failed to delete payment method' });
  }
}
