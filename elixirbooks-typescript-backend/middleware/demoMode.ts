import type { Request, Response, NextFunction } from 'express';

// Demo mode guard.
//
// When DEMO_MODE=true (set in the environment) the app runs as a shared,
// read-only public demo. To stop visitors from wrecking the demo for the next
// person, all SETTINGS / CONFIGURATION mutations are rejected with 403.
//
// Business transactions (invoices, customers, quotations, purchases, etc.) are
// intentionally left writable so people can still try the product end-to-end —
// only the persistent configuration is frozen.

export const isDemoMode = (): boolean => process.env.DEMO_MODE === 'true';

// Path prefixes (relative to the /api/admin mount) treated as
// settings/configuration. A request is blocked when its path equals one of
// these or starts with "<prefix>/".
const SETTINGS_WRITE_PREFIXES: string[] = [
  '/profile',
  '/tax-rates',
  '/tax-groups',
  '/signatures',
  '/paymentmode',
  '/currency',
  '/bank-accounts',
  '/company-details',
  '/company/setup',
  '/create-general-settings',
  '/document-defaults',
  '/gateway-configs',
  '/localizations',
  '/email-settings',
  '/email-template',
  '/staff',
  '/roles',
  '/security',
  '/accounting-integrations',
  '/messaging',
  '/ai/config',
];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const isSettingsWritePath = (path: string): boolean =>
  SETTINGS_WRITE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

// Express middleware. Mount on the /api/admin router so req.path is relative to
// that mount (e.g. "/profile", "/tax-rates/123").
export const blockSettingsWriteInDemo = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (isDemoMode() && MUTATING_METHODS.has(req.method) && isSettingsWritePath(req.path)) {
    res.status(403).json({
      success: false,
      demo: true,
      message: 'This is a read-only demo — settings changes are disabled.',
    });
    return;
  }
  next();
};

// CommonJS interop for server.js (require()).
module.exports = { isDemoMode, blockSettingsWriteInDemo };
module.exports.isDemoMode = isDemoMode;
module.exports.blockSettingsWriteInDemo = blockSettingsWriteInDemo;
