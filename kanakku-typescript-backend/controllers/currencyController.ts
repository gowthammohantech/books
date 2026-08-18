import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

// Currency is a shared lookup table that records which user created each row
// (Currency.createdBy → User). Reads are NOT scoped to the calling user — the
// legacy controller served every non-deleted currency to anyone. Writes use
// `requireUserId(req)` to populate `createdBy`.
//
// Note: The legacy JS controller also mutated `User.defaultCurrency` whenever
// the default currency changed. The Prisma `User` model has no such column
// (it is on `AIConfiguration` instead and is a hard-coded ISO code, not a
// FK), so those `User.updateMany` calls have no analogue and are dropped.

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function createCurrency(req: Request, res: Response): Promise<void> {
  try {
    const createdBy = requireUserId(req);

    const { name, code, symbol, status = true, isDefault = false } = req.body as {
      name?: string;
      code?: string;
      symbol?: string;
      status?: boolean;
      isDefault?: boolean;
    };

    const existingCode = await prisma.currency.findFirst({
      where: { code: code as string, isDeleted: false },
    });
    if (existingCode) {
      res.status(409).json({
        success: false,
        message: 'Currency code already exists',
      });
      return;
    }

    const existingName = await prisma.currency.findFirst({
      where: { name: name as string, isDeleted: false },
    });
    if (existingName) {
      res.status(409).json({
        success: false,
        message: 'Currency name already exists',
      });
      return;
    }

    const currency = await prisma.currency.create({
      data: {
        name: name as string,
        code: code as string,
        symbol: symbol as string,
        status,
        isDefault,
        createdBy,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Currency created successfully',
      data: {
        id: currency.id,
        name: currency.name,
        code: currency.code,
        symbol: currency.symbol,
        status: currency.status,
        isDefault: currency.isDefault,
        createdAt: currency.createdAt,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Currency creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating currency',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getAllCurrencies(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();
    const status = req.query.status as string | undefined;

    const where: Prisma.CurrencyWhereInput = { isDeleted: false };

    if (status !== undefined) {
      where.status = status === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, currencies] = await Promise.all([
      prisma.currency.count({ where }),
      prisma.currency.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          createdByUser: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);

    const formattedCurrencies = currencies.map((currency) => ({
      id: currency.id,
      name: currency.name,
      code: currency.code,
      symbol: currency.symbol,
      status: currency.status,
      isDefault: currency.isDefault,
      createdBy: currency.createdByUser
        ? {
            id: currency.createdByUser.id,
            name: `${currency.createdByUser.firstName} ${currency.createdByUser.lastName ?? ''}`.trim(),
          }
        : null,
      createdAt: currency.createdAt,
    }));

    res.status(200).json({
      success: true,
      message: 'Currencies retrieved successfully',
      data: {
        currencies: formattedCurrencies,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('Error fetching currencies:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching currencies',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateCurrency(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { name, code, symbol, status, isDefault } = req.body as {
      name?: string;
      code?: string;
      symbol?: string;
      status?: boolean;
      isDefault?: boolean;
    };

    const errors: Record<string, string> = {};

    // Validate required fields if they're being updated
    if (name !== undefined && !name) {
      errors.name = 'Currency name is required';
    }
    if (code !== undefined && !code) {
      errors.code = 'Currency code is required';
    }

    // If there are validation errors, return them
    if (Object.keys(errors).length > 0) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
      return;
    }

    const currency = await prisma.currency.findFirst({
      where: { id, isDeleted: false },
    });
    if (!currency) {
      res.status(404).json({
        success: false,
        message: 'Currency not found',
        errors: {
          id: 'Currency not found',
        },
      });
      return;
    }

    // Check if currency code already exists (excluding current currency)
    if (code && code !== currency.code) {
      const existingCode = await prisma.currency.findFirst({
        where: {
          code,
          isDeleted: false,
          NOT: { id },
        },
      });
      if (existingCode) {
        errors.code = 'Currency code already exists';
      }
    }

    // Check if currency name already exists (excluding current currency)
    if (name && name !== currency.name) {
      const existingName = await prisma.currency.findFirst({
        where: {
          name,
          isDeleted: false,
          NOT: { id },
        },
      });
      if (existingName) {
        errors.name = 'Currency name already exists';
      }
    }

    // If there are duplicate errors, return them
    if (Object.keys(errors).length > 0) {
      res.status(409).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
      return;
    }

    // Build update payload — only include fields that were provided
    const data: Prisma.CurrencyUpdateInput = {};
    if (name) data.name = name;
    if (code) data.code = code;
    if (symbol) data.symbol = symbol;
    if (status !== undefined) data.status = status;
    if (isDefault !== undefined) data.isDefault = isDefault;

    const updated = await prisma.currency.update({
      where: { id: currency.id },
      data,
    });

    res.status(200).json({
      success: true,
      message: 'Currency updated successfully',
      data: {
        id: updated.id,
        name: updated.name,
        code: updated.code,
        symbol: updated.symbol,
        status: updated.status,
        isDefault: updated.isDefault,
      },
    });
  } catch (err) {
    console.error('Currency update error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating currency',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteCurrency(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const currency = await prisma.currency.findFirst({
      where: { id, isDeleted: false },
    });
    if (!currency) {
      res.status(404).json({
        success: false,
        message: 'Currency not found',
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Soft delete the current currency.
      await tx.currency.update({
        where: { id: currency.id },
        data: { isDeleted: true },
      });

      // If this was the default currency, promote the oldest remaining one.
      if (currency.isDefault) {
        const newDefault = await tx.currency.findFirst({
          where: {
            isDeleted: false,
            NOT: { id },
          },
          orderBy: { createdAt: 'asc' },
        });

        if (newDefault) {
          await tx.currency.update({
            where: { id: newDefault.id },
            data: { isDefault: true },
          });
        }
      }
    });

    res.status(200).json({
      success: true,
      message: 'Currency deleted successfully',
    });
  } catch (err) {
    console.error('Currency deletion error:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting currency',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateCurrencyStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { status, isDefault } = req.body as {
      status?: boolean;
      isDefault?: boolean;
    };

    // Validate input
    if (typeof status !== 'boolean' && typeof isDefault !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Both status and isDefault must be boolean values',
      });
      return;
    }

    // Find the currency
    const currency = await prisma.currency.findUnique({ where: { id } });
    if (!currency) {
      res.status(404).json({
        success: false,
        message: 'Currency not found',
      });
      return;
    }

    // Prepare update object
    const data: Prisma.CurrencyUpdateInput = {};
    if (typeof status === 'boolean') data.status = status;
    if (typeof isDefault === 'boolean') data.isDefault = isDefault;

    const updatedCurrency = await prisma.$transaction(async (tx) => {
      const updated = await tx.currency.update({
        where: { id },
        data,
      });

      // If we are marking this row as the new default, unset any other defaults.
      if (isDefault === true) {
        await tx.currency.updateMany({
          where: {
            isDeleted: false,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }

      return updated;
    });

    res.status(200).json({
      success: true,
      message: 'Currency updated successfully',
      data: {
        id: updatedCurrency.id,
        name: updatedCurrency.name,
        code: updatedCurrency.code,
        status: updatedCurrency.status,
        isDefault: updatedCurrency.isDefault,
        updatedAt: updatedCurrency.updatedAt,
      },
    });
  } catch (err) {
    console.error('Currency update error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating currency',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createCurrency,
  getAllCurrencies,
  updateCurrency,
  deleteCurrency,
  updateCurrencyStatus,
};
module.exports.createCurrency = createCurrency;
module.exports.getAllCurrencies = getAllCurrencies;
module.exports.updateCurrency = updateCurrency;
module.exports.deleteCurrency = deleteCurrency;
module.exports.updateCurrencyStatus = updateCurrencyStatus;
