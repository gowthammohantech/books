import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

// TaxGroup is a global lookup table — no userId column, so tenantScope()
// does not apply here. The implicit many-to-many relation is
// "TaxGroupTaxRates" between TaxGroup and TaxRate.

// Get all tax groups (paginated, search, populated with tax_rates)
export async function getAllTaxGroups(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();
    const skip = (page - 1) * limit;

    // Original JS searched tax_name and description. The Prisma schema
    // has only tax_name, so we filter on that when a search term is
    // provided.
    const where: Prisma.TaxGroupWhereInput = {};
    if (search) {
      where.tax_name = { contains: search, mode: 'insensitive' };
    }

    const [total, taxGroups] = await Promise.all([
      prisma.taxGroup.count({ where }),
      prisma.taxGroup.findMany({
        where,
        include: { tax_rates: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    // Calculate total tax rate per group and format response.
    const result = taxGroups.map((taxGroup) => {
      const totalTaxRate = taxGroup.tax_rates.reduce<Prisma.Decimal>(
        (sum, rate) => sum.add(rate.rate ?? new Prisma.Decimal(0)),
        new Prisma.Decimal(0),
      );

      return {
        ...taxGroup,
        total_tax_rate: totalTaxRate,
      };
    });

    res.status(200).json({
      data: result,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({
      message: 'Failed to fetch tax groups',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Create new tax group
export async function createTaxGroup(req: Request, res: Response): Promise<void> {
  try {
    const { tax_name, tax_rate_ids, status } = req.body as {
      tax_name?: string;
      tax_rate?: unknown;
      tax_rate_ids?: string[];
      status?: boolean | string;
    };

    const newGroup = await prisma.$transaction(async (tx) => {
      return tx.taxGroup.create({
        data: {
          tax_name: tax_name as string,
          ...(status !== undefined
            ? { status: typeof status === 'string' ? status === 'true' : status }
            : {}),
          ...(Array.isArray(tax_rate_ids) && tax_rate_ids.length > 0
            ? { tax_rates: { connect: tax_rate_ids.map((id) => ({ id })) } }
            : {}),
        },
        include: { tax_rates: true },
      });
    });

    res.status(201).json({
      success: true,
      message: 'Tax group created successfully',
      data: newGroup,
    });
  } catch (err) {
    console.error('Tax group creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create tax group',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get a single tax group by id
export async function getTaxGroupById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const group = await prisma.taxGroup.findUnique({
      where: { id },
      include: { tax_rates: true },
    });

    if (!group) {
      res.status(404).json({ message: 'Tax group not found' });
      return;
    }

    res.status(200).json(group);
  } catch (err) {
    res.status(500).json({
      message: 'Failed to fetch tax group',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Update tax group
export async function updateTaxGroup(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const body = req.body as {
      tax_name?: string;
      tax_rate_ids?: string[];
      status?: boolean | string;
    };

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.taxGroup.findUnique({ where: { id } });
      if (!existing) return null;

      const data: Prisma.TaxGroupUpdateInput = {};
      if (body.tax_name !== undefined) data.tax_name = body.tax_name;
      if (body.status !== undefined) {
        data.status = typeof body.status === 'string' ? body.status === 'true' : body.status;
      }
      if (Array.isArray(body.tax_rate_ids)) {
        // Replace the many-to-many set.
        data.tax_rates = { set: body.tax_rate_ids.map((rid) => ({ id: rid })) };
      }

      return tx.taxGroup.update({
        where: { id: existing.id },
        data,
        include: { tax_rates: true },
      });
    });

    if (!updated) {
      res.status(404).json({
        success: false,
        message: 'Tax group not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Tax group updated successfully',
      data: updated,
    });
  } catch (err) {
    console.error('Tax group update error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update tax group',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Delete tax group
export async function deleteTaxGroup(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.taxGroup.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Tax group not found' });
      return;
    }

    await prisma.taxGroup.delete({ where: { id: existing.id } });
    res.status(200).json({ message: 'Tax group deleted successfully' });
  } catch (err) {
    res.status(500).json({
      message: 'Failed to delete tax group',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  getAllTaxGroups,
  createTaxGroup,
  getTaxGroupById,
  updateTaxGroup,
  deleteTaxGroup,
};
module.exports.getAllTaxGroups = getAllTaxGroups;
module.exports.createTaxGroup = createTaxGroup;
module.exports.getTaxGroupById = getTaxGroupById;
module.exports.updateTaxGroup = updateTaxGroup;
module.exports.deleteTaxGroup = deleteTaxGroup;
