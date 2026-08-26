import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';


export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const rows = await prisma.accountingPeriod.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });
    res.json({
      success: true,
      data: {
        accountingPeriods: rows.map((r) => ({ ...r })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingPeriod list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list periods' });
  }
}

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as { name?: string; startDate?: string; endDate?: string; notes?: string };
    if (!body.name || !body.startDate || !body.endDate) {
      res.status(400).json({ success: false, message: 'name + startDate + endDate required' });
      return;
    }
    const created = await prisma.accountingPeriod.create({
      data: {
        userId,
        name: body.name,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        notes: body.notes ?? null,
      },
    });
    res.status(201).json({ success: true, message: 'Period created', data: { accountingPeriod: { ...created } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingPeriod create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create period' });
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; startDate?: string; endDate?: string; notes?: string };

    const existing = await prisma.accountingPeriod.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Period not found' });
      return;
    }
    if (existing.isLocked) {
      res.status(400).json({ success: false, message: 'Cannot edit a locked period' });
      return;
    }
    const data: Prisma.AccountingPeriodUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.startDate !== undefined) data.startDate = new Date(body.startDate);
    if (body.endDate !== undefined) data.endDate = new Date(body.endDate);
    if (body.notes !== undefined) data.notes = body.notes;

    const updated = await prisma.accountingPeriod.update({ where: { id }, data });
    res.json({ success: true, message: 'Period updated', data: { accountingPeriod: { ...updated } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingPeriod update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update period' });
  }
}

export async function lock(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.accountingPeriod.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Period not found' });
      return;
    }
    if (existing.isLocked) {
      res.status(400).json({ success: false, message: 'Already locked' });
      return;
    }
    const updated = await prisma.accountingPeriod.update({
      where: { id },
      data: { isLocked: true, lockedAt: new Date(), lockedBy: userId },
    });
    res.json({ success: true, message: 'Period locked', data: { accountingPeriod: { ...updated } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingPeriod lock error:', err);
    res.status(500).json({ success: false, message: 'Failed to lock period' });
  }
}

export async function unlock(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.accountingPeriod.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Period not found' });
      return;
    }
    const updated = await prisma.accountingPeriod.update({
      where: { id },
      data: { isLocked: false, lockedAt: null, lockedBy: null },
    });
    res.json({ success: true, message: 'Period unlocked', data: { accountingPeriod: { ...updated } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingPeriod unlock error:', err);
    res.status(500).json({ success: false, message: 'Failed to unlock period' });
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.accountingPeriod.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Period not found' });
      return;
    }
    if (existing.isLocked) {
      res.status(400).json({ success: false, message: 'Cannot delete a locked period; unlock first' });
      return;
    }
    await prisma.accountingPeriod.delete({ where: { id } });
    res.json({ success: true, message: 'Period deleted' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingPeriod remove error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete period' });
  }
}

const handlers = { list, create, update, lock, unlock, remove };
module.exports = handlers;
module.exports.default = handlers;
