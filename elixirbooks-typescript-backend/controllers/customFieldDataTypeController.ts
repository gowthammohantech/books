import type { Request, Response } from 'express';
import type { CustomFieldDataTypeKind } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  return false;
}

// Create a new custom field data type
export async function createCustomFieldDataType(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { type, description } = req.body as {
      type?: CustomFieldDataTypeKind;
      description?: string;
    };

    // Check if a custom field data type with the same type already exists
    const existingDataType = await prisma.customFieldDataType.findFirst({
      where: {
        type: type as CustomFieldDataTypeKind,
        isActive: true,
      },
    });

    if (existingDataType) {
      res.status(400).json({
        message: 'A custom field data type with this type already exists',
        error: 'DUPLICATE_TYPE',
      });
      return;
    }

    const savedCustomFieldDataType = await prisma.customFieldDataType.create({
      data: {
        type: type as CustomFieldDataTypeKind,
        description: description ?? null,
        createdBy: userId,
      },
    });

    res.status(201).json({
      message: 'Custom field data type created successfully',
      data: savedCustomFieldDataType,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error creating custom field data type:', err);
    res.status(500).json({
      message: 'Error creating custom field data type',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get all custom field data types
export async function getAllCustomFieldDataTypes(req: Request, res: Response): Promise<void> {
  try {
    const { search, isActive } = req.query as { search?: string; isActive?: string };
    const where: Prisma.CustomFieldDataTypeWhereInput = {};

    // Add search filter
    if (search) {
      where.OR = [
        // `type` is an enum — only `description` supports `contains`.
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add active status filter
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const customFieldDataTypes = await prisma.customFieldDataType.findMany({
      where,
      include: {
        createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { type: 'asc' },
    });

    res.json({
      data: customFieldDataTypes,
    });
  } catch (err) {
    console.error('Error fetching custom field data types:', err);
    res.status(500).json({
      message: 'Error fetching custom field data types',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get a specific custom field data type by ID
export async function getCustomFieldDataTypeById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const customFieldDataType = await prisma.customFieldDataType.findUnique({
      where: { id },
      include: {
        createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!customFieldDataType) {
      res.status(404).json({
        message: 'Custom field data type not found',
      });
      return;
    }

    res.json({
      data: customFieldDataType,
    });
  } catch (err) {
    console.error('Error fetching custom field data type:', err);
    res.status(500).json({
      message: 'Error fetching custom field data type',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Update a custom field data type
export async function updateCustomFieldDataType(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { type, description, isActive } = req.body as {
      type?: CustomFieldDataTypeKind;
      description?: string;
      isActive?: boolean;
    };

    // Check if custom field data type exists
    const existingDataType = await prisma.customFieldDataType.findUnique({ where: { id } });

    if (!existingDataType) {
      res.status(404).json({
        message: 'Custom field data type not found',
      });
      return;
    }

    // Check for duplicate type (excluding current data type)
    if (type && type !== existingDataType.type) {
      const duplicateDataType = await prisma.customFieldDataType.findFirst({
        where: {
          type,
          isActive: true,
          id: { not: id },
        },
      });

      if (duplicateDataType) {
        res.status(400).json({
          message: 'A custom field data type with this type already exists',
          error: 'DUPLICATE_TYPE',
        });
        return;
      }
    }

    const updateData: Prisma.CustomFieldDataTypeUpdateInput = {};
    if (type !== undefined) updateData.type = type;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedCustomFieldDataType = await prisma.customFieldDataType.update({
      where: { id },
      data: updateData,
      include: {
        createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    res.json({
      message: 'Custom field data type updated successfully',
      data: updatedCustomFieldDataType,
    });
  } catch (err) {
    console.error('Error updating custom field data type:', err);
    res.status(500).json({
      message: 'Error updating custom field data type',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Delete a custom field data type (soft delete by setting isActive to false)
export async function deleteCustomFieldDataType(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.customFieldDataType.findUnique({ where: { id } });

    if (!existing) {
      res.status(404).json({
        message: 'Custom field data type not found',
      });
      return;
    }

    await prisma.customFieldDataType.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({
      message: 'Custom field data type deleted successfully',
    });
  } catch (err) {
    console.error('Error deleting custom field data type:', err);
    res.status(500).json({
      message: 'Error deleting custom field data type',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get custom field data types for dropdown/select options
export async function getCustomFieldDataTypesMinimal(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const customFieldDataTypes = await prisma.customFieldDataType.findMany({
      where: { isActive: true },
      select: { id: true, type: true, description: true },
      orderBy: { type: 'asc' },
    });

    res.json({
      data: customFieldDataTypes,
    });
  } catch (err) {
    console.error('Error fetching custom field data types minimal:', err);
    res.status(500).json({
      message: 'Error fetching custom field data types',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createCustomFieldDataType,
  getAllCustomFieldDataTypes,
  getCustomFieldDataTypeById,
  updateCustomFieldDataType,
  deleteCustomFieldDataType,
  getCustomFieldDataTypesMinimal,
};
module.exports.createCustomFieldDataType = createCustomFieldDataType;
module.exports.getAllCustomFieldDataTypes = getAllCustomFieldDataTypes;
module.exports.getCustomFieldDataTypeById = getCustomFieldDataTypeById;
module.exports.updateCustomFieldDataType = updateCustomFieldDataType;
module.exports.deleteCustomFieldDataType = deleteCustomFieldDataType;
module.exports.getCustomFieldDataTypesMinimal = getCustomFieldDataTypesMinimal;
