// Augments Express's Request type so `req.user` (set by authMiddleware) is
// typed. Today it's just the user's UUID string. After full conversion this
// could be widened to a Prisma user shape.
import 'express';

declare global {
  namespace Express {
    interface ActorPerm {
      view: boolean;
      create: boolean;
      edit: boolean;
      delete: boolean;
      allowAll: boolean;
    }
    interface Actor {
      userId: string;
      tenantId: string;
      roleId: string | null;
      roleName: string | null;
      isOwner: boolean;
      perms: Map<string, ActorPerm>;
    }
    interface Request {
      // The JWT subject: the individual logged-in user's id. Use for identity
      // / self-account ops only (see lib/tenantScope.requireActingUserId).
      user?: string;
      // The company-owner id (`ownerId ?? id`) the user belongs to, resolved by
      // authMiddleware.protect. Use this for data scoping so every staff/admin
      // in a company shares one dataset (see lib/tenantScope.requireUserId).
      tenantId?: string;
      // Resolved caller identity + role permissions. Set by protect() after
      // JWT verification. Use req.actor.perms for permission checks.
      actor?: Actor;
    }
  }
}

export {};
