/**
 * tests/agingSubLedger.asOf.test.ts
 *
 * Task 6 (P1) — the GL-derived aging path (the PRIMARY path when the ledger is
 * live) previously loaded EVERY journal line on the AR/AP control account,
 * regardless of date, so a back-dated aging still reflected today's balances.
 * The loaders now filter control-account lines by entryDate <= asOf. This test
 * asserts the loader threads that boundary into the journalLine query and that
 * lines posted after asOf are dropped.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadArSubLedger, type AgingPrisma } from '../lib/reports/agingSubLedger';

const ASOF = new Date('2024-06-15T23:59:59.999Z');

describe('loadArSubLedger — entryDate <= asOf', () => {
  it('filters control-account journal lines by entryDate <= asOf', async () => {
    const journalLineFindMany = vi.fn(async ({ where }: any) => {
      // Honour the entryDate filter the loader is expected to pass.
      const lte = where.journalEntry?.entryDate?.lte as Date | undefined;
      expect(lte).toEqual(ASOF); // the boundary must be threaded through
      const ALL = [
        { baseDebit: 1000, baseCredit: 0, entryDate: new Date('2024-06-01'),
          journalEntry: { sourceType: 'Invoice', sourceId: 'inv-1' } },
        // Posted AFTER asOf — must be excluded once the filter is applied.
        { baseDebit: 5000, baseCredit: 0, entryDate: new Date('2024-07-01'),
          journalEntry: { sourceType: 'Invoice', sourceId: 'inv-late' } },
      ];
      return ALL.filter((r) => !lte || r.entryDate <= lte).map((r) => ({
        baseDebit: r.baseDebit, baseCredit: r.baseCredit, journalEntry: r.journalEntry,
      }));
    });

    const tx = {
      ledgerAccountMapping: { findFirst: vi.fn().mockResolvedValue({ accountId: 'acct-ar' }) },
      journalLine: { findMany: journalLineFindMany },
      invoice: { findMany: vi.fn().mockResolvedValue([
        { id: 'inv-1', invoiceNumber: 'INV-1', invoiceDate: new Date('2024-06-01'), dueDate: new Date('2024-06-10'), customer: { name: 'Acme' } },
      ]) },
    } as unknown as AgingPrisma;

    const sub = await loadArSubLedger(tx, 'tenant-x', ASOF);
    expect(sub.available).toBe(true);
    // Only the pre-asOf line survived; the after-asOf 5000 line is gone.
    const keys = sub.lines.map((l) => l.bucketKey);
    expect(keys).toContain('inv-1');
    expect(keys).not.toContain('inv-late');
    expect(sub.lines).toHaveLength(1);
  });
});
