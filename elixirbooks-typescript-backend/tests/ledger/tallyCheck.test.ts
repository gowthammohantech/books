// tests/ledger/tallyCheck.test.ts
// Tests for the tally-check reconciliation logic.
// Uses the in-memory harness (same as golden.test.ts) to post journal entries
// and then verifies the GL control vs subledger comparisons work correctly.

import { describe, it, expect } from 'vitest';
import { getPack } from '../../lib/ledger/packs/index';
import { buildHarness } from './harness';
import {
  postPurchaseReceived,
  postSupplierPayment,
  postInvoiceIssued,
  postSaleCogs,
  postInvoicePayment,
  postCreditNoteIssued,
  postCreditNoteRefund,
} from '../../lib/ledger/ledgerPosting';
import { trialBalanceFrom, type AccountBalance } from '../../lib/ledger/statements';

// ---------------------------------------------------------------------------
// Pure logic helpers extracted from reconciliationController
// (tested here without HTTP layer)
// ---------------------------------------------------------------------------

function glNet(a: AccountBalance): number {
  const d = Number(a.debit);
  const c = Number(a.credit);
  if (a.accountType === 'ASSET' || a.accountType === 'EXPENSE') return d - c;
  return c - d;
}

function sumByRole(accounts: AccountBalance[], role: string): number {
  return accounts.filter((a) => a.role === role).reduce((s, a) => s + glNet(a), 0);
}

function tied(diff: number): boolean {
  return Math.abs(diff) < 0.01;
}

// ---------------------------------------------------------------------------
// Scenario A: fully paid invoice + fully paid bill → AR=0, AP=0, TB balanced
// ---------------------------------------------------------------------------

describe('tally-check: fully settled scenario (AR=0, AP=0, TB balanced)', () => {
  const DATE = new Date('2026-06-01');
  const USER = 'u-tally-a';
  const PACK_CODE = 'IN';

  let accts: AccountBalance[];

  it('posts full scenario without error', async () => {
    const pack = getPack(PACK_CODE)!;
    const { tx, balances } = buildHarness(pack, USER);

    // Buy inventory (60, no tax), pay in full
    await postPurchaseReceived(tx, { userId: USER, purchaseId: 'pu-a1', date: DATE, total: '60', tax: '0', inventoryNet: '60', expenseNet: '0' });
    await postSupplierPayment(tx, { userId: USER, purchaseId: 'pu-a1', paymentId: 'sp-a1', date: DATE, amount: '60', paymentModeSlug: 'bank-transfer' });

    // Sell (100 net + 18 tax = 118 total), collect in full
    await postInvoiceIssued(tx, { userId: USER, invoiceId: 'inv-a1', date: DATE, total: '118', tax: '18' });
    await postSaleCogs(tx, { userId: USER, invoiceId: 'inv-a1', date: DATE, cost: '60' });
    await postInvoicePayment(tx, { userId: USER, invoiceId: 'inv-a1', paymentId: 'ip-a1', date: DATE, amount: '118', paymentModeSlug: 'bank-transfer' });

    accts = balances();
  });

  it('trial balance is balanced', () => {
    const tb = trialBalanceFrom(accts);
    expect(tb.balanced).toBe(true);
  });

  it('AR GL balance = 0 (fully collected)', () => {
    expect(sumByRole(accts, 'AR')).toBeCloseTo(0, 2);
  });

  it('AP GL balance = 0 (fully paid)', () => {
    expect(sumByRole(accts, 'AP')).toBeCloseTo(0, 2);
  });

  it('diff AR: glControl(0) - subledger(0) = 0, tied=true', () => {
    const glAr = sumByRole(accts, 'AR');
    const subledgerAr = 0; // no open invoices in this scenario
    const diff = glAr - subledgerAr;
    expect(tied(diff)).toBe(true);
    expect(diff).toBeCloseTo(0, 2);
  });

  it('diff AP: glControl(0) - subledger(0) = 0, tied=true', () => {
    const glAp = sumByRole(accts, 'AP');
    const subledgerAp = 0; // no open bills
    const diff = glAp - subledgerAp;
    expect(tied(diff)).toBe(true);
    expect(diff).toBeCloseTo(0, 2);
  });
});

// ---------------------------------------------------------------------------
// Scenario B: unpaid invoice → AR GL = 118, subledger = 118, tied
// ---------------------------------------------------------------------------

describe('tally-check: unpaid invoice scenario (AR ties)', () => {
  const DATE = new Date('2026-06-01');
  const USER = 'u-tally-b';

  let accts: AccountBalance[];

  it('posts invoice without payment', async () => {
    const pack = getPack('IN')!;
    const { tx, balances } = buildHarness(pack, USER);

    await postInvoiceIssued(tx, { userId: USER, invoiceId: 'inv-b1', date: DATE, total: '118', tax: '18' });
    await postSaleCogs(tx, { userId: USER, invoiceId: 'inv-b1', date: DATE, cost: '0' });

    accts = balances();
  });

  it('trial balance is balanced', () => {
    const tb = trialBalanceFrom(accts);
    expect(tb.balanced).toBe(true);
  });

  it('AR GL balance = 118 (invoice issued, not collected)', () => {
    expect(sumByRole(accts, 'AR')).toBeCloseTo(118, 2);
  });

  it('tied: diff = 0 when subledger also = 118', () => {
    const glAr = sumByRole(accts, 'AR');
    const subledgerAr = 118; // invoice total unpaid
    const diff = glAr - subledgerAr;
    expect(tied(diff)).toBe(true);
  });

  it('divergence detected: if subledger reports 0 (bug), diff = 118, tied=false', () => {
    const glAr = sumByRole(accts, 'AR');
    const subledgerBug = 0; // simulate a bug where subledger is wrong
    const diff = glAr - subledgerBug;
    expect(tied(diff)).toBe(false);
    expect(diff).toBeCloseTo(118, 2);
  });
});

// ---------------------------------------------------------------------------
// Scenario C: unpaid bill → AP GL = 60, subledger = 60, tied
// ---------------------------------------------------------------------------

describe('tally-check: unpaid bill scenario (AP ties)', () => {
  const DATE = new Date('2026-06-01');
  const USER = 'u-tally-c';

  let accts: AccountBalance[];

  it('posts purchase without payment', async () => {
    const pack = getPack('IN')!;
    const { tx, balances } = buildHarness(pack, USER);

    await postPurchaseReceived(tx, { userId: USER, purchaseId: 'pu-c1', date: DATE, total: '60', tax: '0', inventoryNet: '60', expenseNet: '0' });
    // No supplier payment

    accts = balances();
  });

  it('trial balance is balanced', () => {
    const tb = trialBalanceFrom(accts);
    expect(tb.balanced).toBe(true);
  });

  it('AP GL balance = 60 (bill received, not paid)', () => {
    expect(sumByRole(accts, 'AP')).toBeCloseTo(60, 2);
  });

  it('tied: diff = 0 when subledger also = 60', () => {
    const glAp = sumByRole(accts, 'AP');
    const subledgerAp = 60; // purchase balanceAmount = 60
    const diff = glAp - subledgerAp;
    expect(tied(diff)).toBe(true);
  });

  it('divergence detected: if subledger reports 50 (residual gap), diff = 10, tied=false', () => {
    const glAp = sumByRole(accts, 'AP');
    const subledgerPartial = 50; // simulate a residual gap
    const diff = glAp - subledgerPartial;
    expect(tied(diff)).toBe(false);
    expect(diff).toBeCloseTo(10, 2);
  });
});

// ---------------------------------------------------------------------------
// Scenario E: bank row shape — glMatchAvailable honesty
// Tests the pure logic of how bankRows() should behave.
// We replicate the bankRows logic inline (no DB) to exercise the shape contract.
// ---------------------------------------------------------------------------

describe('tally-check: bank rows glMatchAvailable honesty', () => {
  // Replicate the pure transformation logic from reconciliationController bankRows()
  const MONEY_OUT_TYPES_E = new Set(['WITHDRAWAL', 'PAYMENT', 'TRANSFER_OUT']);

  interface FakeBankDetail {
    id: string;
    bankName: string;
    currentBalance: number;
    openingBalance: number;
    txns: Array<{ type: string; amount: number }>;
  }

  function buildBankRow(
    b: FakeBankDetail,
    idx: number,
    totalGlBank: number,
  ) {
    const currentBal = b.currentBalance;
    let explainedNet = b.openingBalance;
    for (const tx of b.txns) {
      explainedNet = MONEY_OUT_TYPES_E.has(tx.type)
        ? explainedNet - tx.amount
        : explainedNet + tx.amount;
    }
    const cveTied = Math.abs(currentBal - explainedNet) < 0.01;
    const glMatchAvailable = idx === 0;
    const glBal = glMatchAvailable ? totalGlBank : 0;
    const glVsCurrent = glMatchAvailable ? glBal - currentBal : null;
    const glVsExplained = glMatchAvailable ? glBal - explainedNet : null;
    return {
      bankAccountId: b.id,
      name: b.bankName,
      glMatchAvailable,
      glBalance: glBal,
      currentBalance: currentBal,
      sumExplained: explainedNet,
      currentVsExplainedTied: cveTied,
      glVsCurrentTied: glVsCurrent !== null ? Math.abs(glVsCurrent) < 0.01 : null,
      glVsExplainedTied: glVsExplained !== null ? Math.abs(glVsExplained) < 0.01 : null,
      tied: glMatchAvailable
        ? (Math.abs(glVsCurrent as number) < 0.01 && Math.abs(glVsExplained as number) < 0.01)
        : null,
    };
  }

  it('first row has glMatchAvailable=true and carries the GL balance', () => {
    const bank1: FakeBankDetail = { id: 'b1', bankName: 'Main Bank', currentBalance: 1000, openingBalance: 800, txns: [{ type: 'DEPOSIT', amount: 200 }] };
    const row = buildBankRow(bank1, 0, 1000);
    expect(row.glMatchAvailable).toBe(true);
    expect(row.glBalance).toBe(1000);
    expect(row.currentVsExplainedTied).toBe(true); // 1000 vs 800+200=1000
    expect(row.glVsCurrentTied).toBe(true);
    expect(row.glVsExplainedTied).toBe(true);
    expect(row.tied).toBe(true);
  });

  it('non-first rows have glMatchAvailable=false, tied=null, GL columns null', () => {
    const bank2: FakeBankDetail = { id: 'b2', bankName: 'Savings Bank', currentBalance: 500, openingBalance: 400, txns: [{ type: 'DEPOSIT', amount: 100 }] };
    const row = buildBankRow(bank2, 1, 1000);
    expect(row.glMatchAvailable).toBe(false);
    expect(row.glBalance).toBe(0); // meaningless when glMatchAvailable=false
    expect(row.currentVsExplainedTied).toBe(true); // 500 vs 400+100=500 (real check)
    expect(row.glVsCurrentTied).toBeNull();
    expect(row.glVsExplainedTied).toBeNull();
    // CRITICAL: tied must be null, NOT true — we did not verify GL for this row
    expect(row.tied).toBeNull();
  });

  it('non-first row with diverging book vs explained is flagged via currentVsExplainedTied', () => {
    const bank2: FakeBankDetail = { id: 'b2', bankName: 'Savings Bank', currentBalance: 600, openingBalance: 400, txns: [{ type: 'DEPOSIT', amount: 100 }] };
    // currentBalance=600, sumExplained=500 — diverges
    const row = buildBankRow(bank2, 1, 1000);
    expect(row.glMatchAvailable).toBe(false);
    expect(row.currentVsExplainedTied).toBe(false); // divergence detected without GL
    expect(row.tied).toBeNull();
  });

  it('overallTied uses bankAggregate.glVsCurrentTied (new aggregate logic)', () => {
    // Two banks: both rows have glMatchAvailable=false
    const rows = [
      { glMatchAvailable: false, tied: null, currentVsExplainedTied: true, currentBalance: 1000, sumExplained: 1000 },
      { glMatchAvailable: false, tied: null, currentVsExplainedTied: true, currentBalance: 500, sumExplained: 500 },
    ];
    const bankGlFullyMatched = rows.every((r) => r.glMatchAvailable); // false
    const allCurrentVsExplainedTied = rows.every((r) => r.currentVsExplainedTied); // true
    // Aggregate: GL total = 1500 (matches Σ currentBalance)
    const totalGlBank = 1500;
    const currentTotal = rows.reduce((s, r) => s + r.currentBalance, 0); // 1500
    const glVsCurrentDiff = totalGlBank - currentTotal; // 0
    const aggregateGlVsCurrentTied = Math.abs(glVsCurrentDiff) < 0.01; // true
    const overallTied = true && true && true && allCurrentVsExplainedTied && aggregateGlVsCurrentTied;

    expect(bankGlFullyMatched).toBe(false); // multi-bank: no per-row GL
    expect(aggregateGlVsCurrentTied).toBe(true);
    expect(allCurrentVsExplainedTied).toBe(true);
    expect(overallTied).toBe(true); // aggregate check passes
  });

  it('overallTied fails if bankAggregate.glVsCurrentTied diverges', () => {
    // Two banks: aggregate GL total does NOT match Σ currentBalance
    const rows = [
      { glMatchAvailable: false, tied: null, currentVsExplainedTied: true, currentBalance: 1000 },
      { glMatchAvailable: false, tied: null, currentVsExplainedTied: true, currentBalance: 500 },
    ];
    const allCurrentVsExplainedTied = rows.every((r) => r.currentVsExplainedTied); // true
    // GL total is 1200 — mismatch
    const totalGlBank = 1200;
    const currentTotal = rows.reduce((s, r) => s + r.currentBalance, 0); // 1500
    const glVsCurrentDiff = totalGlBank - currentTotal; // -300
    const aggregateGlVsCurrentTied = Math.abs(glVsCurrentDiff) < 0.01; // false
    const overallTied = true && true && true && allCurrentVsExplainedTied && aggregateGlVsCurrentTied;

    expect(overallTied).toBe(false); // aggregate mismatch caught
  });
});

// ---------------------------------------------------------------------------
// Scenario D: overallTied = false when trial balance is unbalanced
// ---------------------------------------------------------------------------

describe('tally-check: overallTied = false when TB is not balanced', () => {
  it('tied() returns false for diff >= 0.01', () => {
    expect(tied(0.01)).toBe(false);
    expect(tied(-0.01)).toBe(false);
  });

  it('tied() returns true for diff < 0.01', () => {
    expect(tied(0.009)).toBe(true);
    expect(tied(-0.009)).toBe(true);
    expect(tied(0)).toBe(true);
  });

  it('sumByRole returns 0 for unknown role', () => {
    const accts: AccountBalance[] = [
      { id: '1', code: 'A001', name: 'Test', accountType: 'ASSET', debit: '100', credit: '50', role: 'AR' },
    ];
    expect(sumByRole(accts, 'NONEXISTENT')).toBe(0);
  });

  it('sumByRole returns debitNet for ASSET role accounts', () => {
    const accts: AccountBalance[] = [
      { id: '1', code: 'A001', name: 'AR', accountType: 'ASSET', debit: '200', credit: '50', role: 'AR' },
      { id: '2', code: 'A002', name: 'AR2', accountType: 'ASSET', debit: '30', credit: '0', role: 'AR' },
    ];
    // (200 - 50) + (30 - 0) = 180
    expect(sumByRole(accts, 'AR')).toBeCloseTo(180, 4);
  });

  it('sumByRole returns creditNet for LIABILITY role accounts', () => {
    const accts: AccountBalance[] = [
      { id: '3', code: 'L001', name: 'AP', accountType: 'LIABILITY', debit: '10', credit: '100', role: 'AP' },
    ];
    // 100 - 10 = 90
    expect(sumByRole(accts, 'AP')).toBeCloseTo(90, 4);
  });
});

// ---------------------------------------------------------------------------
// Scenario F (FF1): AR sub-ledger nets unrefunded credit notes
//
// GL posting:
//   postInvoiceIssued  → Dr AR 118  / Cr SALES + OUTPUT_TAX       GL AR = +118
//   postCreditNoteIssued → Dr SALES_RETURNS 50 / Cr AR 50         GL AR = +68
//
// arSubledger = openInvoices (118) − unrefundedCreditNotes (50) = 68
// arGl (68) − arSubledger (68) = 0 → arTied = true
//
// After cash refund: Dr AR 50 / Cr BANK → GL AR back to 118
//   arSubledger = openInvoices (118) − 0 = 118 → arTied = true
// ---------------------------------------------------------------------------

describe('tally-check FF1: AR sub-ledger nets unrefunded credit notes', () => {
  const DATE = new Date('2026-06-01');
  const USER = 'u-tally-f';

  let accts: AccountBalance[];

  it('posts invoice (118) + credit note (50, no-tax net) without refund', async () => {
    const pack = getPack('IN')!;
    const { tx, balances } = buildHarness(pack, USER);

    // Invoice: Dr AR 118 / Cr SALES 100 + OUTPUT_TAX 18
    await postInvoiceIssued(tx, { userId: USER, invoiceId: 'inv-f1', date: DATE, total: '118', tax: '18' });
    await postSaleCogs(tx, { userId: USER, invoiceId: 'inv-f1', date: DATE, cost: '0' });

    // Credit note: Dr SALES_RETURNS 50 / Cr AR 50 (no tax on net-amount CN)
    await postCreditNoteIssued(tx, { userId: USER, creditNoteId: 'cn-f1', date: DATE, total: '50', tax: '0' });

    accts = balances();
  });

  it('trial balance is balanced', () => {
    const tb = trialBalanceFrom(accts);
    expect(tb.balanced).toBe(true);
  });

  it('GL AR = 68 (118 invoice − 50 credit note)', () => {
    // AR is ASSET: net = debit - credit
    // After invoice: AR debit 118 / After CN: AR credit 50 → net = 68
    expect(sumByRole(accts, 'AR')).toBeCloseTo(68, 2);
  });

  it('arSubledger = openInvoices(118) − unrefundedCN(50) = 68, ties to GL', () => {
    const glAr = sumByRole(accts, 'AR'); // 68
    // Simulate the corrected subledger: openInvoicesTotal=118, openCreditNotesAr=50
    const openInvoices = 118;
    const openCreditNotes = 50;
    const arSubledger = openInvoices - openCreditNotes; // 68
    const diff = glAr - arSubledger;
    expect(arSubledger).toBeCloseTo(68, 2);
    expect(tied(diff)).toBe(true);
    expect(diff).toBeCloseTo(0, 2);
  });

  it('FALSE divergence arTied=false when CN not subtracted (old bug)', () => {
    const glAr = sumByRole(accts, 'AR'); // 68
    // Old behaviour: subledger = openInvoices only, credit note NOT subtracted
    const subledgerBug = 118; // the erroneous subledger that ignores the CN
    const diff = glAr - subledgerBug; // 68 - 118 = -50
    expect(tied(diff)).toBe(false); // would show arTied=false on a correct install
    expect(diff).toBeCloseTo(-50, 2);
  });
});

describe('tally-check FF1: refunded credit note is excluded from AR subledger', () => {
  const DATE = new Date('2026-06-01');
  const USER = 'u-tally-g';

  let accts: AccountBalance[];

  it('posts invoice (118) + credit note (50) + cash refund of the CN', async () => {
    const pack = getPack('IN')!;
    const { tx, balances } = buildHarness(pack, USER);

    // Invoice: Dr AR 118 / Cr SALES 100 + OUTPUT_TAX 18
    await postInvoiceIssued(tx, { userId: USER, invoiceId: 'inv-g1', date: DATE, total: '118', tax: '18' });
    await postSaleCogs(tx, { userId: USER, invoiceId: 'inv-g1', date: DATE, cost: '0' });

    // Credit note: Dr SALES_RETURNS 50 / Cr AR 50
    await postCreditNoteIssued(tx, { userId: USER, creditNoteId: 'cn-g1', date: DATE, total: '50', tax: '0' });

    // Cash refund of CN: Dr AR 50 / Cr BANK 50
    // In production this is posted via explainPosting credit_note_link behaviour.
    // The postCreditNoteRefund function mirrors that posting path exactly.
    await postCreditNoteRefund(tx, { userId: USER, creditNoteId: 'cn-g1', date: DATE, amount: '50' });

    accts = balances();
  });

  it('trial balance is balanced after refund', () => {
    const tb = trialBalanceFrom(accts);
    expect(tb.balanced).toBe(true);
  });

  it('GL AR = 118 after refund (CN back out of AR)', () => {
    // CN issued: Cr AR 50; CN refund: Dr AR 50 → net AR change = 0
    // AR net = invoice debit 118 = 118
    expect(sumByRole(accts, 'AR')).toBeCloseTo(118, 2);
  });

  it('arSubledger = openInvoices(118) − refundedCN(0) = 118, ties to GL', () => {
    const glAr = sumByRole(accts, 'AR'); // 118
    // Refunded CN is excluded from openCreditNotesAr → openCreditNotes = 0
    const openInvoices = 118;
    const openCreditNotes = 0; // refunded, no longer in AR
    const arSubledger = openInvoices - openCreditNotes; // 118
    const diff = glAr - arSubledger;
    expect(arSubledger).toBeCloseTo(118, 2);
    expect(tied(diff)).toBe(true);
    expect(diff).toBeCloseTo(0, 2);
  });
});

// ---------------------------------------------------------------------------
// Scenario G: multi-bank aggregate bank GL check
//
// Two banks:
//   Bank1: openingBalance=1000, one DEPOSIT of 200 → sumExplained=1200, currentBalance=1200
//   Bank2: openingBalance=500, one WITHDRAWAL of 100 → sumExplained=400, currentBalance=400
//
// GL total (BANK+CASH): 1200 + 400 = 1600 (after opening-balance JEs are posted)
//
// Per-row: glMatchAvailable=false for both (N=2 > 1)
// Aggregate: glTotal=1600, currentTotal=1600 → glVsCurrentTied=true
// overallTied=true (all checks pass)
// ---------------------------------------------------------------------------

describe('tally-check Scenario G: multi-bank aggregate GL check', () => {
  const MONEY_OUT_TYPES_G = new Set(['WITHDRAWAL', 'PAYMENT', 'TRANSFER_OUT']);

  interface FakeBankG {
    id: string;
    bankName: string;
    currentBalance: number;
    openingBalance: number;
    txns: Array<{ type: string; amount: number }>;
  }

  function buildRowG(b: FakeBankG, isOnlyBank: boolean, totalGlBank: number) {
    const currentBal = b.currentBalance;
    let explainedNet = b.openingBalance;
    for (const tx of b.txns) {
      explainedNet = MONEY_OUT_TYPES_G.has(tx.type)
        ? explainedNet - tx.amount
        : explainedNet + tx.amount;
    }
    const cveTied = Math.abs(currentBal - explainedNet) < 0.01;
    // New rule: per-row GL match only for single-bank installs (idx=0 AND isOnlyBank)
    const glMatchAvailable = isOnlyBank;
    const glBal = glMatchAvailable ? totalGlBank : 0;
    const glVsCurrent = glMatchAvailable ? glBal - currentBal : null;
    const glVsExplained = glMatchAvailable ? glBal - explainedNet : null;
    return {
      bankAccountId: b.id,
      name: b.bankName,
      glMatchAvailable,
      glBalance: glBal,
      currentBalance: currentBal,
      sumExplained: explainedNet,
      currentVsExplainedTied: cveTied,
      glVsCurrentTied: glVsCurrent !== null ? Math.abs(glVsCurrent) < 0.01 : null,
      glVsExplainedTied: glVsExplained !== null ? Math.abs(glVsExplained) < 0.01 : null,
      tied: glMatchAvailable
        ? (Math.abs(glVsCurrent as number) < 0.01 && Math.abs(glVsExplained as number) < 0.01)
        : null,
    };
  }

  function buildAggregate(rows: ReturnType<typeof buildRowG>[], totalGlBank: number, singleBank: boolean) {
    const currentTotal = rows.reduce((s, r) => s + r.currentBalance, 0);
    const explainedTotal = rows.reduce((s, r) => s + r.sumExplained, 0);
    const glVsCurrentDiff = Number((totalGlBank - currentTotal).toFixed(4));
    const glVsExplainedDiff = Number((totalGlBank - explainedTotal).toFixed(4));
    return {
      glTotal: totalGlBank,
      currentTotal,
      explainedTotal,
      glVsCurrentDiff,
      glVsExplainedDiff,
      glVsCurrentTied: Math.abs(glVsCurrentDiff) < 0.01,
      glVsExplainedTied: Math.abs(glVsExplainedDiff) < 0.01,
      perBankGlAvailable: singleBank,
    };
  }

  const bank1: FakeBankG = {
    id: 'b1', bankName: 'HDFC Bank',
    currentBalance: 1200, openingBalance: 1000,
    txns: [{ type: 'DEPOSIT', amount: 200 }],
  };
  const bank2: FakeBankG = {
    id: 'b2', bankName: 'ICICI Bank',
    currentBalance: 400, openingBalance: 500,
    txns: [{ type: 'WITHDRAWAL', amount: 100 }],
  };
  const totalGlBank = 1600; // 1200 + 400 (both opening balances now in GL)

  it('multi-bank: both rows have glMatchAvailable=false', () => {
    const singleBank = false;
    const row1 = buildRowG(bank1, singleBank, totalGlBank);
    const row2 = buildRowG(bank2, singleBank, totalGlBank);
    expect(row1.glMatchAvailable).toBe(false);
    expect(row2.glMatchAvailable).toBe(false);
    expect(row1.tied).toBeNull();
    expect(row2.tied).toBeNull();
  });

  it('multi-bank: per-row currentVsExplainedTied is still computed (real check)', () => {
    const singleBank = false;
    const row1 = buildRowG(bank1, singleBank, totalGlBank);
    const row2 = buildRowG(bank2, singleBank, totalGlBank);
    // bank1: currentBalance=1200, sumExplained=1000+200=1200 → tied
    expect(row1.currentVsExplainedTied).toBe(true);
    expect(row1.sumExplained).toBeCloseTo(1200, 2);
    // bank2: currentBalance=400, sumExplained=500-100=400 → tied
    expect(row2.currentVsExplainedTied).toBe(true);
    expect(row2.sumExplained).toBeCloseTo(400, 2);
  });

  it('multi-bank: aggregate glVsCurrentTied=true when GL total == Σ currentBalance', () => {
    const singleBank = false;
    const rows = [buildRowG(bank1, singleBank, totalGlBank), buildRowG(bank2, singleBank, totalGlBank)];
    const agg = buildAggregate(rows, totalGlBank, singleBank);
    // currentTotal = 1200 + 400 = 1600 == glTotal=1600
    expect(agg.glTotal).toBeCloseTo(1600, 2);
    expect(agg.currentTotal).toBeCloseTo(1600, 2);
    expect(agg.glVsCurrentDiff).toBeCloseTo(0, 4);
    expect(agg.glVsCurrentTied).toBe(true);
    expect(agg.perBankGlAvailable).toBe(false);
  });

  it('multi-bank: overallTied=true when aggregate and all per-row checks pass', () => {
    const singleBank = false;
    const rows = [buildRowG(bank1, singleBank, totalGlBank), buildRowG(bank2, singleBank, totalGlBank)];
    const agg = buildAggregate(rows, totalGlBank, singleBank);
    const allCurrentVsExplainedTied = rows.every((r) => r.currentVsExplainedTied);
    // New overallTied formula uses aggregate (not allGlMatchedTied)
    const overallTied = true /* tb.balanced */ && true /* arTied */ && true /* apTied */ &&
      allCurrentVsExplainedTied && agg.glVsCurrentTied;
    expect(overallTied).toBe(true);
  });

  it('multi-bank: overallTied=false when aggregate glVsCurrentTied=false (GL gap)', () => {
    const singleBank = false;
    const rows = [buildRowG(bank1, singleBank, totalGlBank), buildRowG(bank2, singleBank, totalGlBank)];
    // Simulate missing opening-balance JE: GL only sees movements, not openings
    const totalGlBankWithGap = 300; // only net movements posted, not the 1300 opening total
    const agg = buildAggregate(rows, totalGlBankWithGap, singleBank);
    const allCurrentVsExplainedTied = rows.every((r) => r.currentVsExplainedTied);
    const overallTied = true && true && true && allCurrentVsExplainedTied && agg.glVsCurrentTied;
    expect(agg.glVsCurrentTied).toBe(false);
    expect(overallTied).toBe(false); // gap detected correctly
  });

  it('single-bank: glMatchAvailable=true for row 0, aggregate mirrors row', () => {
    const singleBank = true;
    const totalGlBankSingle = 1200; // one bank with opening 1000 + deposit 200 in GL
    const row1 = buildRowG(bank1, singleBank, totalGlBankSingle);
    expect(row1.glMatchAvailable).toBe(true);
    expect(row1.glBalance).toBe(1200);
    expect(row1.tied).toBe(true);
    const agg = buildAggregate([row1], totalGlBankSingle, singleBank);
    expect(agg.perBankGlAvailable).toBe(true);
    expect(agg.glVsCurrentTied).toBe(true);
  });
});
