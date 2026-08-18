import type { AiProviderKind, Prisma } from '@prisma/client';

import { prisma } from './prisma';

/**
 * Per-call AI usage logging (Cluster H, slice H.4).
 *
 * `logAiUsage` records a single billable AI interaction (a bill scan or a
 * chat turn) into `AiUsageLog`. It powers the usage chart on the settings
 * page and the daily rate-limit middleware.
 *
 * Best-effort: a failure here MUST NOT fail the request that triggered it.
 * Usage logging is observability, not a hard dependency — so every error is
 * swallowed (and logged) rather than propagated.
 */

export interface LogAiUsageArgs {
  userId: string;
  feature: 'extraction' | 'chat' | (string & {});
  provider: AiProviderKind;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}

function toDecimal(n: number): Prisma.Decimal {
  // Matches the existing AI controllers — Prisma accepts a number here.
  return n as unknown as Prisma.Decimal;
}

export async function logAiUsage(args: LogAiUsageArgs): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        userId: args.userId,
        feature: args.feature,
        provider: args.provider,
        model: args.model ?? null,
        inputTokens: args.inputTokens ?? null,
        outputTokens: args.outputTokens ?? null,
        costUsd:
          args.costUsd != null && Number.isFinite(args.costUsd)
            ? toDecimal(args.costUsd)
            : null,
      },
    });
  } catch (err) {
    // Never let usage logging break the actual AI feature.
    console.error('logAiUsage failed (non-fatal):', err);
  }
}

module.exports = { logAiUsage };
module.exports.default = module.exports;
