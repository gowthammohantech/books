import fs from 'fs';
import path from 'path';

import type { Request, Response } from 'express';
import type { Supplier, SupplierBalanceType } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../../lib/tenantScope';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// SC.1: resolve the company default currency code (ISO string).
async function resolveDefaultCurrencyCode(): Promise<string | null> {
  const defaultCurrency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return defaultCurrency?.code ?? null;
}

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function tryUnlink(filePath: string | undefined | null): void {
  if (!filePath) return;
  try {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.warn('Could not unlink file', filePath, err);
  }
}

// Build a full URL from a stored filename (just the basename, no path prefix).
// Mirrors the Brand controller pattern: stored value is filename only,
// URL is <protocol>://<host>/uploads/<filename>.
function buildImageUrl(req: Request, filename: string | null | undefined): string | null {
  if (filename) {
    return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
  }
  // No logo: return null (matches the Brand controller). The frontend's
  // ProfileCard renders an initials avatar when imageUrl is null, so there's
  // no request to a non-existent /uploads/default-profile.jpg (which 404'd).
  return null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Per HARD RULE 14, supplier rows are scoped manually because the Supplier
// model uses `user_id` (underscore) instead of the canonical `userId`.
function supplierScope(req: Request): { user_id: string; isDeleted: false } {
  return { user_id: requireUserId(req), isDeleted: false };
}

// -----------------------------------------------------------------------------
// createSupplier
// -----------------------------------------------------------------------------

export async function createSupplier(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const {
      supplier_name,
      supplier_email,
      supplier_phone,
      balance,
      balance_type,
      currencyCode: rawCurrencyCode,
      stateId,
      countryId,
    } = req.body as Record<string, unknown>;

    // Sanity: the owning user must exist.
    const owner = await prisma.user.findUnique({ where: { id: userId } });
    if (!owner) {
      tryUnlink(req.file?.path);
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const balanceNum = asNumber(balance, 0);
    const resolvedBalanceType: SupplierBalanceType | null =
      balanceNum === 0
        ? null
        : (((balance_type as string) || 'credit') as SupplierBalanceType);

    // SC.1: use caller-supplied currencyCode or fall back to the company default.
    const supplierCurrencyCode =
      (typeof rawCurrencyCode === 'string' && rawCurrencyCode ? rawCurrencyCode : null) ??
      (await resolveDefaultCurrencyCode());

    // Email uniqueness check (supplier_email is @unique in schema).
    const emailClash = await prisma.supplier.findFirst({
      where: { supplier_email: supplier_email as string },
    });
    if (emailClash) {
      tryUnlink(req.file?.path);
      res.status(409).json({
        success: false,
        message: 'Supplier email already exists',
      });
      return;
    }

    const profileImageFilename = req.file ? req.file.filename : null;

    const supplier = await prisma.$transaction(async (tx) => {
      return tx.supplier.create({
        data: {
          user_id: userId,
          supplier_name: supplier_name as string,
          supplier_email: supplier_email as string,
          supplier_phone: (supplier_phone as string) ?? '',
          balance: balanceNum,
          balance_type: resolvedBalanceType,
          // SC.1: currency the supplier transacts in
          ...(supplierCurrencyCode ? { currencyCode: supplierCurrencyCode } : {}),
          stateId: (typeof stateId === 'string' && stateId) ? stateId : null,
          countryId: (typeof countryId === 'string' && countryId) ? countryId : null,
          profileImage: profileImageFilename,
        },
      });
    });

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: {
        id: supplier.id,
        supplier_name: supplier.supplier_name,
        supplier_email: supplier.supplier_email,
        supplier_phone: supplier.supplier_phone,
        balance: Number(supplier.balance ?? 0),
        balance_type: supplier.balance_type,
        currencyCode: supplier.currencyCode ?? null, // SC.1
        stateId: supplier.stateId ?? null,
        countryId: supplier.countryId ?? null,
        profileImage: buildImageUrl(req, supplier.profileImage),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    tryUnlink(req.file?.path);
    console.error('Supplier creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating supplier user',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// -----------------------------------------------------------------------------
// listSuppliers
// -----------------------------------------------------------------------------

export async function listSuppliers(req: Request, res: Response): Promise<void> {
  try {
    const scope = supplierScope(req);

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();

    const where: Prisma.SupplierWhereInput = { ...scope };
    if (search) {
      where.OR = [
        { supplier_name: { contains: search, mode: 'insensitive' } },
        { supplier_email: { contains: search, mode: 'insensitive' } },
        { supplier_phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const suppliers = rows.map((s: Supplier) => ({
      id: s.id,
      supplier_name: s.supplier_name,
      supplier_email: s.supplier_email,
      supplier_phone: s.supplier_phone,
      balance: Number(s.balance ?? 0),
      balance_type: s.balance_type,
      currencyCode: s.currencyCode ?? null, // SC.1
      stateId: s.stateId ?? null,
      countryId: s.countryId ?? null,
      profileImage: buildImageUrl(req, s.profileImage),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.status(200).json({
      message: 'Suppliers fetched successfully',
      data: {
        suppliers,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      message: 'Error fetching suppliers',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// -----------------------------------------------------------------------------
// updateSupplier
// -----------------------------------------------------------------------------

export async function updateSupplier(req: Request, res: Response): Promise<void> {
  try {
    const scope = supplierScope(req);
    const { id } = req.params as { id: string };
    const updates = req.body as Record<string, unknown>;

    const existing = await prisma.supplier.findFirst({
      where: { ...scope, id },
    });

    if (!existing) {
      tryUnlink(req.file?.path);
      res.status(404).json({ message: 'Supplier not found' });
      return;
    }

    // Strip restricted fields.
    const restrictedFields = ['user_type', 'email', '_id', 'id', 'password', 'user_id'];
    for (const field of restrictedFields) {
      if (field in updates) delete updates[field];
    }

    const data: Prisma.SupplierUpdateInput = {};

    if (updates.supplier_name !== undefined) {
      data.supplier_name = updates.supplier_name as string;
    }
    if (updates.supplier_phone !== undefined) {
      data.supplier_phone = (updates.supplier_phone as string) ?? '';
    }
    if (updates.balance !== undefined) {
      const balanceNum = asNumber(updates.balance, 0);
      data.balance = balanceNum;
      if (balanceNum === 0) {
        data.balance_type = null;
      } else if (updates.balance_type !== undefined) {
        data.balance_type = ((updates.balance_type as string) ||
          'credit') as SupplierBalanceType;
      }
    } else if (updates.balance_type !== undefined) {
      data.balance_type = updates.balance_type
        ? ((updates.balance_type as string) as SupplierBalanceType)
        : null;
    }

    if (updates.status !== undefined) {
      data.status = Boolean(updates.status);
    }

    // SC.1: allow updating currencyCode (null clears it back to legacy/unset).
    if (updates.currencyCode !== undefined) {
      (data as Record<string, unknown>)['currencyCode'] =
        typeof updates.currencyCode === 'string' && updates.currencyCode
          ? updates.currencyCode
          : null;
    }

    if (updates.stateId !== undefined) {
      (data as Record<string, unknown>)['stateId'] =
        typeof updates.stateId === 'string' && updates.stateId ? updates.stateId : null;
    }
    if (updates.countryId !== undefined) {
      (data as Record<string, unknown>)['countryId'] =
        typeof updates.countryId === 'string' && updates.countryId ? updates.countryId : null;
    }

    // Preserve-or-replace: only overwrite stored filename when a new file is uploaded.
    if (req.file) {
      data.profileImage = req.file.filename;
    }
    // If no new file, leave data.profileImage unset → Prisma skips the column → existing value preserved.

    const updated = await prisma.$transaction(async (tx) => {
      return tx.supplier.update({
        where: { id: existing.id },
        data,
      });
    });

    res.status(200).json({
      message: 'Supplier updated successfully',
      data: {
        id: updated.id,
        supplier_name: updated.supplier_name,
        supplier_email: updated.supplier_email,
        supplier_phone: updated.supplier_phone,
        balance: Number(updated.balance ?? 0),
        balance_type: updated.balance_type,
        currencyCode: updated.currencyCode ?? null, // SC.1
        stateId: updated.stateId ?? null,
        countryId: updated.countryId ?? null,
        profileImage: buildImageUrl(req, updated.profileImage),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    tryUnlink(req.file?.path);
    console.error('Supplier update error:', err);
    res.status(500).json({
      message: 'Error updating supplier',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// -----------------------------------------------------------------------------
// getSupplierById — GET /api/admin/suppliers/:id
// -----------------------------------------------------------------------------

export async function getSupplierById(req: Request, res: Response): Promise<void> {
  try {
    const scope = supplierScope(req);
    const { id } = req.params as { id: string };

    const s = await prisma.supplier.findFirst({
      where: { ...scope, id },
    });

    if (!s) {
      res.status(404).json({ success: false, message: 'Supplier not found' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Supplier retrieved successfully',
      data: {
        id: s.id,
        supplier_name: s.supplier_name,
        supplier_email: s.supplier_email,
        supplier_phone: s.supplier_phone,
        balance: Number(s.balance ?? 0),
        balance_type: s.balance_type,
        currencyCode: s.currencyCode ?? null,
        stateId: s.stateId ?? null,
        countryId: s.countryId ?? null,
        profileImage: buildImageUrl(req, s.profileImage),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Supplier fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching supplier',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// -----------------------------------------------------------------------------
// deleteSupplier (soft delete — sets isDeleted: true)
// -----------------------------------------------------------------------------

export async function deleteSupplier(req: Request, res: Response): Promise<void> {
  try {
    const scope = supplierScope(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.supplier.findFirst({
      where: { ...scope, id },
    });

    if (!existing) {
      res.status(404).json({ message: 'Supplier not found' });
      return;
    }

    const updated = await prisma.supplier.update({
      where: { id: existing.id },
      data: { isDeleted: true },
    });

    res.status(200).json({
      message: 'Supplier deleted successfully',
      data: updated,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      message: 'Error deleting supplier',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use require().
module.exports = {
  createSupplier,
  listSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
};
module.exports.createSupplier = createSupplier;
module.exports.listSuppliers = listSuppliers;
module.exports.getSupplierById = getSupplierById;
module.exports.updateSupplier = updateSupplier;
module.exports.deleteSupplier = deleteSupplier;
