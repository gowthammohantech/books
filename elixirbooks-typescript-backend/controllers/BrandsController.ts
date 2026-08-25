import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { insertCustomFieldValues, readCustomFieldValues } from '../lib/customFieldValues';

// Brand is a global lookup table — no userId column, so tenantScope() does
// not apply here.

// Attach an absolute image URL the frontend can render directly. Stored value
// is just the filename; built from the request host (https behind trust proxy).
function withImageUrl<T extends { brand_image: string | null }>(req: Request, b: T) {
  return {
    ...b,
    brandImageUrl: b.brand_image
      ? `${req.protocol}://${req.get('host')}/uploads/${b.brand_image}`
      : null,
  };
}

// Create Brand
export async function createBrand(req: Request, res: Response): Promise<void> {
  try {
    const { brand_name, status } = req.body as {
      brand_name?: string;
      status?: boolean | string;
    };

    // Support both upload.single() (req.file) and upload.any() (req.files array)
    const filesArray = (req.files as Express.Multer.File[] | undefined) ?? [];
    const imageFile = req.file ?? filesArray.find((f) => f.fieldname === 'brand_image');
    const brand_image = imageFile ? imageFile.filename : null;

    const userId = (req as Request & { user?: string }).user ?? 'system';

    const brand = await prisma.$transaction(async (tx) => {
      const created = await tx.brand.create({
        data: {
          brand_name: brand_name as string,
          brand_image,
          status: typeof status === 'string' ? status === 'true' : (status ?? true),
        },
      });
      await insertCustomFieldValues(tx, {
        module: 'brand',
        recordId: created.id,
        customFields: req.body.customFields,
        files: filesArray,
        userId,
      });
      return created;
    });

    res.status(201).json({ message: 'Brand created', data: withImageUrl(req, brand) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// Get all brands (paginated, search)
export async function getAllBrands(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();

    // Build search query — original JS searched brand_name and
    // brand_description. The Prisma schema has no brand_description column,
    // so we only filter on brand_name when a search term is provided.
    const where: Prisma.BrandWhereInput = {};
    if (search) {
      where.brand_name = { contains: search, mode: 'insensitive' };
    }

    const [total, brands] = await Promise.all([
      prisma.brand.count({ where }),
      prisma.brand.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.status(200).json({
      message: 'Brands fetched successfully',
      data: {
        brands: brands.map((b) => withImageUrl(req, b)),
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
      message: 'Error fetching brands',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get brand by id
export async function getBrandById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      res.status(404).json({ error: 'Brand not found' });
      return;
    }
    const customFields = await readCustomFieldValues(prisma, {
      module: 'brand',
      recordId: id,
      moduleSlug: 'brands',
    });
    res.json({ ...withImageUrl(req, brand), customFields });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// Update brand
export async function updateBrand(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { brand_name, status } = req.body as {
      brand_name?: string;
      status?: boolean | string;
    };

    const existing = await prisma.brand.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Brand not found' });
      return;
    }

    // Support both upload.single() (req.file) and upload.any() (req.files array)
    const filesArray = (req.files as Express.Multer.File[] | undefined) ?? [];
    const imageFile = req.file ?? filesArray.find((f) => f.fieldname === 'brand_image');

    const userId = (req as Request & { user?: string }).user ?? 'system';

    const data: Prisma.BrandUpdateInput = {};
    if (brand_name) data.brand_name = brand_name;
    if (status !== undefined) {
      data.status = typeof status === 'string' ? status === 'true' : status;
    }
    if (imageFile) data.brand_image = imageFile.filename;

    const brand = await prisma.$transaction(async (tx) => {
      const updated = await tx.brand.update({
        where: { id: existing.id },
        data,
      });
      await insertCustomFieldValues(tx, {
        module: 'brand',
        recordId: updated.id,
        customFields: req.body.customFields,
        files: filesArray,
        userId,
      });
      return updated;
    });

    res.json({ message: 'Brand updated', data: withImageUrl(req, brand) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// Delete brand
export async function deleteBrand(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.brand.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Brand not found' });
      return;
    }
    await prisma.brand.delete({ where: { id: existing.id } });
    res.json({ message: 'Brand deleted' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createBrand,
  getAllBrands,
  getBrandById,
  updateBrand,
  deleteBrand,
};
module.exports.createBrand = createBrand;
module.exports.getAllBrands = getAllBrands;
module.exports.getBrandById = getBrandById;
module.exports.updateBrand = updateBrand;
module.exports.deleteBrand = deleteBrand;
