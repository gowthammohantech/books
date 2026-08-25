import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { CategoryGroup, CategoryAppliesTo } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { sendPrismaError } from '../middleware/prismaError';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// list  GET /admin/transaction-categories
// ---------------------------------------------------------------------------

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const {
      page = '1',
      limit = '10',
      appliesTo,
      search = '',
    } = req.query as {
      page?: string;
      limit?: string;
      appliesTo?: string;
      search?: string;
    };

    const pageN = Math.max(1, Number(page));
    const limitN = Math.max(1, Number(limit));
    const skip = (pageN - 1) * limitN;

    const where: Prisma.TransactionCategoryWhereInput = {
      userId,
      isDeleted: false,
    };

    if (appliesTo) {
      where.appliesTo = appliesTo as CategoryAppliesTo;
    }

    if (search.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { code: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [total, categories] = await Promise.all([
      prisma.transactionCategory.count({ where }),
      prisma.transactionCategory.findMany({
        where,
        include: {
          account: { select: { id: true, code: true, name: true } },
          defaultTaxRate: { select: { id: true, name: true, rate: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Transaction categories fetched successfully',
      data: {
        categories,
        pagination: {
          total,
          page: pageN,
          limit: limitN,
          totalPages: Math.ceil(total / limitN),
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error listing transaction categories:', err);
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// create  POST /admin/transaction-categories
// ---------------------------------------------------------------------------

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const {
      code,
      name,
      group,
      appliesTo,
      accountId,
      defaultTaxRateId,
      taxApplicable = true,
      status = true,
    } = req.body as {
      code?: string;
      name: string;
      group: CategoryGroup;
      appliesTo: CategoryAppliesTo;
      accountId: string;
      defaultTaxRateId?: string | null;
      taxApplicable?: boolean;
      status?: boolean;
    };

    // Verify accountId belongs to this user (tenant)
    const account = await prisma.account.findFirst({
      where: { id: accountId, userId, isDeleted: false },
    });
    if (!account) {
      res.status(400).json({
        success: false,
        message: 'accountId does not belong to this user or does not exist',
      });
      return;
    }

    const category = await prisma.transactionCategory.create({
      data: {
        userId,
        code: code ?? '',
        name,
        group,
        appliesTo,
        accountId,
        defaultTaxRateId: defaultTaxRateId ?? null,
        taxApplicable,
        status,
        isDeleted: false,
      },
      include: {
        account: { select: { id: true, code: true, name: true } },
        defaultTaxRate: { select: { id: true, name: true, rate: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Transaction category created successfully',
      data: category,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error creating transaction category:', err);
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// update  PUT /admin/transaction-categories/:id
// ---------------------------------------------------------------------------

export async function update(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.transactionCategory.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Transaction category not found' });
      return;
    }

    const {
      code,
      name,
      group,
      appliesTo,
      accountId,
      defaultTaxRateId,
      taxApplicable,
      status,
    } = req.body as {
      code?: string;
      name?: string;
      group?: CategoryGroup;
      appliesTo?: CategoryAppliesTo;
      accountId?: string;
      defaultTaxRateId?: string | null;
      taxApplicable?: boolean;
      status?: boolean;
    };

    // If accountId is being updated, verify it belongs to this user
    if (accountId !== undefined) {
      const account = await prisma.account.findFirst({
        where: { id: accountId, userId, isDeleted: false },
      });
      if (!account) {
        res.status(400).json({
          success: false,
          message: 'accountId does not belong to this user or does not exist',
        });
        return;
      }
    }

    const data: Prisma.TransactionCategoryUpdateInput = {};
    if (code !== undefined) data.code = code;
    if (name !== undefined) data.name = name;
    if (group !== undefined) data.group = group;
    if (appliesTo !== undefined) data.appliesTo = appliesTo;
    if (accountId !== undefined) data.account = { connect: { id: accountId } };
    if (defaultTaxRateId !== undefined) {
      data.defaultTaxRate = defaultTaxRateId
        ? { connect: { id: defaultTaxRateId } }
        : { disconnect: true };
    }
    if (taxApplicable !== undefined) data.taxApplicable = taxApplicable;
    if (status !== undefined) data.status = status;

    const updated = await prisma.transactionCategory.update({
      where: { id },
      data,
      include: {
        account: { select: { id: true, code: true, name: true } },
        defaultTaxRate: { select: { id: true, name: true, rate: true } },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Transaction category updated successfully',
      data: updated,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error updating transaction category:', err);
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// updateStatus  PATCH /admin/transaction-categories/:id/status
// ---------------------------------------------------------------------------

export async function updateStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: unknown };

    if (typeof status !== 'boolean') {
      res.status(400).json({ success: false, message: 'status must be a boolean' });
      return;
    }

    const existing = await prisma.transactionCategory.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Transaction category not found' });
      return;
    }

    const updated = await prisma.transactionCategory.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });

    res.status(200).json({
      success: true,
      message: 'Transaction category status updated successfully',
      data: updated,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error updating transaction category status:', err);
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// remove  DELETE /admin/transaction-categories/:id
// ---------------------------------------------------------------------------

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.transactionCategory.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Transaction category not found' });
      return;
    }

    // Block hard if any BankTransaction references this category
    const inUseCount = await prisma.bankTransaction.count({
      where: { categoryId: id, isDeleted: false },
    });
    if (inUseCount > 0) {
      res.status(409).json({
        success: false,
        message: 'Category is in use; disable it instead.',
      });
      return;
    }

    await prisma.transactionCategory.update({
      where: { id },
      data: { isDeleted: true },
    });

    res.status(200).json({
      success: true,
      message: 'Transaction category deleted successfully',
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error deleting transaction category:', err);
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// CommonJS interop for legacy JS routes
// ---------------------------------------------------------------------------

module.exports = { list, create, update, updateStatus, remove };
module.exports.list = list;
module.exports.create = create;
module.exports.update = update;
module.exports.updateStatus = updateStatus;
module.exports.remove = remove;
