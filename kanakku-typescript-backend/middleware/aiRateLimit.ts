import type { NextFunction, Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { requireUserId } from '../lib/tenantScope';

/**
 * Daily AI call quota (Cluster H, slice H.4).
 *
 * Counts the user's `AiUsageLog` rows over a rolling 24h window. When the
 * count reaches `AI_MAX_CALLS_PER_DAY` (default 200), the request is rejected
 * with HTTP 429 and a `retryAfter` (seconds until the oldest in-window log
 * ages out, freeing a slot).
 *
 * Applied AFTER `requireAiEnabled` so disabled accounts still get the clean
 * 412 rather than a quota error.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

function maxCallsPerDay(): number {
  const raw = process.env.AI_MAX_CALLS_PER_DAY;
  const n = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export async function aiRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const limit = maxCallsPerDay();
    const windowStart = new Date(Date.now() - WINDOW_MS);

    const count = await prisma.aiUsageLog.count({
      where: { userId, createdAt: { gte: windowStart } },
    });

    if (count >= limit) {
      // Time until the oldest in-window call ages out and frees a slot.
      const oldest = await prisma.aiUsageLog.findFirst({
        where: { userId, createdAt: { gte: windowStart } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const retryAfter = oldest
        ? Math.max(
            1,
            Math.ceil(
              (oldest.createdAt.getTime() + WINDOW_MS - Date.now()) / 1000,
            ),
          )
        : Math.ceil(WINDOW_MS / 1000);

      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        error: 'Daily AI quota exceeded',
        message: `You have reached the daily limit of ${limit} AI calls. Try again later.`,
        retryAfter,
      });
      return;
    }

    next();
  } catch (err) {
    // A counting failure should not hard-block AI usage — fail open and let
    // the downstream handler run (it has its own error handling).
    console.error('aiRateLimit error (failing open):', err);
    next();
  }
}

// CommonJS interop so the .js admin routes file can require this.
module.exports = aiRateLimit;
module.exports.aiRateLimit = aiRateLimit;
module.exports.default = aiRateLimit;
