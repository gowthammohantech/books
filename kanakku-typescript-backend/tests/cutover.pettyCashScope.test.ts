/**
 * tests/cutover.pettyCashScope.test.ts
 *
 * Task 2 review carryover item A: lib/ledger/cutover.ts's
 * computeOpeningSummary queried PettyCash as an unscoped singleton
 * (`findFirst({ where: {} })`) under a stale "PettyCash has no userId"
 * comment. PettyCash gained a `userId` column in Task 2; this pins the
 * opening-balance cash figure to the tenant's own petty cash row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeOpeningSummary, type CutoverTx } from '../lib/ledger/cutover';

const TENANT_ID = 'tenant-alpha';

function makeTx(overrides: Partial<CutoverTx> = {}): CutoverTx {
  const base: CutoverTx = {
    companySettings: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'cs-1',
        ledgerInitialized: false,
        functionalCurrency: 'BASE',
        goLiveDate: new Date('2026-01-01'),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    bankDetail: { findMany: vi.fn().mockResolvedValue([]) },
    bankTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    // No petty-cash txn ≤ asOf → as-of cash falls back to openingBalance.
    pettyCash: { findFirst: vi.fn().mockResolvedValue({ id: 'pc-1', openingBalance: 250, currentBalance: 999 }) },
    pettyCashTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    purchase: { findMany: vi.fn().mockResolvedValue([]) },
    creditNote: { findMany: vi.fn().mockResolvedValue([]) },
    inventory: { findMany: vi.fn().mockResolvedValue([]) },
    ledgerAccountMapping: { findMany: vi.fn().mockResolvedValue([]) },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'je-1' }),
    },
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeOpeningSummary — PettyCash tenant scope', () => {
  it('scopes the pettyCash.findFirst lookup by userId', async () => {
    const tx = makeTx();

    const summary = await computeOpeningSummary(tx, TENANT_ID, new Date('2026-01-01'));

    expect(tx.pettyCash.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: TENANT_ID } }),
    );
    expect(summary.cash).toBe('250');
  });
});
