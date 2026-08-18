import type { Request, Response } from 'express';
import type { FieldTypeStatus } from '@prisma/client';

import { prisma } from '../lib/prisma';

// FieldType is a global lookup table — no userId column, so tenantScope()
// does not apply.

// Create field type
export async function createFieldType(req: Request, res: Response): Promise<void> {
  try {
    const { name, slug, status } = req.body as {
      name?: string;
      slug?: string;
      status?: FieldTypeStatus;
    };

    const existing = await prisma.fieldType.findUnique({ where: { slug: slug as string } });

    if (existing) {
      res.status(409).json({
        success: false,
        message: 'Field type already exists',
      });
      return;
    }

    const type = await prisma.fieldType.create({
      data: {
        name: name as string,
        slug: slug as string,
        ...(status ? { status } : {}),
      },
    });

    res.status(201).json({
      success: true,
      message: 'Field type created successfully',
      data: type,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error creating field type',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Get field types
export async function getFieldTypes(_req: Request, res: Response): Promise<void> {
  try {
    const types = await prisma.fieldType.findMany({
      where: { status: 'Active' },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: types,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error fetching field types',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createFieldType,
  getFieldTypes,
};
module.exports.createFieldType = createFieldType;
module.exports.getFieldTypes = getFieldTypes;
