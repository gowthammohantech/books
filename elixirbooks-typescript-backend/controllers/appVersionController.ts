/* @cross-tenant: the unauthenticated boot probe. It answers platform-level
 * questions only — build version, whether signup is open, whether the install
 * is empty — and reads no tenant-owned data. Everything per-workspace moved to
 * GET /api/auth/session, which is behind auth. */
import type { Request, Response } from 'express';

import { prismaUnscoped } from '../lib/prisma';
import { signupsEnabled } from './authController';

const APP_VERSION = process.env.APP_VERSION || '1.0.4';

/**
 * GET /api/admin/app-version — the unauthenticated boot probe.
 *
 * This used to answer an INSTALL-WIDE question so the SPA could pick one of
 * three whole route trees: `new_register` counted every user_type:1 user on the
 * box, and `company_settings` counted every CompanySettings row. Neither
 * question has an answer once more than one company exists — "has the admin
 * registered?" is meaningless when there are fifty admins — and both were
 * readable without authenticating.
 *
 * What replaces them is GET /api/auth/session, which asks the same things per
 * session and behind auth. This endpoint keeps only what is genuinely
 * platform-level: the build version, and whether signup is open.
 *
 * `new_register` and `company_settings` are still emitted, deliberately, for
 * ONE release: a browser holding a cached copy of the old SPA bundle reads them
 * on boot, and dropping them would white-screen those tabs until a hard reload.
 * Both are pinned to the values that make that old bundle mount the normal
 * route tree, and both go away with the P8 frontend.
 */
export async function getAppVersionStatus(_req: Request, res: Response): Promise<void> {
  try {
    // Unscoped and unauthenticated: there is no session here, so there is no
    // tenant to scope by. It reads one count and no tenant-owned data.
    const tenantCount = await prismaUnscoped.tenant.count({ where: { deletedAt: null } });

    res.status(200).json({
      success: true,
      message: 'App version fetched successfully',
      data: {
        version: APP_VERSION,
        signupsEnabled: signupsEnabled(),
        // True only on a genuinely empty install, where /register is the one
        // sensible destination for anybody arriving.
        isFreshInstall: tenantCount === 0,

        // Deprecated compatibility fields — see the note above.
        new_register: tenantCount === 0,
        company_settings: false,
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
