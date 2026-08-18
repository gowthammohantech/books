import type { Request, Response } from 'express';
import type { Vehicle, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { tenantScope, requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';


interface VehicleResponse {
  id: string;
  customerId: string | null;
  customerName: string | null;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  registrationNumber: string | null;
  vin: string | null;
  mileage: number | null;
  notes: string | null;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type VehicleContact = Parameters<typeof resolveDisplayName>[0] & { id: string };
type VehicleWithCustomer = Vehicle & {
  customer: { id: string; name: string } | null;
  // Unified-contact-linked vehicles leave the legacy `customer` null, so the
  // party must resolve contact-first — otherwise the UI rendered a blank
  // customer name ("Deleted User").
  contact?: VehicleContact | null;
};

function formatVehicle(v: VehicleWithCustomer): VehicleResponse {
  return {
    id: v.id,
    customerId: v.customerId,
    customerName: (v.contact ? resolveDisplayName(v.contact) : '') || v.customer?.name || null,
    name: v.name,
    make: v.make,
    model: v.model,
    year: v.year,
    registrationNumber: v.registrationNumber,
    vin: v.vin,
    mileage: v.mileage,
    notes: v.notes,
    status: v.status,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export async function getAllVehicles(req: Request, res: Response): Promise<void> {
  try {
    requireUserId(req); // throws UnauthorizedError if no user
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)));
    const search = ((req.query.search as string) ?? '').trim();
    const customerIdFilter = (req.query.customerId as string) ?? undefined;
    const statusFilter = (req.query.status as string) ?? undefined;

    const where: Prisma.VehicleWhereInput = { ...tenantScope(req) };
    if (customerIdFilter) where.customerId = customerIdFilter;
    if (statusFilter === 'true' || statusFilter === 'false') where.status = statusFilter === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { registrationNumber: { contains: search, mode: 'insensitive' } },
        { vin: { contains: search, mode: 'insensitive' } },
        { make: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              organisation: true,
              email: true,
              mobile: true,
              telephone: true,
              image: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.vehicle.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        vehicles: rows.map(formatVehicle),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getAllVehicles error:', err);
    res.status(500).json({ success: false, message: 'Failed to list vehicles' });
  }
}

// Non-paginated list used by the invoice form dropdown.
export async function getVehiclesForCustomer(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { customerId } = req.params as { customerId: string };

    const rows = await prisma.vehicle.findMany({
      where: { customerId, userId, isDeleted: false, status: true },
      include: {
        customer: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: { vehicles: rows.map(formatVehicle) },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getVehiclesForCustomer error:', err);
    res.status(500).json({ success: false, message: 'Failed to list customer vehicles' });
  }
}

export async function getVehicleById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const row = await prisma.vehicle.findFirst({
      where: { id, userId, isDeleted: false },
      include: {
        customer: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          },
        },
      },
    });

    if (!row) {
      res.status(404).json({ success: false, message: 'Vehicle not found' });
      return;
    }
    res.json({ success: true, data: { vehicle: { ...formatVehicle(row) } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getVehicleById error:', err);
    res.status(500).json({ success: false, message: 'Failed to load vehicle' });
  }
}

export async function createVehicle(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as Record<string, unknown>;

    const created = await prisma.vehicle.create({
      data: {
        customerId: body.customerId as string,
        name: (body.name as string | undefined) ?? null,
        make: (body.make as string | undefined) ?? null,
        model: (body.model as string | undefined) ?? null,
        year: body.year !== undefined && body.year !== null ? Number(body.year) : null,
        registrationNumber: (body.registrationNumber as string | undefined) ?? null,
        vin: (body.vin as string | undefined) ?? null,
        mileage: body.mileage !== undefined && body.mileage !== null ? Number(body.mileage) : null,
        notes: (body.notes as string | undefined) ?? null,
        status: body.status === undefined ? true : body.status === true || body.status === 'true',
        userId,
      },
      include: {
        customer: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Vehicle created',
      data: { vehicle: { ...formatVehicle(created) } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('createVehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to create vehicle' });
  }
}

export async function updateVehicle(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.vehicle.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Vehicle not found' });
      return;
    }

    const data: Prisma.VehicleUpdateInput = {};
    if (body.customerId !== undefined) data.customer = { connect: { id: body.customerId as string } };
    if (body.name !== undefined) data.name = (body.name as string | null) ?? null;
    if (body.make !== undefined) data.make = (body.make as string | null) ?? null;
    if (body.model !== undefined) data.model = (body.model as string | null) ?? null;
    if (body.year !== undefined) data.year = body.year === null ? null : Number(body.year);
    if (body.registrationNumber !== undefined) data.registrationNumber = (body.registrationNumber as string | null) ?? null;
    if (body.vin !== undefined) data.vin = (body.vin as string | null) ?? null;
    if (body.mileage !== undefined) data.mileage = body.mileage === null ? null : Number(body.mileage);
    if (body.notes !== undefined) data.notes = (body.notes as string | null) ?? null;
    if (body.status !== undefined) data.status = body.status === true || body.status === 'true';

    const updated = await prisma.vehicle.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          },
        },
      },
    });

    res.json({
      success: true,
      message: 'Vehicle updated',
      data: { vehicle: { ...formatVehicle(updated) } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('updateVehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to update vehicle' });
  }
}

export async function deleteVehicle(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.vehicle.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Vehicle not found' });
      return;
    }

    await prisma.vehicle.update({ where: { id }, data: { isDeleted: true } });
    res.json({ success: true, message: 'Vehicle deleted' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('deleteVehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete vehicle' });
  }
}

// CommonJS interop for adminRoutes.js which uses `require(...)`.
const handlers = {
  getAllVehicles,
  getVehiclesForCustomer,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
};
module.exports = handlers;
module.exports.default = handlers;
