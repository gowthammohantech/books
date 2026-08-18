// lib/ledger/voidPaymentEffects.spec.ts
//
// Two concerns:
//  (1) FX base-currency reversal (Task 5, P1 bug 3): voiding/deleting a
//      foreign-currency payment reverses the SAME base amount the create moved
//      (base = amount × the payment's own rate), never the raw foreign amount.
//  (2) Finding 1 REFIX discriminator: the register is reversed IFF the payment's
//      CREATE path moved it, signalled by the persisted movedBankBalance flag.
//      The reversal must read the FLAG — NOT a bank-line lookup, because the
//      bank-reconciliation EXPLAIN flow relabels the pre-existing imported line
//      with the SAME relatedType/relatedId this payment would carry
//      (explainPosting.ts ~L775), so a line lookup cannot discriminate. To PROVE
//      the reversal never consults a bank line, the fake tx THROWS if findFirst
//      is called on bankTransaction/pettyCashTransaction — a regression to the
//      old line-based gate would fail loudly here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  reverseInvoicePaymentEffects,
  reverseSupplierPaymentEffects,
  type PaymentEffectsTx,
} from './voidPaymentEffects';

// A stateful fake tx: bankDetail.update mutates a captured balance, and creates
// are recorded. bankTransaction/pettyCashTransaction expose NO findFirst — if the
// reversal ever tries a line lookup, the missing method (or the poison below)
// surfaces the regression.
function fakeTx() {
  const bankUpdates: any[] = [];
  const bankTxns: any[] = [];
  const pettyUpdates: any[] = [];
  const pettyTxns: any[] = [];
  // Poison: the reversal must NEVER discriminate off a bank/petty line.
  const poison = () => { throw new Error('reversal must not query a cash line — gate on movedBankBalance'); };
  return {
    bankUpdates,
    bankTxns,
    pettyUpdates,
    pettyTxns,
    bankDetail: { update: vi.fn().mockImplementation(async (a: any) => { bankUpdates.push(a); return {}; }) },
    bankTransaction: {
      create: vi.fn().mockImplementation(async (a: any) => { bankTxns.push(a.data); return {}; }),
      findFirst: vi.fn().mockImplementation(poison),
    },
    pettyCash: {
      findFirst: vi.fn().mockResolvedValue({ id: 'pc1', currentBalance: 0 }),
      update: vi.fn().mockImplementation(async (a: any) => { pettyUpdates.push(a); return {}; }),
    },
    pettyCashTransaction: {
      create: vi.fn().mockImplementation(async (a: any) => { pettyTxns.push(a.data); return {}; }),
      findFirst: vi.fn().mockImplementation(poison),
    },
    // GL reversal surface (reverseDocument → findFirst returns null → no-op)
    journalEntry: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('voidPaymentEffects — FX base-currency reversal (record path, movedBankBalance=true)', () => {
  it('reverseInvoicePaymentEffects DECREMENTS bank by the base amount (100 USD @ 83 = 8300)', async () => {
    const tx = fakeTx();
    await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'ip1', amount: '100', exchangeRate: '83', paymentModeId: 'pm1',
        bank: { id: 'b1', currentBalance: 10000 }, paymentMode: { slug: 'bank' },
        movedBankBalance: true,
      },
    });
    expect(tx.bankUpdates[0].data.currentBalance.toString()).toBe('1700'); // 10000 - 8300
    expect(tx.bankTxns[0].amount.toString()).toBe('8300');
  });

  it('reverseSupplierPaymentEffects INCREMENTS bank by the base amount (100 USD @ 83 = 8300)', async () => {
    const tx = fakeTx();
    await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'sp1', paidAmount: '100', exchangeRate: '83', paymentModeId: 'pm1',
        sourceType: 'BANK', bank: { id: 'b1', currentBalance: 0 },
        movedBankBalance: true,
      },
    });
    expect(tx.bankUpdates[0].data.currentBalance.toString()).toBe('8300'); // 0 + 8300
    expect(tx.bankTxns[0].amount.toString()).toBe('8300');
  });

  it('base-currency payment (no rate) reverses the raw amount unchanged', async () => {
    const tx = fakeTx();
    await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'ip2', amount: '250.50', paymentModeId: 'pm1',
        bank: { id: 'b1', currentBalance: 1000 }, paymentMode: { slug: 'bank' },
        movedBankBalance: true,
      },
    });
    expect(tx.bankUpdates[0].data.currentBalance.toString()).toBe('749.5'); // 1000 - 250.50
  });
});

// The LIVE bug: Prisma hands back amount/paidAmount/currentBalance as
// Prisma.Decimal INSTANCES (typeof === 'object'), not numbers/strings. The old
// baseFor guard (`typeof === 'number' || 'string' ? amount : 0`) fell through to
// 0 for a Decimal, so the register reversal moved 0 and the cash balance was
// never restored. These tests feed REAL Decimals — exactly what production does —
// and assert the FULL amount is moved, so a Decimal-zeroing regression fails loud.
describe('voidPaymentEffects — Prisma.Decimal money inputs (reproduces the live defect)', () => {
  it('reverseInvoicePaymentEffects moves the FULL Decimal amount, not 0 (record path)', async () => {
    const tx = fakeTx();
    await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'ip-dec', amount: new Prisma.Decimal('1000'), paymentModeId: 'pm1',
        bank: { id: 'b1', currentBalance: new Prisma.Decimal('290047.5') },
        paymentMode: { slug: 'bank' },
        movedBankBalance: true,
      },
    });
    // Live proof value: bank 290047.5 must drop by the full 1000 → 289047.5,
    // NOT stay at 290047.5 (which is what the amount-zeroing bug produced).
    expect(tx.bankUpdates[0].data.currentBalance.toString()).toBe('289047.5');
    expect(tx.bankTxns[0].amount.toString()).toBe('1000');
  });

  it('reverseSupplierPaymentEffects moves the FULL Decimal paidAmount, not 0 (record path)', async () => {
    const tx = fakeTx();
    await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'sp-dec', paidAmount: new Prisma.Decimal('1000'), paymentModeId: 'pm1',
        sourceType: 'BANK', bank: { id: 'b1', currentBalance: new Prisma.Decimal('290047.5') },
        movedBankBalance: true,
      },
    });
    expect(tx.bankUpdates[0].data.currentBalance.toString()).toBe('291047.5'); // + full 1000
    expect(tx.bankTxns[0].amount.toString()).toBe('1000');
  });

  it('reverseSupplierPaymentEffects (PETTY_CASH) restores the FULL Decimal paidAmount', async () => {
    const tx = fakeTx();
    await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'sp-petty-dec', paidAmount: new Prisma.Decimal('30'), paymentModeId: null,
        sourceType: 'PETTY_CASH', bank: null,
        movedBankBalance: true,
      },
    });
    expect(tx.pettyUpdates[0].data.currentBalance.toString()).toBe('30'); // 0 + full 30
    expect(tx.pettyTxns[0].amount.toString()).toBe('30');
  });

  it('FX: Decimal amount × Decimal rate reverses amount×rate in base', async () => {
    const tx = fakeTx();
    await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'ip-dec-fx', amount: new Prisma.Decimal('100'),
        exchangeRate: new Prisma.Decimal('83'), paymentModeId: 'pm1',
        bank: { id: 'b1', currentBalance: new Prisma.Decimal('10000') },
        paymentMode: { slug: 'bank' },
        movedBankBalance: true,
      },
    });
    expect(tx.bankUpdates[0].data.currentBalance.toString()).toBe('1700'); // 10000 - 8300
    expect(tx.bankTxns[0].amount.toString()).toBe('8300');
  });
});

describe('voidPaymentEffects — finding 1 REFIX: gate on movedBankBalance, NOT a bank line', () => {
  it('reverseInvoicePaymentEffects skips the register for an explain-flow receipt (movedBankBalance=false)', async () => {
    const tx = fakeTx();
    await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'ip-explain', amount: '100', exchangeRate: '83', paymentModeId: 'pm1',
        bank: { id: 'b1', currentBalance: 10000 }, paymentMode: { slug: 'bank' },
        movedBankBalance: false,
      },
    });
    // GL reversal still ran (reverseDocument called), but the register untouched —
    // the pre-existing imported bank line already owns the money.
    expect(tx.bankUpdates).toHaveLength(0);
    expect(tx.bankTxns).toHaveLength(0);
    expect(tx.bankDetail.update).not.toHaveBeenCalled();
    // Proves the reversal never consulted a bank line to decide.
    expect(tx.bankTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('reverseInvoicePaymentEffects treats a missing flag as "did not move" (undefined → skip)', async () => {
    const tx = fakeTx();
    await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'ip-none', amount: '100', paymentModeId: 'pm1',
        bank: { id: 'b1', currentBalance: 10000 }, paymentMode: { slug: 'bank' },
        // movedBankBalance omitted
      },
    });
    expect(tx.bankUpdates).toHaveLength(0);
  });

  it('reverseSupplierPaymentEffects (BANK) skips the register for an explain-flow bill payment', async () => {
    const tx = fakeTx();
    await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'sp-explain', paidAmount: '500', paymentModeId: 'pm1',
        sourceType: 'BANK', bank: { id: 'b1', currentBalance: 2000 },
        movedBankBalance: false,
      },
    });
    expect(tx.bankUpdates).toHaveLength(0);
    expect(tx.bankTxns).toHaveLength(0);
    expect(tx.bankTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('reverseSupplierPaymentEffects (BANK) still moves the register for a record-path payment', async () => {
    const tx = fakeTx();
    await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'sp-record', paidAmount: '500', paymentModeId: 'pm1',
        sourceType: 'BANK', bank: { id: 'b1', currentBalance: 2000 },
        movedBankBalance: true,
      },
    });
    expect(tx.bankUpdates[0].data.currentBalance.toString()).toBe('2500'); // 2000 + 500
    expect(tx.bankTxns[0].amount.toString()).toBe('500');
  });

  it('reverseSupplierPaymentEffects (PETTY_CASH) skips when the payment did not move the register', async () => {
    const tx = fakeTx();
    await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'sp-petty-explain', paidAmount: '30', paymentModeId: null,
        sourceType: 'PETTY_CASH', bank: null,
        movedBankBalance: false,
      },
    });
    expect(tx.pettyUpdates).toHaveLength(0);
    expect(tx.pettyCashTransaction.create).not.toHaveBeenCalled();
  });

  it('reverseSupplierPaymentEffects (PETTY_CASH) moves the register for a record-path petty payment', async () => {
    const tx = fakeTx();
    await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
      userId: 'u1',
      payment: {
        id: 'sp-petty-record', paidAmount: '30', paymentModeId: null,
        sourceType: 'PETTY_CASH', bank: null,
        movedBankBalance: true,
      },
    });
    expect(tx.pettyUpdates[0].data.currentBalance.toString()).toBe('30'); // 0 + 30
    expect(tx.pettyCashTransaction.create).toHaveBeenCalled();
  });
});
