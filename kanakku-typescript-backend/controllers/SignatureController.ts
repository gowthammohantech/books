import fs from 'fs';

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { Signature } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { tenantScope, requireUserId, UnauthorizedError } from '../lib/tenantScope';

interface SignatureResponse {
  id: string;
  signatureName: string;
  signatureImage: string | null;
  status: boolean;
  markAsDefault: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

function buildImageUrl(req: Request, imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  return `${req.protocol}://${req.get('host')}/${imagePath.replace(/\\/g, '/')}`;
}

function tryUnlink(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('Could not unlink upload', filePath, err);
  }
}

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-');
}

export async function createSignature(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { signatureName, markAsDefault } = req.body as {
      signatureName?: string;
      markAsDefault?: boolean | string;
    };

    const markAsDefaultBool =
      typeof markAsDefault === 'string'
        ? markAsDefault === 'true'
        : Boolean(markAsDefault);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      tryUnlink(req.file?.path);
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    if (!req.file) {
      res.status(422).json({
        success: false,
        message: 'Signature image is required',
      });
      return;
    }

    const signature = await prisma.$transaction(async (tx) => {
      // If creating as default, demote all other signatures for this user.
      if (markAsDefaultBool) {
        await tx.signature.updateMany({
          where: { userId, markAsDefault: true },
          data: { markAsDefault: false },
        });
      }

      return tx.signature.create({
        data: {
          signatureName: signatureName as string,
          signatureImage: req.file!.path,
          markAsDefault: markAsDefaultBool,
          userId,
        },
      });
    });

    res.status(201).json({
      success: true,
      message: 'Signature created successfully',
      data: {
        id: signature.id,
        signatureName: signature.signatureName,
        signatureImage: buildImageUrl(req, signature.signatureImage),
        status: signature.status,
        markAsDefault: signature.markAsDefault,
        createdAt: signature.createdAt,
      } satisfies SignatureResponse,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;

    tryUnlink(req.file?.path);
    console.error('Signature creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating signature',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getUserSignatures(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();
    const statusRaw = req.query.status;

    const where: Prisma.SignatureWhereInput = { ...scope };

    if (search) {
      where.signatureName = {
        contains: search,
        mode: 'insensitive',
      };
    }

    if (statusRaw !== undefined) {
      where.status = statusRaw === 'true' || (statusRaw as unknown) === true;
    }

    const [total, signatures] = await Promise.all([
      prisma.signature.count({ where }),
      prisma.signature.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const formattedSignatures: SignatureResponse[] = signatures.map((sig) => ({
      id: sig.id,
      signatureName: sig.signatureName,
      signatureImage: buildImageUrl(req, sig.signatureImage),
      status: sig.status,
      markAsDefault: sig.markAsDefault,
      createdAt: sig.createdAt,
      updatedAt: sig.updatedAt,
    }));

    res.status(200).json({
      message: 'Signatures fetched successfully',
      data: {
        signatures: formattedSignatures,
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

    console.error('Error fetching signatures:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching signatures',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function updateSignature(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { signatureId } = req.params as { signatureId: string };
    const { signatureName, markAsDefault, status } = req.body as {
      signatureName?: string;
      markAsDefault?: boolean | string;
      status?: boolean | string;
    };

    const existing = await prisma.signature.findFirst({
      where: { ...scope, id: signatureId },
    });

    if (!existing) {
      tryUnlink(req.file?.path);
      res.status(404).json({
        success: false,
        message: 'Signature not found or you dont have permission',
      });
      return;
    }

    const markAsDefaultBool =
      markAsDefault === undefined
        ? undefined
        : typeof markAsDefault === 'string'
          ? markAsDefault === 'true'
          : Boolean(markAsDefault);

    const statusBool =
      status === undefined
        ? undefined
        : typeof status === 'string'
          ? status === 'true'
          : Boolean(status);

    const data: Prisma.SignatureUpdateInput = {};
    if (signatureName !== undefined) data.signatureName = signatureName;
    if (markAsDefaultBool !== undefined) data.markAsDefault = markAsDefaultBool;
    if (statusBool !== undefined) data.status = statusBool;

    let oldImagePath = '';
    if (req.file) {
      oldImagePath = existing.signatureImage ?? '';
      data.signatureImage = req.file.path;
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Demote other defaults if this one is being marked default.
      if (markAsDefaultBool === true) {
        await tx.signature.updateMany({
          where: {
            userId: scope.userId,
            markAsDefault: true,
            id: { not: existing.id },
          },
          data: { markAsDefault: false },
        });
      }

      return tx.signature.update({
        where: { id: existing.id },
        data,
      });
    });

    if (oldImagePath && req.file) {
      tryUnlink(oldImagePath);
    }

    res.status(200).json({
      success: true,
      message: 'Signature updated successfully',
      data: {
        id: updated.id,
        signatureName: updated.signatureName,
        signatureImage: updated.signatureImage
          ? buildImageUrl(req, updated.signatureImage) ?? undefined
          : undefined,
        status: updated.status,
        markAsDefault: updated.markAsDefault,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;

    tryUnlink(req.file?.path);
    console.error('Signature update error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating signature',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function deleteSignature(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { signatureId } = req.params as { signatureId: string };

    const existing = await prisma.signature.findFirst({
      where: { ...scope, id: signatureId },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Signature not found',
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.signature.update({
        where: { id: existing.id },
        data: {
          isDeleted: true,
          status: false,
          markAsDefault: false,
        },
      });

      // If we just removed the default signature, promote the most-recent
      // active signature (if any) as the new default.
      if (existing.markAsDefault) {
        const newDefault = await tx.signature.findFirst({
          where: {
            userId: scope.userId,
            isDeleted: false,
            status: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (newDefault) {
          await tx.signature.update({
            where: { id: newDefault.id },
            data: { markAsDefault: true },
          });
        }
      }

      return deleted;
    });

    res.status(200).json({
      success: true,
      message: 'Signature deleted successfully',
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;

    console.error('Signature deletion error:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting signature',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function setAsDefaultSignature(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { signatureId } = req.params as { signatureId: string };
    const { markAsDefault } = req.body as { markAsDefault?: unknown };

    if (typeof markAsDefault !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'markAsDefault must be a boolean value',
      });
      return;
    }

    const existing = await prisma.signature.findFirst({
      where: { ...scope, id: signatureId },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Signature not found or you do not have permission',
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (markAsDefault) {
        // Demote every other default signature for this user.
        await tx.signature.updateMany({
          where: {
            userId: scope.userId,
            markAsDefault: true,
            id: { not: existing.id },
          },
          data: { markAsDefault: false },
        });

        return tx.signature.update({
          where: { id: existing.id },
          data: { markAsDefault: true, status: true },
        });
      }

      return tx.signature.update({
        where: { id: existing.id },
        data: { markAsDefault: false },
      });
    });

    res.status(200).json({
      success: true,
      message: markAsDefault
        ? 'Signature set as default successfully'
        : 'Signature removed as default successfully',
      data: {
        id: updated.id,
        signatureName: updated.signatureName,
        markAsDefault: updated.markAsDefault,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;

    console.error('Set default signature error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating signature status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateSignatureStatus(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { signatureId } = req.params as { signatureId: string };
    const { status } = req.body as { status?: unknown };

    if (typeof status !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Status must be a boolean value',
      });
      return;
    }

    const existing = await prisma.signature.findFirst({
      where: { ...scope, id: signatureId },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Signature not found or you dont have permission',
      });
      return;
    }

    const wasDefault = existing.markAsDefault;

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.signature.update({
        where: { id: existing.id },
        data: {
          status,
          // If disabling, also unset as default.
          ...(status === false ? { markAsDefault: false } : {}),
        },
      });

      // If the just-disabled signature WAS the default, promote a replacement.
      if (status === false && wasDefault) {
        const newDefault = await tx.signature.findFirst({
          where: {
            userId: scope.userId,
            isDeleted: false,
            status: true,
            id: { not: existing.id },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (newDefault) {
          await tx.signature.update({
            where: { id: newDefault.id },
            data: { markAsDefault: true },
          });
        }
      }

      return next;
    });

    res.status(200).json({
      success: true,
      message: 'Signature status updated successfully',
      data: {
        id: updated.id,
        signatureName: updated.signatureName,
        status: updated.status,
        markAsDefault: updated.markAsDefault,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;

    console.error('Update signature status error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating signature status',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function createPaymentMode(req: Request, res: Response): Promise<void> {
  try {
    const { name } = req.body as { name?: string };

    if (!name || typeof name !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Payment mode name is required',
      });
      return;
    }

    const existingPaymentMode = await prisma.paymentMode.findUnique({
      where: { name },
    });

    if (existingPaymentMode) {
      res.status(400).json({
        success: false,
        message: 'Payment mode with this name already exists',
      });
      return;
    }

    const paymentMode = await prisma.paymentMode.create({
      data: {
        name,
        slug: slugify(name),
      },
    });

    res.status(201).json({
      success: true,
      message: 'Payment mode created successfully',
      data: {
        id: paymentMode.id,
        name: paymentMode.name,
        createdAt: paymentMode.createdAt,
        updatedAt: paymentMode.updatedAt,
      },
    });
  } catch (err) {
    console.error('Payment mode creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating payment mode',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listPaymentModes(_req: Request, res: Response): Promise<void> {
  try {
    const paymentModes = await prisma.paymentMode.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      message: 'Payment modes retrieved successfully',
      data: paymentModes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        slug: mode.slug,
        createdAt: mode.createdAt,
        updatedAt: mode.updatedAt,
      })),
    });
  } catch (err) {
    console.error('Error fetching payment modes:', err);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payment modes',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Silence unused-import warning when only the namespace import is referenced.
void ({} as Signature);

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createSignature,
  getUserSignatures,
  updateSignature,
  deleteSignature,
  setAsDefaultSignature,
  updateSignatureStatus,
  createPaymentMode,
  listPaymentModes,
};
module.exports.createSignature = createSignature;
module.exports.getUserSignatures = getUserSignatures;
module.exports.updateSignature = updateSignature;
module.exports.deleteSignature = deleteSignature;
module.exports.setAsDefaultSignature = setAsDefaultSignature;
module.exports.updateSignatureStatus = updateSignatureStatus;
module.exports.createPaymentMode = createPaymentMode;
module.exports.listPaymentModes = listPaymentModes;
