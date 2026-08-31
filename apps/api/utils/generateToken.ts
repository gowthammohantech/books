import jwt from 'jsonwebtoken';

const JWT_EXPIRES_IN = '7d';

/** Bumped when the claim set changes. v1 tokens are still accepted — see below. */
export const TOKEN_VERSION = 2;

export interface TokenClaims {
  /** The JWT subject: the individual user. */
  id: string;
  /** The workspace this session is acting on. */
  tenantId: string;
  /** The TenantMembership binding the two. Lets protect() skip a lookup. */
  mid?: string;
  v: number;
}

/**
 * Signs a session token.
 *
 * THE CLAIM NAME `tenantId` IS DELIBERATELY UNCHANGED. It has always been
 * present (it used to hold `ownerId ?? id`, which is exactly the id P1 gave
 * tenant #1), so every token already in the wild names a real Tenant and keeps
 * resolving after P5 — deploying this does not log anyone out. The 585
 * frontend call sites pass the token through opaquely and need no change
 * either.
 *
 * `mid` is new in v2 and is only an optimisation: protect() re-verifies the
 * membership against the database on every request regardless, because a token
 * is a claim about the past and a revoked membership has to take effect now.
 *
 * `tenantId` defaults to `userId` for the one caller that mints a token for a
 * user who IS their own tenant (registration, where Tenant.id === User.id).
 */
export function generateToken(userId: string, tenantId?: string, membershipId?: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set in the environment.');
  }
  const claims: TokenClaims = {
    id: userId,
    tenantId: tenantId ?? userId,
    v: TOKEN_VERSION,
    ...(membershipId ? { mid: membershipId } : {}),
  };
  return jwt.sign(claims, secret, { expiresIn: JWT_EXPIRES_IN });
}
