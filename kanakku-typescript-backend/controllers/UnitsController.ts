import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { insertCustomFieldValues, readCustomFieldValues } from '../lib/customFieldValues';

// Unit is a global lookup table — no userId column, so tenantScope() does
// not apply here.

// @desc Get all units (paginated, search)
export async function getUnits(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();

    // Original JS searched unit_name, unit_code, and unit_description. The
    // Prisma schema has unit_name and short_name, so we filter against
    // those when a search term is provided.
    const where: Prisma.UnitWhereInput = {};
    if (search) {
      where.OR = [
        { unit_name: { contains: search, mode: 'insensitive' } },
        { short_name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, units] = await Promise.all([
      prisma.unit.count({ where }),
      prisma.unit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.status(200).json({
      message: 'Units fetched successfully',
      data: {
        units,
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
      message: 'Failed to fetch units',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// @desc Create new unit
export async function createUnit(req: Request, res: Response): Promise<void> {
  const { unit_name, short_name, status } = req.body as {
    unit_name?: string;
    short_name?: string;
    status?: boolean | string;
  };

  const userId = (req as Request & { user?: string }).user ?? 'system';

  try {
    const unit = await prisma.$transaction(async (tx) => {
      const created = await tx.unit.create({
        data: {
          unit_name: unit_name as string,
          short_name: short_name as string,
          status: typeof status === 'string' ? status === 'true' : (status ?? true),
        },
      });
      await insertCustomFieldValues(tx, {
        module: 'unit',
        recordId: created.id,
        customFields: req.body.customFields,
        files: (req.files as Express.Multer.File[]) ?? [],
        userId,
      });
      return created;
    });
    res.status(201).json(unit);
  } catch {
    res.status(400).json({ message: 'Failed to create unit' });
  }
}

// @desc Get a single unit by ID
export async function getUnitById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const unit = await prisma.unit.findUnique({ where: { id } });

    if (!unit) {
      res.status(404).json({ message: 'Unit not found' });
      return;
    }

    const customFields = await readCustomFieldValues(prisma, {
      module: 'unit',
      recordId: id,
      moduleSlug: 'units',
    });

    res.json({ ...unit, customFields });
  } catch {
    res.status(500).json({ message: 'Failed to fetch unit' });
  }
}

// @desc Update unit
export async function updateUnit(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };

  if (!id) {
    res.status(400).json({ message: 'Invalid unit ID' });
    return;
  }

  const userId = (req as Request & { user?: string }).user ?? 'system';

  try {
    const existing = await prisma.unit.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Unit not found' });
      return;
    }

    const body = req.body as {
      unit_name?: string;
      short_name?: string;
      status?: boolean | string;
    };

    const data: Prisma.UnitUpdateInput = {};
    if (body.unit_name !== undefined) data.unit_name = body.unit_name;
    if (body.short_name !== undefined) data.short_name = body.short_name;
    if (body.status !== undefined) {
      data.status = typeof body.status === 'string' ? body.status === 'true' : body.status;
    }

    const unit = await prisma.$transaction(async (tx) => {
      const updated = await tx.unit.update({
        where: { id: existing.id },
        data,
      });
      await insertCustomFieldValues(tx, {
        module: 'unit',
        recordId: updated.id,
        customFields: req.body.customFields,
        files: (req.files as Express.Multer.File[]) ?? [],
        userId,
      });
      return updated;
    });

    res.json({
      message: 'Unit updated successfully',
      data: unit,
    });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ message: 'Failed to update unit' });
  }
}

// @desc Delete unit
export async function deleteUnit(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };

  try {
    const existing = await prisma.unit.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Unit not found' });
      return;
    }

    await prisma.unit.delete({ where: { id: existing.id } });

    res.json({ message: 'Unit deleted successfully' });
  } catch {
    res.status(400).json({ message: 'Failed to delete unit' });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  getUnits,
  createUnit,
  getUnitById,
  updateUnit,
  deleteUnit,
};
module.exports.getUnits = getUnits;
module.exports.createUnit = createUnit;
module.exports.getUnitById = getUnitById;
module.exports.updateUnit = updateUnit;
module.exports.deleteUnit = deleteUnit;
