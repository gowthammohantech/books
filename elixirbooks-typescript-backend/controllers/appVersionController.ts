import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';

const APP_VERSION = process.env.APP_VERSION || '1.0.4';

export async function getAppVersionStatus(_req: Request, res: Response): Promise<void> {
  try {
    const companySettingsCount = await prisma.companySettings.count();
    const hasCompanySettings = companySettingsCount === 0; // true if no company settings exist

    const adminUserCount = await prisma.user.count({ where: { user_type: 1 } });
    const isNewRegister = adminUserCount === 0; // true if no user exists

    res.status(200).json({
      success: true,
      message: 'App version fetched successfully',
      data: {
        version: APP_VERSION,
        new_register: isNewRegister,
        company_settings: hasCompanySettings,
      },
    });
  } catch (error) {
    console.error('App version check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = { getAppVersionStatus };
module.exports.getAppVersionStatus = getAppVersionStatus;
