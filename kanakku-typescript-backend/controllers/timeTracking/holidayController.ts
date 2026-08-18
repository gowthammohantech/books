// controllers/timeTracking/holidayController.ts
// Time Tracking — Phase C (Task 3): company holiday calendar.
//
// Endpoints (all tenant-scoped via requireUserId; tenant = ownerId ?? id):
//   GET    /holidays            time-tracking,view
//   POST   /holidays            time-tracking-others,create   { name, date, recurringYearly? }
//   PUT    /holidays/:id        time-tracking-others,edit
//   DELETE /holidays/:id        time-tracking-others,delete
//
// Unique per (tenant, date): a duplicate date -> 409.
// Follows the projectMemberController patterns: response envelope `{ success, data }`,
// P2002 -> 409, UnauthorizedError -> handleUnauthorized.

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

/** Parse a date-only string to UTC midnight, or undefined. */
function parseUtcDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** GET /holidays */
export async function listHolidays(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const holidays = await prisma.holiday.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
    });
    res.json({ success: true, data: { holidays } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listHolidays error:', err);
    res.status(500).json({ success: false, message: 'Failed to list holidays' });
  }
}

/** POST /holidays — { name, date, recurringYearly? } */
export async function createHoliday(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { name, date, recurringYearly } = req.body as {
      name?: string;
      date?: string;
      recurringYearly?: boolean;
    };

    const parsedDate = parseUtcDate(date);
    if (!name || !parsedDate) {
      res.status(400).json({ success: false, message: 'name and a valid date are required' });
      return;
    }

    const holiday = await prisma.holiday.create({
      data: {
        userId,
        name,
        date: parsedDate,
        recurringYearly: recurringYearly ?? false,
      },
    });

    res.status(201).json({ success: true, data: { holiday } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'A holiday already exists for this date' });
      return;
    }
    console.error('createHoliday error:', err);
    res.status(500).json({ success: false, message: 'Failed to create holiday' });
  }
}

/** PUT /holidays/:id — { name?, date?, recurringYearly? } */
export async function updateHoliday(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.holiday.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Holiday not found' });
      return;
    }

    const { name, date, recurringYearly } = req.body as {
      name?: string;
      date?: string;
      recurringYearly?: boolean;
    };

    const parsedDate = date !== undefined ? parseUtcDate(date) : undefined;
    if (date !== undefined && !parsedDate) {
      res.status(400).json({ success: false, message: 'date must be a valid date' });
      return;
    }

    if (name === undefined && parsedDate === undefined && recurringYearly === undefined) {
      res.status(400).json({ success: false, message: 'At least one field required' });
      return;
    }

    const holiday = await prisma.holiday.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(parsedDate !== undefined && { date: parsedDate }),
        ...(recurringYearly !== undefined && { recurringYearly }),
      },
    });

    res.json({ success: true, data: { holiday } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'A holiday already exists for this date' });
      return;
    }
    console.error('updateHoliday error:', err);
    res.status(500).json({ success: false, message: 'Failed to update holiday' });
  }
}

/** DELETE /holidays/:id */
export async function deleteHoliday(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.holiday.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Holiday not found' });
      return;
    }

    await prisma.holiday.delete({ where: { id } });
    res.json({ success: true, message: 'Holiday removed' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('deleteHoliday error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove holiday' });
  }
}

// CommonJS interop for legacy JS route files.
module.exports = { listHolidays, createHoliday, updateHoliday, deleteHoliday };
module.exports.listHolidays = listHolidays;
module.exports.createHoliday = createHoliday;
module.exports.updateHoliday = updateHoliday;
module.exports.deleteHoliday = deleteHoliday;
