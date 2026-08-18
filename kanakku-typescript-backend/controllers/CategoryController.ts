import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { insertCustomFieldValues, readCustomFieldValues } from '../lib/customFieldValues';

// Category is a global lookup table — no userId column, so tenantScope()
// does not apply here.

// Attach an absolute image URL the frontend can render directly. Stored value
// is just the filename; built from the request host (https behind trust proxy).
function withImageUrl<T extends { category_image: string | null }>(req: Request, c: T) {
  return {
    ...c,
    categoryImageUrl: c.category_image
      ? `${req.protocol}://${req.get('host')}/uploads/${c.category_image}`
      : null,
  };
}

// Create Category
export async function createCategory(req: Request, res: Response): Promise<void> {
  try {
    const { category_name, slug, status } = req.body as {
      category_name?: string;
      slug?: string;
      status?: boolean | string;
    };

    // Support both upload.single() (req.file) and upload.any() (req.files array)
    const filesArray = (req.files as Express.Multer.File[] | undefined) ?? [];
    const imageFile = req.file ?? filesArray.find((f) => f.fieldname === 'category_image');
    const category_image = imageFile ? imageFile.filename : null;

    const userId = (req as Request & { user?: string }).user ?? 'system';

    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          category_name: category_name as string,
          slug: slug as string,
          category_image,
          status: typeof status === 'string' ? status === 'true' : (status ?? true),
        },
      });
      await insertCustomFieldValues(tx, {
        module: 'category',
        recordId: created.id,
        customFields: req.body.customFields,
        files: filesArray,
        userId,
      });
      return created;
    });

    res.status(201).json({ message: 'Category created', data: withImageUrl(req, category) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// Get all categories (paginated, search)
export async function getAllCategories(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();

    // Original JS searched category_name and category_description. The
    // Prisma schema has no category_description column, so we only filter
    // on category_name when a search term is provided.
    const where: Prisma.CategoryWhereInput = {};
    if (search) {
      where.category_name = { contains: search, mode: 'insensitive' };
    }

    const [total, categories] = await Promise.all([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.status(200).json({
      message: 'Categories fetched successfully',
      data: {
        categories: categories.map((c) => withImageUrl(req, c)),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    res.status(500).json({
      message: 'Error fetching categories',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get category by id
export async function getCategoryById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    const customFields = await readCustomFieldValues(prisma, {
      module: 'category',
      recordId: id,
      moduleSlug: 'categories',
    });
    res.json({ ...withImageUrl(req, category), customFields });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// Update category
export async function updateCategory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { category_name, slug, status } = req.body as {
      category_name?: string;
      slug?: string;
      status?: boolean | string;
    };

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Support both upload.single() (req.file) and upload.any() (req.files array)
    const filesArray = (req.files as Express.Multer.File[] | undefined) ?? [];
    const imageFile = req.file ?? filesArray.find((f) => f.fieldname === 'category_image');

    const userId = (req as Request & { user?: string }).user ?? 'system';

    const data: Prisma.CategoryUpdateInput = {};
    if (category_name) data.category_name = category_name;
    if (slug) data.slug = slug;
    if (status !== undefined) {
      data.status = typeof status === 'string' ? status === 'true' : status;
    }
    if (imageFile) data.category_image = imageFile.filename;

    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id: existing.id },
        data,
      });
      await insertCustomFieldValues(tx, {
        module: 'category',
        recordId: updated.id,
        customFields: req.body.customFields,
        files: filesArray,
        userId,
      });
      return updated;
    });

    res.json({ message: 'Category updated', data: withImageUrl(req, category) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// Delete category
export async function deleteCategory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    await prisma.category.delete({ where: { id: existing.id } });
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
module.exports.createCategory = createCategory;
module.exports.getAllCategories = getAllCategories;
module.exports.getCategoryById = getCategoryById;
module.exports.updateCategory = updateCategory;
module.exports.deleteCategory = deleteCategory;
