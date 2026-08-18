import jwt from 'jsonwebtoken';

const JWT_EXPIRES_IN = '7d';

/**
 * Signs a session token. `tenantId` (the company-owner id the user belongs to,
 * i.e. `ownerId ?? id`) is embedded so requests resolve the shared-workspace
 * scope without a DB lookup. Defaults to `userId` when omitted (the user is
 * their own tenant — the company owner).
 */
export function generateToken(userId: string, tenantId?: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set in the environment.');
  }
  return jwt.sign(
    { id: userId, tenantId: tenantId ?? userId },
    secret,
    { expiresIn: JWT_EXPIRES_IN },
  );
}
