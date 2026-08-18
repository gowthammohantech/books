import type { Request, Response } from 'express';
import type { ExpenseCategory } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

// ExpenseCategory is a global lookup table — it has no userId column, so the
// usual tenantScope() helper does not apply here. Soft-deletion (isDeleted)
// is still respected.

// Create Expense Category
export async function createExpenseCategory(req: Request, res: Response): Promise<void> {
  try {
    const { title, description, status = true } = req.body as {
      title?: string;
      description?: string;
      status?: boolean;
    };

    const category = await prisma.expenseCategory.create({
      data: {
        title: title as string,
        description: description ?? null,
        status,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Expense Category created successfully',
      data: {
        id: category.id,
        title: category.title,
        description: category.description,
        status: category.status,
        createdAt: category.createdAt,
      },
    });
  } catch (err) {
    console.error('Error creating expense category:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating expense category',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get All Expense Categories (with pagination, search, filter)
export async function getAllExpenseCategories(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();
    const status = req.query.status as string | undefined;

    const where: Prisma.ExpenseCategoryWhereInput = { isDeleted: false };

    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    if (status !== undefined) {
      where.status = status === 'true';
    }

    const [total, categories] = await Promise.all([
      prisma.expenseCategory.count({ where }),
      prisma.expenseCategory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const formatted = categories.map((cat: ExpenseCategory) => ({
      id: cat.id,
      title: cat.title,
      description: cat.description,
      status: cat.status,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: 'Expense Categories fetched successfully',
      data: {
        categories: formatted,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listExpenseCategories(req: Request, res: Response): Promise<void> {
  try {
    const search = ((req.query.search as string) ?? '').trim();
    const limit = 10;

    // Build query
    const where: Prisma.ExpenseCategoryWhereInput = { isDeleted: false };
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    // Fetch categories
    const categories = await prisma.expenseCategory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Format response
    const formatted = categories.map((cat: ExpenseCategory) => ({
      id: cat.id,
      title: cat.title,
      description: cat.description,
      status: cat.status,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: 'Expense Categories fetched successfully',
      data: formatted,
    });
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get Single Expense Category
export async function getExpenseCategoryById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const category = await prisma.expenseCategory.findFirst({
      where: { id, isDeleted: false },
    });

    if (!category) {
      res.status(404).json({ success: false, message: 'Expense Category not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (err) {
    console.error('Error fetching expense category:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching expense category',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Update Expense Category
export async function updateExpenseCategory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { title, description, status } = req.body as {
      title?: string;
      description?: string;
      status?: boolean;
    };

    const existing = await prisma.expenseCategory.findFirst({
      where: { id, isDeleted: false },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Expense Category not found' });
      return;
    }

    const data: Prisma.ExpenseCategoryUpdateInput = {
      title,
      status,
      description,
    };

    const category = await prisma.expenseCategory.update({
      where: { id: existing.id },
      data,
    });

    res.status(200).json({
      success: true,
      message: 'Expense Category updated successfully',
      data: category,
    });
  } catch (err) {
    console.error('Error updating expense category:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating expense category',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Soft Delete Expense Category
export async function deleteExpenseCategory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.expenseCategory.findFirst({
      where: { id, isDeleted: false },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Expense Category not found' });
      return;
    }

    await prisma.expenseCategory.update({
      where: { id: existing.id },
      data: { isDeleted: true },
    });

    res.status(200).json({
      success: true,
      message: 'Expense Category deleted successfully',
    });
  } catch (err) {
    console.error('Error deleting expense category:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting expense category',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createExpenseCategory,
  getAllExpenseCategories,
  listExpenseCategories,
  getExpenseCategoryById,
  updateExpenseCategory,
  deleteExpenseCategory,
};
module.exports.createExpenseCategory = createExpenseCategory;
module.exports.getAllExpenseCategories = getAllExpenseCategories;
module.exports.listExpenseCategories = listExpenseCategories;
module.exports.getExpenseCategoryById = getExpenseCategoryById;
module.exports.updateExpenseCategory = updateExpenseCategory;
module.exports.deleteExpenseCategory = deleteExpenseCategory;
