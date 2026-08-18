import type { Request, Response } from 'express';
import type { AccountType, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

import { seedDefaultChart } from '../lib/defaultChartOfAccounts';

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const accountType = req.query.accountType as string | undefined;
    const where: Prisma.AccountWhereInput = { userId, isDeleted: false };
    if (accountType && (ACCOUNT_TYPES as readonly string[]).includes(accountType)) {
      where.accountType = accountType as AccountType;
    }
    const rows = await prisma.account.findMany({
      where,
      orderBy: { code: 'asc' },
      include: { parent: { select: { id: true, code: true, name: true } } },
    });
    res.json({
      success: true,
      data: {
        accounts: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          accountType: r.accountType,
          parentId: r.parentId,
          parent: r.parent,
          description: r.description,
        })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('account list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list accounts' });
  }
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const row = await prisma.account.findFirst({
      where: { id, userId, isDeleted: false },
      include: { parent: true, children: true },
    });
    if (!row) {
      res.status(404).json({ success: false, message: 'Account not found' });
      return;
    }
    res.json({ success: true, data: { account: { ...row } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('account getById error:', err);
    res.status(500).json({ success: false, message: 'Failed to load account' });
  }
}

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as { code?: string; name?: string; accountType?: string; parentId?: string | null; description?: string };

    if (!body.code || !body.name || !body.accountType) {
      res.status(400).json({ success: false, message: 'code + name + accountType required' });
      return;
    }
    if (!(ACCOUNT_TYPES as readonly string[]).includes(body.accountType)) {
      res.status(400).json({ success: false, message: 'Invalid accountType' });
      return;
    }

    const existing = await prisma.account.findUnique({ where: { userId_code: { userId, code: body.code } } });
    if (existing) {
      res.status(400).json({ success: false, message: 'Account code already in use' });
      return;
    }

    const created = await prisma.account.create({
      data: {
        userId,
        code: body.code,
        name: body.name,
        accountType: body.accountType as AccountType,
        parentId: body.parentId || null,
        description: body.description ?? null,
      },
    });

    res.status(201).json({ success: true, message: 'Account created', data: { account: { ...created } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('account create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create account' });
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; accountType?: string; parentId?: string | null; description?: string };

    const existing = await prisma.account.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Account not found' });
      return;
    }

    const data: Prisma.AccountUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.accountType !== undefined && (ACCOUNT_TYPES as readonly string[]).includes(body.accountType)) {
      data.accountType = body.accountType as AccountType;
    }
    if (body.parentId !== undefined) {
      data.parent = body.parentId ? { connect: { id: body.parentId } } : { disconnect: true };
    }
    if (body.description !== undefined) data.description = body.description;

    const updated = await prisma.account.update({ where: { id }, data });
    res.json({ success: true, message: 'Account updated', data: { account: { ...updated } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('account update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update account' });
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.account.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Account not found' });
      return;
    }
    await prisma.account.update({ where: { id }, data: { isDeleted: true } });
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('account remove error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
}

export async function seedDefaults(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const result = await seedDefaultChart(prisma, userId);
    res.status(201).json({ success: true, message: `Seeded ${result.created} accounts (${result.skipped} skipped)`, data: result });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('account seedDefaults error:', err);
    res.status(500).json({ success: false, message: 'Failed to seed default chart' });
  }
}

const handlers = { list, getById, create, update, remove, seedDefaults };
module.exports = handlers;
module.exports.default = handlers;
