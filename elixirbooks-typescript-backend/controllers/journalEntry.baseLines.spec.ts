// controllers/journalEntry.baseLines.spec.ts
//
// FIX 1 (audit-ledger): manual journal entries must populate baseDebit/baseCredit
// so they appear in the GL-derived reports (Trial Balance, P&L, Balance Sheet),
// which aggregate the BASE columns. Before the fix these defaulted to 0 and manual
// JEs were silently dropped from the books.
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  buildManualJeBaseLines,
  resolveManualJeRate,
} from './journalEntryController';

function baseTotals(lines: { baseDebit: Prisma.Decimal; baseCredit: Prisma.Decimal }[]) {
  const dr = lines.reduce((s, l) => s.add(l.baseDebit), new Prisma.Decimal(0));
  const cr = lines.reduce((s, l) => s.add(l.baseCredit), new Prisma.Decimal(0));
  return { dr, cr };
}

describe('resolveManualJeRate', () => {
  it('defaults to 1 for missing / blank / invalid / non-positive rates', () => {
    for (const raw of [undefined, null, '', 'abc', 0, -1]) {
      expect(resolveManualJeRate(raw).toString()).toBe('1');
    }
  });
  it('uses the supplied positive rate', () => {
    expect(resolveManualJeRate('83.25').toString()).toBe('83.25');
    expect(resolveManualJeRate(1.5).toString()).toBe('1.5');
  });
});

describe('buildManualJeBaseLines', () => {
  it('base-currency entry: baseDebit=debit, baseCredit=credit (rate 1)', () => {
    const lines = buildManualJeBaseLines(
      [
        { accountId: 'bank', debit: 250000 },
        { accountId: 'purchases', debit: 45000 },
        { accountId: 'cash', credit: 295000 },
      ],
      resolveManualJeRate(undefined),
    );
    expect(lines[0].baseDebit.toString()).toBe('250000');
    expect(lines[2].baseCredit.toString()).toBe('295000');
    // The previously-proven-broken 250k manual JE now carries non-zero base.
    const { dr, cr } = baseTotals(lines);
    expect(dr.equals(cr)).toBe(true);
    expect(dr.toString()).toBe('295000');
  });

  it('foreign-currency entry: base = txn amount * exchangeRate, still balanced', () => {
    const rate = resolveManualJeRate('80'); // 1 unit foreign = 80 base
    const lines = buildManualJeBaseLines(
      [
        { accountId: 'fx-asset', debit: 100 },
        { accountId: 'fx-income', credit: 100 },
      ],
      rate,
    );
    expect(lines[0].baseDebit.toString()).toBe('8000');
    expect(lines[1].baseCredit.toString()).toBe('8000');
    const { dr, cr } = baseTotals(lines);
    expect(dr.equals(cr)).toBe(true);
  });
});
