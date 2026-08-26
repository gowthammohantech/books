// lib/ledger/postingEngine.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { post, reverse } from './postingEngine';
import { LedgerError, PeriodLockedError } from './buildLines';
import type { PostingInput } from './types';

function fakeTx(opts: {
  mappings?: { roleKey: string; accountId: string }[];
  existingEntry?: unknown;
  lockedPeriod?: boolean;
  createError?: unknown;
  secondFindFirst?: unknown;
} = {}) {
  const created: unknown[] = [];
  let findFirstCallCount = 0;
  return {
    created,
    ledgerAccountMapping: {
      findMany: vi.fn().mockResolvedValue(
        opts.mappings ?? [
          { roleKey: 'AR', accountId: 'acc-ar' },
          { roleKey: 'SALES_REVENUE', accountId: 'acc-rev' },
          { roleKey: 'OUTPUT_TAX', accountId: 'acc-tax' },
        ],
      ),
    },
    journalEntry: {
      findFirst: vi.fn().mockImplementation(async () => {
        findFirstCallCount += 1;
        if (findFirstCallCount === 1) return opts.existingEntry ?? null;
        return opts.secondFindFirst ?? null;
      }),
      create: opts.createError
        ? vi.fn().mockRejectedValueOnce(opts.createError).mockImplementation(async ({ data }: { data: unknown }) => {
            created.push(data);
            return { id: 'je-new', ...(data as object) };
          })
        : vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
            created.push(data);
            return { id: 'je-new', ...(data as object) };
          }),
    },
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue(opts.lockedPeriod ? { id: 'p1', isLocked: true } : null),
    },
  };
}

const input: PostingInput = {
  userId: 'u1', sourceType: 'Invoice', sourceId: 'inv1', event: 'issued',
  date: new Date('2026-06-06'), currencyCode: 'INR',
  instructions: [
    { roleKey: 'AR', side: 'debit', amount: '118' },
    { roleKey: 'SALES_REVENUE', side: 'credit', amount: '100' },
    { roleKey: 'OUTPUT_TAX', side: 'credit', amount: '18', taxRoleKey: 'OUTPUT_TAX' },
  ],
};

describe('postingEngine.post', () => {
  it('creates a balanced journal entry with nested lines', async () => {
    const tx = fakeTx();
    const result = await post(tx as never, input);
    expect(tx.journalEntry.create).toHaveBeenCalledOnce();
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: 'u1', sourceType: 'Invoice', sourceId: 'inv1', event: 'issued',
      isSystemGenerated: true,
    });
    expect(data.lines.create).toHaveLength(3);
    expect(result.id).toBe('je-new');
  });

  it('is idempotent: returns existing entry, does not create', async () => {
    const tx = fakeTx({ existingEntry: { id: 'je-existing' } });
    const result = await post(tx as never, input);
    expect(result.id).toBe('je-existing');
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('rejects posting into a locked period', async () => {
    const tx = fakeTx({ lockedPeriod: true });
    await expect(post(tx as never, input)).rejects.toThrow(LedgerError);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('rejects posting into a locked period with PeriodLockedError', async () => {
    const tx = fakeTx({ lockedPeriod: true });
    await expect(post(tx as never, input)).rejects.toThrow(PeriodLockedError);
  });

  it('propagates LedgerError when an unbalanced instruction set is given', async () => {
    const tx = fakeTx();
    await expect(post(tx as never, {
      ...input,
      instructions: [
        { roleKey: 'AR', side: 'debit', amount: '100' },
        { roleKey: 'SALES_REVENUE', side: 'credit', amount: '90' },
      ],
    })).rejects.toThrow(LedgerError);
  });

  it('handles race condition: P2002 unique violation falls back to existing entry', async () => {
    const tx = fakeTx({
      existingEntry: null,
      createError: { code: 'P2002' },
      secondFindFirst: { id: 'je-raced' },
    });
    const result = await post(tx as never, input);
    expect(result.id).toBe('je-raced');
    expect(tx.journalEntry.create).toHaveBeenCalledOnce();
    expect(tx.journalEntry.findFirst).toHaveBeenCalledTimes(2);
  });

  // P3.3 — dimension stamping
  it('stamps costCenterId and projectId onto every created line when provided', async () => {
    const tx = fakeTx();
    await post(tx as never, {
      ...input,
      costCenterId: 'cc-1',
      projectId: 'proj-1',
    });
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.lines.create).toHaveLength(3);
    for (const line of data.lines.create as Array<Record<string, unknown>>) {
      expect(line.costCenterId).toBe('cc-1');
      expect(line.projectId).toBe('proj-1');
    }
  });

  it('does not add dimension keys to lines when dims are absent (zero-impact)', async () => {
    const tx = fakeTx();
    // standard input has no costCenterId/projectId
    await post(tx as never, input);
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.lines.create).toHaveLength(3);
    for (const line of data.lines.create as Array<Record<string, unknown>>) {
      expect(line).not.toHaveProperty('costCenterId');
      expect(line).not.toHaveProperty('projectId');
    }
  });

  it('stamps null dimensions onto lines when explicitly nulled', async () => {
    const tx = fakeTx();
    await post(tx as never, {
      ...input,
      costCenterId: null,
      projectId: null,
    });
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    for (const line of data.lines.create as Array<Record<string, unknown>>) {
      expect(line.costCenterId).toBeNull();
      expect(line.projectId).toBeNull();
    }
  });

  // Per-line dimensions: the document value is a DEFAULT, not an override.
  it('lets a per-line costCenterId beat the document-level one', async () => {
    const tx = fakeTx();
    await post(tx as never, {
      ...input,
      costCenterId: 'cc-header',
      instructions: [
        { roleKey: 'AR', side: 'debit', amount: '118' },
        { roleKey: 'SALES_REVENUE', side: 'credit', amount: '60', costCenterId: 'cc-a' },
        { roleKey: 'SALES_REVENUE', side: 'credit', amount: '40', costCenterId: 'cc-b' },
        { roleKey: 'OUTPUT_TAX', side: 'credit', amount: '18', taxRoleKey: 'OUTPUT_TAX' },
      ],
    });
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    const lines = data.lines.create as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(4);
    // Revenue legs carry their own centres...
    expect(lines.filter((l) => l.costCenterId === 'cc-a')).toHaveLength(1);
    expect(lines.filter((l) => l.costCenterId === 'cc-b')).toHaveLength(1);
    // ...while AR and tax fall back to the document's centre.
    expect(lines.filter((l) => l.costCenterId === 'cc-header')).toHaveLength(2);
  });

  it('lets a per-line explicit null beat a document-level centre', async () => {
    const tx = fakeTx();
    await post(tx as never, {
      ...input,
      costCenterId: 'cc-header',
      instructions: [
        { roleKey: 'AR', side: 'debit', amount: '118' },
        { roleKey: 'SALES_REVENUE', side: 'credit', amount: '100', costCenterId: null },
        { roleKey: 'OUTPUT_TAX', side: 'credit', amount: '18', taxRoleKey: 'OUTPUT_TAX' },
      ],
    });
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    const lines = data.lines.create as Array<Record<string, unknown>>;
    const revLine = lines.find((l) => l.accountId === 'acc-rev');
    expect(revLine?.costCenterId).toBeNull();
    expect(lines.find((l) => l.accountId === 'acc-ar')?.costCenterId).toBe('cc-header');
  });

  it('applies the document centre to lines that carry none', async () => {
    const tx = fakeTx();
    await post(tx as never, {
      ...input,
      costCenterId: 'cc-header',
      instructions: [
        { roleKey: 'AR', side: 'debit', amount: '118' },
        { roleKey: 'SALES_REVENUE', side: 'credit', amount: '60', costCenterId: 'cc-a' },
        { roleKey: 'SALES_REVENUE', side: 'credit', amount: '40' },
        { roleKey: 'OUTPUT_TAX', side: 'credit', amount: '18', taxRoleKey: 'OUTPUT_TAX' },
      ],
    });
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    const lines = data.lines.create as Array<Record<string, unknown>>;
    expect(lines.filter((l) => l.costCenterId === 'cc-header')).toHaveLength(3);
  });
});

function fakeTxForReverse(
  original: unknown,
  opts: { lockedPeriod?: boolean } = {},
) {
  const created: unknown[] = [];
  return {
    created,
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(original),
      create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
        created.push(data);
        return { id: 'je-rev', ...(data as object) };
      }),
    },
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue(
        opts.lockedPeriod ? { id: 'p1', isLocked: true } : null,
      ),
    },
  };
}

describe('postingEngine.reverse', () => {
  const original = {
    id: 'je-1', userId: 'u1', entryDate: new Date('2026-06-06'),
    sourceType: 'Invoice', sourceId: 'inv1', event: 'issued',
    reversedById: null, reversals: [],
    lines: [
      { accountId: 'acc-ar', debit: '118.0000', credit: '0.0000', baseDebit: '118.0000', baseCredit: '0.0000', currencyCode: 'INR', exchangeRate: '1.00000000', taxRoleKey: null, description: null },
      { accountId: 'acc-rev', debit: '0.0000', credit: '100.0000', baseDebit: '0.0000', baseCredit: '100.0000', currencyCode: 'INR', exchangeRate: '1.00000000', taxRoleKey: null, description: null },
      { accountId: 'acc-tax', debit: '0.0000', credit: '18.0000', baseDebit: '0.0000', baseCredit: '18.0000', currencyCode: 'INR', exchangeRate: '1.00000000', taxRoleKey: 'OUTPUT_TAX', description: null },
    ],
  };

  it('creates a mirror entry with debits and credits swapped', async () => {
    const tx = fakeTxForReverse(original);
    const rev = await reverse(tx as never, 'je-1');
    expect(rev.id).toBe('je-rev');
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.event).toBe('issued.reversal');
    expect(data.reversedById).toBe('je-1');
    const arLine = data.lines.create.find((l: { accountId: string }) => l.accountId === 'acc-ar');
    expect(arLine).toMatchObject({ debit: '0.0000', credit: '118.0000', baseCredit: '118.0000' });
    const revLine = data.lines.create.find((l: { accountId: string }) => l.accountId === 'acc-rev');
    expect(revLine).toMatchObject({ debit: '100.0000', credit: '0.0000', baseDebit: '100.0000' });
  });

  it('throws if the entry already has a reversal (reversals back-relation)', async () => {
    const tx = fakeTxForReverse({ ...original, reversedById: null, reversals: [{ id: 'je-prev' }] });
    await expect(reverse(tx as never, 'je-1')).rejects.toThrow(LedgerError);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('carries each line\'s dimensions onto the reversal', async () => {
    // Regression: the reversal used to drop costCenterId/projectId. The trial
    // balance still netted to zero, but every by-dimension report filters on
    // costCenterId — so a voided invoice's revenue stayed on the department
    // permanently, with only the untagged reversing leg to offset it.
    const dimensioned = {
      ...original,
      lines: original.lines.map((l, i) => ({
        ...l,
        costCenterId: i === 1 ? 'cc-b' : 'cc-a',
        projectId: 'proj-1',
      })),
    };
    const tx = fakeTxForReverse(dimensioned);
    await reverse(tx as never, 'je-1');
    const data = (tx.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    const lines = data.lines.create as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.accountId === 'acc-ar')?.costCenterId).toBe('cc-a');
    // The split revenue leg must reverse against the SAME department it hit.
    expect(lines.find((l) => l.accountId === 'acc-rev')?.costCenterId).toBe('cc-b');
    expect(lines.every((l) => l.projectId === 'proj-1')).toBe(true);
  });

  it('throws if the entry is itself a reversal (has reversedById)', async () => {
    const tx = fakeTxForReverse({ ...original, reversedById: 'je-orig', reversals: [] });
    await expect(reverse(tx as never, 'je-1')).rejects.toThrow(LedgerError);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('throws if the entry does not exist', async () => {
    const tx = fakeTxForReverse(null);
    await expect(reverse(tx as never, 'missing')).rejects.toThrow(LedgerError);
  });

  it('throws if the entry date falls in a locked period', async () => {
    const tx = fakeTxForReverse(original, { lockedPeriod: true });
    await expect(reverse(tx as never, 'je-1')).rejects.toThrow(LedgerError);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});
