import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { getAuditContext, type AuditContext } from './auditContext';
import { computeDiff, redactChanges, type Change } from './auditDiff';
import { resolveEntityLabel } from './auditLabels';

// Models we never audit: the log itself + high-volume / noisy tables.
export const DENYLIST = new Set<string>([
  'AuditLog',
  'AiUsageLog',
  'AiExtractionJob',
  'AiChatSession',
  'AiChatMessage',
  'LoginActivity',
]);

const WRITE_OPS = new Set([
  'create', 'createMany',
  'update', 'updateMany',
  'upsert',
  'delete', 'deleteMany',
]);

export function isAuditable(model: string | undefined, operation: string): boolean {
  if (!model || DENYLIST.has(model)) return false;
  return WRITE_OPS.has(operation);
}

function actionFor(operation: string): 'CREATE' | 'UPDATE' | 'DELETE' {
  if (operation.startsWith('create')) return 'CREATE';
  if (operation.startsWith('delete')) return 'DELETE';
  return 'UPDATE'; // update, updateMany, upsert
}

export interface BuildArgs {
  model: string;
  operation: string;
  ctx: AuditContext | undefined;
  before: Record<string, unknown> | null;
  result: any;
}

export interface AuditRecord {
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  changes: Change[] | null;
  affectedCount: number | null;
  userId: string | null;
  userName: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const isBulk = (op: string) => op.endsWith('Many');

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function buildAuditRecord({ model, operation, ctx, before, result }: BuildArgs): AuditRecord {
  const effectiveOperation =
    operation === 'upsert' && before == null ? 'create' : operation;
  const action = actionFor(effectiveOperation);
  const userName = ctx?.userName ?? 'system';
  const base = {
    entityType: model,
    userId: ctx?.userId ?? null,
    userName,
    ipAddress: ctx?.ipAddress ?? null,
    userAgent: ctx?.userAgent ?? null,
  };

  if (isBulk(operation)) {
    const count = typeof result?.count === 'number' ? result.count : null;
    const verb = action === 'DELETE' ? 'Deleted' : action === 'CREATE' ? 'Created' : 'Updated';
    return {
      ...base, action, entityId: null, entityLabel: null,
      affectedCount: count, changes: null,
      summary: `${verb} ${count ?? 'multiple'} ${model} records`,
    };
  }

  const record = (result ?? before ?? {}) as Record<string, unknown>;
  const entityId = record.id != null ? String(record.id) : null;
  const entityLabel = resolveEntityLabel(model, record);

  let changes: Change[] | null;
  if (action === 'CREATE') {
    changes = redactChanges(computeDiff(null, record));
  } else if (action === 'DELETE') {
    changes = redactChanges(computeDiff(before, null));
  } else {
    changes = redactChanges(computeDiff(before, result));
  }

  const verb = action === 'CREATE' ? 'Created' : action === 'DELETE' ? 'Deleted' : 'Updated';
  const labelPart = entityLabel ? ` ${entityLabel}` : '';
  return {
    ...base, action, entityId, entityLabel,
    affectedCount: null, changes,
    summary: `${verb} ${model}${labelPart}`,
  };
}

/**
 * Builds the Prisma client extension. `base` is the UN-extended client used for
 * the before-state read and the AuditLog insert, so those side queries never
 * re-enter this interceptor.
 */
export function auditExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'audit-log',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isAuditable(model, operation)) {
            return query(args);
          }

          // Capture before-state for single-record update/delete/upsert.
          let before: Record<string, unknown> | null = null;
          const needsBefore = ['update', 'delete', 'upsert'].includes(operation);
          if (needsBefore && (args as any)?.where) {
            try {
              before = await (base as any)[lowerFirst(model!)].findFirst({
                where: (args as any).where,
              });
            } catch {
              before = null;
            }
          }

          const result = await query(args);

          // Audit write is fully isolated: never throw to the caller.
          try {
            const rec = buildAuditRecord({
              model: model!, operation, ctx: getAuditContext(), before, result,
            });
            await (base as any).auditLog.create({
              data: { ...rec, changes: rec.changes ?? undefined },
            });
          } catch (err) {
            console.error('[audit] failed to write AuditLog:', err);
          }

          return result;
        },
      },
    },
  });
}

module.exports = { DENYLIST, isAuditable, buildAuditRecord, auditExtension };
module.exports.DENYLIST = DENYLIST;
module.exports.isAuditable = isAuditable;
module.exports.buildAuditRecord = buildAuditRecord;
module.exports.auditExtension = auditExtension;
