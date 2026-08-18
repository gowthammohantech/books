import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

/**
 * AI usage reporting controller (Cluster H, slice H.4).
 *
 * `getUsage` powers the per-day bar chart on the settings page; `getUsageSummary`
 * powers the headline cards (calls last 24h / this month / cost this month).
 *
 * Aggregation is done in JS over a bounded window (a single user's logs over
 * at most ~90 days) rather than via raw SQL — it keeps the query database-
 * agnostic and avoids hand-rolled date_trunc.
 */

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function dayKey(d: Date): string {
  // Local-time YYYY-MM-DD so the chart buckets match the user's calendar day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getUsage(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const now = new Date();
    const to = parseDate(req.query.to) ?? now;
    // Default window: last 30 days (inclusive of today).
    const defaultFrom = new Date(to);
    defaultFrom.setDate(defaultFrom.getDate() - 29);
    defaultFrom.setHours(0, 0, 0, 0);
    const from = parseDate(req.query.from) ?? defaultFrom;

    // Normalise to full-day bounds so the period is inclusive on both ends.
    const fromBound = new Date(from);
    fromBound.setHours(0, 0, 0, 0);
    const toBound = new Date(to);
    toBound.setHours(23, 59, 59, 999);

    const rows = await prisma.aiUsageLog.findMany({
      where: { userId, createdAt: { gte: fromBound, lte: toBound } },
      select: { feature: true, costUsd: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Pre-seed every day in the range so the chart shows a continuous axis
    // (zero-bars for idle days) instead of collapsing gaps.
    const buckets = new Map<
      string,
      { date: string; callsExtraction: number; callsChat: number; totalCostUsd: number }
    >();
    const cursor = new Date(fromBound);
    while (cursor <= toBound) {
      const key = dayKey(cursor);
      buckets.set(key, { date: key, callsExtraction: 0, callsChat: 0, totalCostUsd: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const row of rows) {
      const key = dayKey(row.createdAt);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      if (row.feature === 'extraction') bucket.callsExtraction += 1;
      else if (row.feature === 'chat') bucket.callsChat += 1;
      bucket.totalCostUsd += row.costUsd ? Number(row.costUsd) : 0;
    }

    const series = Array.from(buckets.values()).map((b) => ({
      ...b,
      totalCostUsd: Math.round((b.totalCostUsd + Number.EPSILON) * 1_000_000) / 1_000_000,
    }));

    res.json({
      success: true,
      data: {
        from: dayKey(fromBound),
        to: dayKey(toBound),
        usage: series,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiUsage.getUsage error:', err);
    res.status(500).json({ success: false, message: 'Failed to load AI usage' });
  }
}

export async function getUsageSummary(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const monthStart = startOfMonth(now);

    const [callsLast24h, callsThisMonth, monthAgg] = await Promise.all([
      prisma.aiUsageLog.count({
        where: { userId, createdAt: { gte: since24h } },
      }),
      prisma.aiUsageLog.count({
        where: { userId, createdAt: { gte: monthStart } },
      }),
      prisma.aiUsageLog.aggregate({
        where: { userId, createdAt: { gte: monthStart } },
        _sum: { costUsd: true },
      }),
    ]);

    const totalCostThisMonth = monthAgg._sum.costUsd
      ? Number(monthAgg._sum.costUsd)
      : 0;

    res.json({
      success: true,
      data: {
        summary: {
          callsLast24h,
          callsThisMonth,
          totalCostThisMonth:
            Math.round((totalCostThisMonth + Number.EPSILON) * 1_000_000) / 1_000_000,
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiUsage.getUsageSummary error:', err);
    res.status(500).json({ success: false, message: 'Failed to load AI usage summary' });
  }
}

const handlers = { getUsage, getUsageSummary };
module.exports = handlers;
module.exports.default = handlers;
