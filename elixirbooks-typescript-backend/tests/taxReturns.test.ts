// tests/taxReturns.test.ts
//
// GL-derived period tax-figures lib (lib/reports/taxReturns.ts).
//
// These tests drive resolveTaxAccounts + loadTaxFigures against an in-memory
// prisma stub shaped like the slice the lib consumes (TaxReturnsPrisma). The
// stub holds a tiny fixture of LedgerAccountMapping + Account + JournalLine rows
// keyed by tenant (userId on the parent JournalEntry / Account) so we can assert:
//   - known output/input postings → correct figures
//   - empty period → all zeros
//   - another tenant's postings are excluded (tenant isolation)
// and that the figures reconcile to the GL movement on the resolved accounts
// (output = Σ(credit−debit), input = Σ(debit−credit), inclusive period).

import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  resolveTaxAccounts,
  loadTaxFigures,
  type TaxReturnsPrisma,
} from '../lib/reports/taxReturns';

const D = (v: number | string) => new Prisma.Decimal(v);

// ---------------------------------------------------------------------------
// Fixture types (mirror the prisma rows the lib reads).
// ---------------------------------------------------------------------------
interface MapRow { userId: string; roleKey: string; accountId: string }
interface AcctRow { id: string; userId: string; code: string; name: string; accountType: string }
interface LineRow {
  accountId: string;
  baseDebit: Prisma.Decimal;
  baseCredit: Prisma.Decimal;
  // parent entry attrs used for filtering:
  userId: string;
  entryDate: Date;
  isDeleted?: boolean;
}

// A minimal prisma stub: only the delegates/queries the lib uses, honouring the
// where-clauses the lib actually passes (userId + roleKey; account.userId;
// journalEntry.userId + isDeleted + entryDate range).
function makeStub(data: { maps: MapRow[]; accounts: AcctRow[]; lines: LineRow[] }): TaxReturnsPrisma {
  return {
    ledgerAccountMapping: {
      findMany: async (args: any) => {
        const { userId, roleKey } = args.where;
        const keys: string[] = roleKey?.in ?? [roleKey];
        return data.maps
          .filter((m) => m.userId === userId && keys.includes(m.roleKey))
          .map((m) => ({ roleKey: m.roleKey, accountId: m.accountId }));
      },
    },
    account: {
      findMany: async (args: any) => {
        const where = args.where ?? {};
        return data.accounts
          .filter((a) => {
            if (where.userId && a.userId !== where.userId) return false;
            if (where.isDeleted === false) { /* fixture has no deleted accounts */ }
            return true;
          })
          .map((a) => {
            // Inline-aggregate journalLines for this account in the period.
            const w = args.select?.journalLines?.where?.journalEntry ?? {};
            const from: Date | undefined = w.entryDate?.gte;
            const to: Date | undefined = w.entryDate?.lte;
            const lines = data.lines.filter((l) => {
              if (l.accountId !== a.id) return false;
              if (w.userId && l.userId !== w.userId) return false;
              if (w.isDeleted === false && l.isDeleted) return false;
              if (from && l.entryDate < from) return false;
              if (to && l.entryDate > to) return false;
              return true;
            });
            return {
              id: a.id, code: a.code, name: a.name, accountType: a.accountType,
              journalLines: lines.map((l) => ({ baseDebit: l.baseDebit, baseCredit: l.baseCredit })),
            };
          });
      },
    },
  } as unknown as TaxReturnsPrisma;
}

const TENANT = 'tenant-1';
const OTHER = 'tenant-2';
const FROM = new Date('2026-04-01T00:00:00.000Z');
const TO = new Date('2026-06-30T23:59:59.999Z');
const inPeriod = new Date('2026-05-15T00:00:00.000Z');
const beforePeriod = new Date('2026-03-01T00:00:00.000Z');

// Standard-pack tax accounts: OUTPUT_TAX (2100, LIABILITY), INPUT_TAX (1300, ASSET).
function baseFixture() {
  const maps: MapRow[] = [
    { userId: TENANT, roleKey: 'OUTPUT_TAX', accountId: 'out-1' },
    { userId: TENANT, roleKey: 'INPUT_TAX', accountId: 'in-1' },
  ];
  const accounts: AcctRow[] = [
    { id: 'out-1', userId: TENANT, code: '2100', name: 'GST Payable (Output)', accountType: 'LIABILITY' },
    { id: 'in-1', userId: TENANT, code: '1300', name: 'GST Receivable (Input)', accountType: 'ASSET' },
    { id: 'rev-1', userId: TENANT, code: '4001', name: 'Sales Revenue', accountType: 'INCOME' },
    { id: 'exp-1', userId: TENANT, code: '5002', name: 'Purchases', accountType: 'EXPENSE' },
  ];
  return { maps, accounts };
}

describe('resolveTaxAccounts', () => {
  it('returns the tenant output/input tax account ids from the role mapping', async () => {
    const { maps, accounts } = baseFixture();
    const stub = makeStub({ maps, accounts, lines: [] });
    const res = await resolveTaxAccounts(TENANT, stub);
    expect(res.outputAccountIds).toEqual(['out-1']);
    expect(res.inputAccountIds).toEqual(['in-1']);
  });

  it('excludes another tenant\'s mappings', async () => {
    const maps: MapRow[] = [
      { userId: TENANT, roleKey: 'OUTPUT_TAX', accountId: 'out-1' },
      { userId: OTHER, roleKey: 'OUTPUT_TAX', accountId: 'out-2' },
      { userId: OTHER, roleKey: 'INPUT_TAX', accountId: 'in-2' },
    ];
    const stub = makeStub({ maps, accounts: [], lines: [] });
    const res = await resolveTaxAccounts(TENANT, stub);
    expect(res.outputAccountIds).toEqual(['out-1']);
    expect(res.inputAccountIds).toEqual([]);
  });

  it('returns empty arrays when no tax mapping exists', async () => {
    const stub = makeStub({ maps: [], accounts: [], lines: [] });
    const res = await resolveTaxAccounts(TENANT, stub);
    expect(res.outputAccountIds).toEqual([]);
    expect(res.inputAccountIds).toEqual([]);
  });
});

describe('loadTaxFigures', () => {
  it('computes GL-derived figures for a period with known postings', async () => {
    const { maps, accounts } = baseFixture();
    // A sale: Dr AR 1100 / Cr Revenue 1000 / Cr OUTPUT_TAX 100  (output tax = 100)
    // A purchase: Dr Purchases 500 / Dr INPUT_TAX 50 / Cr AP 550  (input tax = 50)
    const lines: LineRow[] = [
      // sale output tax
      { accountId: 'out-1', baseDebit: D(0), baseCredit: D(100), userId: TENANT, entryDate: inPeriod },
      // sale revenue (income, credit-normal)
      { accountId: 'rev-1', baseDebit: D(0), baseCredit: D(1000), userId: TENANT, entryDate: inPeriod },
      // purchase input tax
      { accountId: 'in-1', baseDebit: D(50), baseCredit: D(0), userId: TENANT, entryDate: inPeriod },
      // purchase expense (expense, debit-normal)
      { accountId: 'exp-1', baseDebit: D(500), baseCredit: D(0), userId: TENANT, entryDate: inPeriod },
    ];
    const stub = makeStub({ maps, accounts, lines });
    const f = await loadTaxFigures(TENANT, FROM, TO, stub);

    expect(f.outputTax.toString()).toBe('100');
    expect(f.inputTax.toString()).toBe('50');
    expect(f.salesExTax.toString()).toBe('1000');
    expect(f.purchasesExTax.toString()).toBe('500');
    expect(f.salesInclTax.toString()).toBe('1100');   // 1000 + 100
    expect(f.purchasesInclTax.toString()).toBe('550'); // 500 + 50
  });

  it('nets credit notes / refunds via signed sums on the tax accounts', async () => {
    const { maps, accounts } = baseFixture();
    const lines: LineRow[] = [
      { accountId: 'out-1', baseDebit: D(0), baseCredit: D(200), userId: TENANT, entryDate: inPeriod }, // sale
      { accountId: 'out-1', baseDebit: D(30), baseCredit: D(0), userId: TENANT, entryDate: inPeriod },  // credit note reverses output tax
      { accountId: 'in-1', baseDebit: D(40), baseCredit: D(0), userId: TENANT, entryDate: inPeriod },   // purchase
      { accountId: 'in-1', baseDebit: D(0), baseCredit: D(10), userId: TENANT, entryDate: inPeriod },   // debit note reverses input tax
    ];
    const stub = makeStub({ maps, accounts, lines });
    const f = await loadTaxFigures(TENANT, FROM, TO, stub);
    expect(f.outputTax.toString()).toBe('170'); // 200 − 30
    expect(f.inputTax.toString()).toBe('30');   // 40 − 10
  });

  it('returns all zeros for an empty period', async () => {
    const { maps, accounts } = baseFixture();
    // All postings fall BEFORE the period.
    const lines: LineRow[] = [
      { accountId: 'out-1', baseDebit: D(0), baseCredit: D(999), userId: TENANT, entryDate: beforePeriod },
      { accountId: 'in-1', baseDebit: D(999), baseCredit: D(0), userId: TENANT, entryDate: beforePeriod },
      { accountId: 'rev-1', baseDebit: D(0), baseCredit: D(999), userId: TENANT, entryDate: beforePeriod },
      { accountId: 'exp-1', baseDebit: D(999), baseCredit: D(0), userId: TENANT, entryDate: beforePeriod },
    ];
    const stub = makeStub({ maps, accounts, lines });
    const f = await loadTaxFigures(TENANT, FROM, TO, stub);
    expect(f.outputTax.toString()).toBe('0');
    expect(f.inputTax.toString()).toBe('0');
    expect(f.salesExTax.toString()).toBe('0');
    expect(f.purchasesExTax.toString()).toBe('0');
    expect(f.salesInclTax.toString()).toBe('0');
    expect(f.purchasesInclTax.toString()).toBe('0');
  });

  it('excludes another tenant\'s postings (tenant isolation)', async () => {
    const { maps, accounts } = baseFixture();
    // Add the other tenant's accounts + mapping + postings; they must not leak.
    maps.push({ userId: OTHER, roleKey: 'OUTPUT_TAX', accountId: 'out-2' });
    maps.push({ userId: OTHER, roleKey: 'INPUT_TAX', accountId: 'in-2' });
    accounts.push({ id: 'out-2', userId: OTHER, code: '2100', name: 'GST Payable', accountType: 'LIABILITY' });
    accounts.push({ id: 'in-2', userId: OTHER, code: '1300', name: 'GST Receivable', accountType: 'ASSET' });

    const lines: LineRow[] = [
      // tenant-1 real postings
      { accountId: 'out-1', baseDebit: D(0), baseCredit: D(70), userId: TENANT, entryDate: inPeriod },
      { accountId: 'in-1', baseDebit: D(20), baseCredit: D(0), userId: TENANT, entryDate: inPeriod },
      // tenant-2 postings in the same period — must be excluded
      { accountId: 'out-2', baseDebit: D(0), baseCredit: D(5000), userId: OTHER, entryDate: inPeriod },
      { accountId: 'in-2', baseDebit: D(4000), baseCredit: D(0), userId: OTHER, entryDate: inPeriod },
    ];
    const stub = makeStub({ maps, accounts, lines });
    const f = await loadTaxFigures(TENANT, FROM, TO, stub);
    expect(f.outputTax.toString()).toBe('70');
    expect(f.inputTax.toString()).toBe('20');
  });

  it('does not double-count input tax when INPUT_TAX is an EXPENSE account (US-style)', async () => {
    // US pack: inputTaxIsExpense → INPUT_TAX is EXPENSE-typed. purchasesExTax
    // must exclude the input-tax account so it is not counted in both inputTax
    // and purchasesExTax.
    const maps: MapRow[] = [
      { userId: TENANT, roleKey: 'OUTPUT_TAX', accountId: 'out-1' },
      { userId: TENANT, roleKey: 'INPUT_TAX', accountId: 'in-exp' },
    ];
    const accounts: AcctRow[] = [
      { id: 'out-1', userId: TENANT, code: '2100', name: 'Sales Tax Payable', accountType: 'LIABILITY' },
      { id: 'in-exp', userId: TENANT, code: '1300', name: 'Sales Tax Paid', accountType: 'EXPENSE' },
      { id: 'exp-1', userId: TENANT, code: '5002', name: 'Purchases', accountType: 'EXPENSE' },
    ];
    const lines: LineRow[] = [
      { accountId: 'out-1', baseDebit: D(0), baseCredit: D(80), userId: TENANT, entryDate: inPeriod },
      { accountId: 'in-exp', baseDebit: D(25), baseCredit: D(0), userId: TENANT, entryDate: inPeriod },
      { accountId: 'exp-1', baseDebit: D(300), baseCredit: D(0), userId: TENANT, entryDate: inPeriod },
    ];
    const stub = makeStub({ maps, accounts, lines });
    const f = await loadTaxFigures(TENANT, FROM, TO, stub);
    expect(f.inputTax.toString()).toBe('25');
    // purchasesExTax = 300 only (excludes the 25 input-tax expense)
    expect(f.purchasesExTax.toString()).toBe('300');
    expect(f.purchasesInclTax.toString()).toBe('325'); // 300 + 25
  });
});
