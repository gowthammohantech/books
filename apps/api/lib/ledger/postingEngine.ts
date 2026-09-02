// lib/ledger/postingEngine.ts
import { buildLines, LedgerError, PeriodLockedError } from './buildLines';
import { loadResolver } from './roleResolver';
import type { PostingInput } from './types';

interface PersistedLine {
  accountId: string; debit: string; credit: string;
  baseDebit: string; baseCredit: string; currencyCode: string | null;
  exchangeRate: string; taxRoleKey: string | null; description: string | null;
  costCenterId: string | null; projectId: string | null;
}
interface JournalEntryWithLines {
  id: string; tenantId: string; entryDate: Date;
  sourceType: string | null; sourceId: string | null; event: string | null;
  reversedById: string | null;
  reversals: { id: string }[];
  lines: PersistedLine[];
}

/** Minimal slice of the Prisma client/tx the engine needs. Using a structural
 *  type keeps the engine unit-testable with a fake tx and avoids a hard
 *  dependency on the generated client in tests. */
export interface LedgerTx {
  ledgerAccountMapping: { findMany: (args: unknown) => Promise<{ roleKey: string; accountId: string }[]> };
  journalEntry: {
    findFirst: (args: unknown) => Promise<(JournalEntryWithLines & { reversals?: { id: string }[] }) | { id: string } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  accountingPeriod: { findFirst: (args: unknown) => Promise<{ id: string; isLocked: boolean } | null> };
}

export async function post(tx: LedgerTx, input: PostingInput): Promise<{ id: string }> {
  // 1. Idempotency (common path)
  const existing = await tx.journalEntry.findFirst({
    where: {
      tenantId: input.tenantId, sourceType: input.sourceType,
      sourceId: input.sourceId, event: input.event, isDeleted: false,
    },
  });
  if (existing) return existing;

  // 2. Period lock
  const locked = await tx.accountingPeriod.findFirst({
    where: {
      tenantId: input.tenantId, isLocked: true,
      startDate: { lte: input.date }, endDate: { gte: input.date },
    },
  });
  if (locked) {
    throw new PeriodLockedError(`Accounting period is locked for ${input.date.toISOString().slice(0, 10)}`);
  }

  // 3. Build balanced lines
  const resolve = await loadResolver(tx, input.tenantId);
  const lines = buildLines(input, resolve);

  // 4. Persist entry + lines; handle DB-level unique-violation race gracefully
  // P3.3: the PostingInput's costCenterId/projectId are the DOCUMENT-level
  // dimension. Spreading them FIRST makes them a default that a per-line value
  // overrides — which is what lets one invoice split its revenue across several
  // departments while AR and tax stay on the document's own centre. When
  // neither level supplies a dimension, no key is emitted at all.
  const dimPatch: Record<string, string | null> = {};
  if (input.costCenterId !== undefined) dimPatch.costCenterId = input.costCenterId ?? null;
  if (input.projectId !== undefined) dimPatch.projectId = input.projectId ?? null;
  //
  // `tenantId` is set on every line explicitly rather than left to the tenant
  // guard's nested-create stamping. That stamping only happens in `enforce`
  // mode: in `warn` — the shipped default (lib/tenantGuard.ts) — the guard
  // computes its decision, logs it, and hands the caller's arguments through
  // untouched, so the required JournalLine.tenantId would never be written and
  // the create fails with "Argument `tenant` is missing". Posting must not
  // depend on which mode the guard happens to be in, and any caller holding a
  // plain PrismaClient (the seeders) has no guard at all. The value is the
  // parent entry's own tenant, which is exactly what checkTenantIntegrity.ts
  // asserts about this column.
  const linesWithDims = lines.map((l) => ({ ...dimPatch, ...l, tenantId: input.tenantId }));

  try {
    return await tx.journalEntry.create({
      data: {
        tenantId: input.tenantId,
        entryDate: input.date,
        postingDate: input.date,
        description: input.description ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        event: input.event,
        isOpeningBalance: input.isOpeningBalance ?? false,
        isSystemGenerated: true,
        isPosted: true,
        lines: { create: linesWithDims },
      },
    });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      // Another concurrent request won the race — return the now-existing entry
      const raced = await tx.journalEntry.findFirst({
        where: {
          tenantId: input.tenantId, sourceType: input.sourceType,
          sourceId: input.sourceId, event: input.event, isDeleted: false,
        },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

export async function reverse(tx: LedgerTx, entryId: string): Promise<{ id: string }> {
  const original = (await tx.journalEntry.findFirst({
    where: { id: entryId }, include: { lines: true, reversals: true },
  })) as JournalEntryWithLines | null;

  if (!original) throw new LedgerError(`journal entry ${entryId} not found`);
  if (original.reversedById) throw new LedgerError(`journal entry ${entryId} is itself a reversal`);
  if (original.reversals && original.reversals.length > 0) throw new LedgerError(`journal entry ${entryId} already reversed`);

  // Period lock — check against the original entry's date
  const locked = await tx.accountingPeriod.findFirst({
    where: {
      tenantId: original.tenantId, isLocked: true,
      startDate: { lte: original.entryDate }, endDate: { gte: original.entryDate },
    },
  });
  if (locked) throw new PeriodLockedError(`Accounting period is locked for ${original.entryDate.toISOString().slice(0, 10)}`);

  const mirrored = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit, credit: l.debit,
    baseDebit: l.baseCredit, baseCredit: l.baseDebit,
    currencyCode: l.currencyCode, exchangeRate: l.exchangeRate,
    taxRoleKey: l.taxRoleKey, description: l.description,
    // The reversal MUST carry the original's dimensions. Without them a voided
    // or deleted document leaves its revenue/cost on the department forever:
    // the trial balance nets to zero, but every by-dimension report filters on
    // costCenterId and so never sees the untagged reversing leg.
    costCenterId: l.costCenterId, projectId: l.projectId,
    // Same reason as the forward posting above: set explicitly, not stamped.
    tenantId: original.tenantId,
  }));

  return tx.journalEntry.create({
    data: {
      tenantId: original.tenantId,
      entryDate: original.entryDate,
      postingDate: original.entryDate,
      description: `Reversal of ${entryId}`,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      event: `${original.event}.reversal`,
      isSystemGenerated: true,
      isPosted: true,
      reversedById: entryId,
      lines: { create: mirrored },
    },
  });
}
