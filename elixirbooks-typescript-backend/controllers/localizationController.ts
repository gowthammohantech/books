import type { Request, Response } from 'express';
import { Prisma, LocalizationStartWeek } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

// Localization is per-user (Localization.userId → User), but legacy routes
// vary: `getDropdownOptions` reads the active row scoped to the calling
// user, while `saveLocalization`/`getLocalization` operate on a single
// global "isActive: true" row regardless of user. We preserve that mixed
// behaviour verbatim.

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function parseStartWeek(value: unknown): LocalizationStartWeek | undefined {
  if (typeof value !== 'string') return undefined;
  if ((Object.values(LocalizationStartWeek) as string[]).includes(value)) {
    return value as LocalizationStartWeek;
  }
  return undefined;
}

export async function getDropdownOptions(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const [localization, dateFormats, timeFormats, timezones] = await Promise.all([
      prisma.localization.findFirst({
        where: { userId, isActive: true },
        include: {
          dateFormat: { select: { id: true, title: true, format: true } },
          timeFormat: { select: { id: true, name: true, format: true } },
          timezone: { select: { id: true, name: true, utc_offset: true } },
        },
      }),

      prisma.dateFormat.findMany({
        where: { isActive: true, isDeleted: false },
        select: { id: true, title: true, format: true },
        orderBy: { title: 'asc' },
      }),

      prisma.timeFormat.findMany({
        where: { isActive: true, isDeleted: false },
        select: { id: true, name: true, format: true },
        orderBy: { name: 'asc' },
      }),

      prisma.timezone.findMany({
        select: { id: true, name: true, utc_offset: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Localization and dropdown options retrieved successfully',
      data: {
        settings: localization
          ? {
              dateFormat: {
                id: localization.dateFormat.id,
                title: localization.dateFormat.title,
                format: localization.dateFormat.format,
              },
              timeFormat: {
                id: localization.timeFormat.id,
                name: localization.timeFormat.name,
                format: localization.timeFormat.format,
              },
              timezone: {
                id: localization.timezone.id,
                name: localization.timezone.name,
                offset: localization.timezone.utc_offset,
              },
              startWeek: localization.startWeek,
            }
          : null,

        dateFormats: dateFormats.map((format) => ({
          id: format.id,
          title: format.title,
          format: format.format,
        })),
        timeFormats: timeFormats.map((format) => ({
          id: format.id,
          name: format.name,
          format: format.format,
        })),
        timezones: timezones.map((zone) => ({
          id: zone.id,
          name: zone.name,
          offset: zone.utc_offset,
        })),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching localization & dropdowns:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching localization and dropdown options',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function getSettingsDropdownList(_req: Request, res: Response): Promise<void> {
  try {
    const [timezones, dateFormats, currencies] = await Promise.all([
      prisma.timezone.findMany({
        select: { id: true, name: true, utc_offset: true },
        orderBy: { name: 'asc' },
      }),
      prisma.dateFormat.findMany({
        where: { isActive: true, isDeleted: false },
        select: { id: true, title: true, format: true },
        orderBy: { title: 'asc' },
      }),
      prisma.currency.findMany({
        where: { isDeleted: false, status: true },
        select: { id: true, name: true, code: true, symbol: true, isDefault: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Timezone, Date Format, and Currency lists retrieved successfully',
      data: {
        timezones: timezones.map((zone) => ({
          id: zone.id,
          name: zone.name,
          offset: zone.utc_offset,
        })),
        dateFormats: dateFormats.map((fmt) => ({
          id: fmt.id,
          title: fmt.title,
          format: fmt.format,
        })),
        currencies: currencies.map((curr) => ({
          id: curr.id,
          name: curr.name,
          code: curr.code,
          symbol: curr.symbol,
          isDefault: curr.isDefault,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching dropdown settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load dropdown settings',
      error:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : String(error)
          : 'Internal Server Error',
    });
  }
}

export async function saveLocalization(req: Request, res: Response): Promise<void> {
  try {
    const { dateFormatId, timeFormatId, timezoneId, startWeek } = req.body as {
      dateFormatId?: string;
      timeFormatId?: string;
      timezoneId?: string;
      startWeek?: string;
    };

    const startWeekEnum = parseStartWeek(startWeek);

    const existing = await prisma.localization.findFirst({
      where: { isActive: true },
    });

    if (existing) {
      const data: Prisma.LocalizationUpdateInput = {
        dateFormat: { connect: { id: dateFormatId as string } },
        timeFormat: { connect: { id: timeFormatId as string } },
        timezone: { connect: { id: timezoneId as string } },
      };
      if (startWeekEnum) {
        data.startWeek = startWeekEnum;
      }

      const updated = await prisma.localization.update({
        where: { id: existing.id },
        data,
      });

      res.status(200).json({
        success: true,
        message: 'Localization settings updated successfully',
        data: updated,
      });
      return;
    }

    const created = await prisma.localization.create({
      data: {
        dateFormat: { connect: { id: dateFormatId as string } },
        timeFormat: { connect: { id: timeFormatId as string } },
        timezone: { connect: { id: timezoneId as string } },
        startWeek: startWeekEnum ?? LocalizationStartWeek.Monday,
        isActive: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Localization settings saved successfully',
      data: created,
    });
  } catch (err) {
    console.error('Error saving localization:', err);
    res.status(500).json({
      success: false,
      message: 'Error saving localization settings',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getLocalization(_req: Request, res: Response): Promise<void> {
  try {
    const localization = await prisma.localization.findFirst({
      where: { isActive: true },
      include: {
        dateFormat: { select: { id: true, title: true, format: true } },
        timeFormat: { select: { id: true, name: true, format: true } },
        timezone: { select: { id: true, name: true, utc_offset: true } },
      },
    });

    if (!localization) {
      res.status(404).json({
        success: false,
        message: 'No localization settings found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Localization settings retrieved successfully',
      data: {
        dateFormat: {
          id: localization.dateFormat.id,
          title: localization.dateFormat.title,
          format: localization.dateFormat.format,
        },
        timeFormat: {
          id: localization.timeFormat.id,
          name: localization.timeFormat.name,
          format: localization.timeFormat.format,
        },
        timezone: {
          id: localization.timezone.id,
          name: localization.timezone.name,
          offset: localization.timezone.utc_offset,
        },
        startWeek: localization.startWeek,
      },
    });
  } catch (err) {
    console.error('Error fetching localization:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching localization settings',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  saveLocalization,
  getLocalization,
  getDropdownOptions,
  getSettingsDropdownList,
};
module.exports.saveLocalization = saveLocalization;
module.exports.getLocalization = getLocalization;
module.exports.getDropdownOptions = getDropdownOptions;
module.exports.getSettingsDropdownList = getSettingsDropdownList;
