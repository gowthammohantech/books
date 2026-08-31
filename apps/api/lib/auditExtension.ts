import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { getAuditContext, type AuditContext } from './auditContext';
import { computeDiff, redactChanges, type Change } from './auditDiff';
import { resolveEntityLabel } from './auditLabels';
import {
  applyTenantGuard,
  assertBeforeRowInTenant,
  flattenCompoundKeys,
  guardContextFromStore,
  isGuarded,
} from './tenantGuard';

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
  /**
   * The workspace the change happened in. Nullable because system operations
   * (seeds, backfills, boot reconciliation) legitimately have no tenant, and a
   * required column would force those to invent one.
   */
  tenantId: string | null;
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
    tenantId: ctx?.tenantId ?? null,
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
 *
 * This is the app's ONE query interceptor. It does two jobs, in this order:
 *
 *   1. TENANT ISOLATION (lib/tenantGuard.ts). Runs first, and before the
 *      auditable-or-not short-circuit below, so READS are guarded too — the
 *      audit log only cares about writes, but a leak is mostly a read.
 *   2. AUDIT LOGGING, unchanged.
 *
 * They share the before-row read: the guard needs to know whether a
 * single-record update/delete/upsert is aimed at a row belonging to another
 * tenant, and the audit log needs the row's prior state. One query, both
 * answers — which is why the guard lives here rather than in a second
 * extension.
 */
export function auditExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'audit-log',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const guardCtx = guardContextFromStore();
          const decision = applyTenantGuard(model, operation, args, guardCtx);
          // `decision.args === undefined` means "run what the caller wrote":
          // either the model is unguarded, or we are in warn mode.
          // `any` rather than `typeof args`: that type is the union of every
          // model's every operation-args shape, which the compiler refuses to
          // represent (TS2590). The surrounding file already casts for the
          // same reason.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const effectiveArgs: any = decision.args === undefined ? args : decision.args;

          const auditable = isAuditable(model, operation);
          const needsBefore = ['update', 'delete', 'upsert'].includes(operation);
          const wantBefore = needsBefore && !!(args as any)?.where
            && (auditable || !!decision.checkBeforeTenant);

          let before: Record<string, unknown> | null = null;
          if (wantBefore) {
            try {
              // Compound unique inputs (`{ tenantId_key: { ... } }`) are not
              // valid findFirst filters, so flatten them — otherwise this read
              // silently fails and takes the guard's foreign-row check with it.
              before = await (base as any)[lowerFirst(model!)].findFirst({
                where: flattenCompoundKeys(model!, (args as any).where),
              });
            } catch {
              before = null;
            }
          }
          if (decision.checkBeforeTenant) {
            assertBeforeRowInTenant(model!, before, guardCtx);
          }

          if (!auditable) {
            const out = await query(effectiveArgs);
            return decision.checkResultTenant ? filterUniqueResult(model!, out, guardCtx, args) : out;
          }

          const result = await query(effectiveArgs);

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

/**
 * findUnique returns a row by a unique key, which may belong to another tenant.
 * The guard cannot add a filter to that key, so the row is checked on the way
 * back out and dropped if it is not ours — the caller sees exactly what a
 * filtered query would have shown them, a miss.
 *
 * In `warn` mode the row is reported and RETURNED, so switching the mode on is
 * observable without changing a single response.
 */
function filterUniqueResult(
  model: string,
  result: unknown,
  ctx: { tenantId: string | null; mode: string },
  originalArgs: unknown,
): unknown {
  if (!result || typeof result !== 'object' || !ctx.tenantId) return result;
  const row = result as Record<string, unknown>;
  const rowTenant = row.tenantId;
  if (typeof rowTenant !== 'string' || rowTenant === ctx.tenantId) {
    return stripAddedTenantId(model, row, ctx, originalArgs);
  }
  if (ctx.mode !== 'enforce') {
    console.warn(
      `[tenant-guard] ${model}.findUnique returned a row owned by tenant "${rowTenant}" ` +
      `while acting as "${ctx.tenantId}" — it would have been withheld in enforce mode`,
    );
    return result;
  }
  return null;
}

/**
 * The guard adds `tenantId` to a `select` that omitted it, purely so the check
 * above has something to read. Take it back off so the caller's response shape
 * is byte-identical to what they asked for.
 */
function stripAddedTenantId(
  _model: string,
  row: Record<string, unknown>,
  ctx: { mode: string },
  originalArgs: unknown,
): unknown {
  if (ctx.mode !== 'enforce') return row;
  const sel = (originalArgs as any)?.select as Record<string, unknown> | undefined;
  if (!sel || 'tenantId' in sel) return row;
  const { tenantId: _dropped, ...rest } = row;
  return rest;
}

module.exports = { DENYLIST, isAuditable, buildAuditRecord, auditExtension };
module.exports.DENYLIST = DENYLIST;
module.exports.isAuditable = isAuditable;
module.exports.buildAuditRecord = buildAuditRecord;
module.exports.auditExtension = auditExtension;
