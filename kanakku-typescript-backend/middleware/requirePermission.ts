import type { Request, Response, NextFunction, RequestHandler } from 'express';

export type PermAction = 'view' | 'create' | 'edit' | 'delete';
export interface PermCheck { moduleSlug: string; action: PermAction }

/**
 * Gate a route by the caller's role permission for a module + action.
 * Allows when the module's `allowAll` or the specific action flag is true.
 * Relies on req.actor populated by `protect`. No user_type is consulted —
 * the Owner passes because the Owner role grants allowAll on every module.
 *
 * `moduleSlug` may be:
 *  - a single string (the original single-module form), or
 *  - a string[] — grants access if the actor has the SAME `action` on ANY
 *    ONE of the listed modules. Use this for shared reference-data endpoints
 *    (e.g. tax groups, a "bill from" user picker) that several document
 *    types legitimately need, instead of gating on a single module (e.g.
 *    Settings) that has nothing to do with the feature actually calling it
 *    — that mismatch previously forced admins to grant broad Settings
 *    access just so staff could use Invoices.
 *  - a PermCheck[] (`{moduleSlug, action}` pairs) — grants access if the
 *    actor passes ANY ONE check, each with its OWN action. Use this when the
 *    "OR" alternatives need different actions (e.g. the original check
 *    requires `general-settings:create`, but any document-editing role
 *    should also be let through via that document module's `edit`).
 */
export function requirePermission(moduleSlug: string, action: PermAction): RequestHandler;
export function requirePermission(moduleSlug: string[], action: PermAction): RequestHandler;
export function requirePermission(checks: PermCheck[]): RequestHandler;
export function requirePermission(
  moduleSlug: string | string[] | PermCheck[],
  action?: PermAction,
): RequestHandler {
  const checks: PermCheck[] = Array.isArray(moduleSlug)
    ? (typeof moduleSlug[0] === 'string'
      ? (moduleSlug as string[]).map((slug) => ({ moduleSlug: slug, action: action! }))
      : (moduleSlug as PermCheck[]))
    : [{ moduleSlug, action: action! }];

  return (req: Request, res: Response, next: NextFunction): void => {
    for (const c of checks) {
      const p = req.actor?.perms.get(c.moduleSlug);
      if (p && (p.allowAll || p[c.action])) {
        next();
        return;
      }
    }
    res.status(403).json({ success: false, message: 'Permission denied' });
  };
}

// CommonJS interop for legacy JS route files.
module.exports = { requirePermission };
module.exports.requirePermission = requirePermission;
