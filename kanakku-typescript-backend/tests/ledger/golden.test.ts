// tests/ledger/golden.test.ts
// Golden-number integration tests — Slice B.9
//
// Scenario: buy inventory at cost 60 (no tax), sell it for 100 net + 18 tax (total 118),
// collect payment in full. Verify the final P&L and balance-sheet numbers match
// across all six country packs.
//
// Expected golden numbers:
//   Revenue              = 100
//   COGS                 = 60
//   Gross profit         = 40
//   Net income           = 40
//   Output tax liability = 18
//   Bank                 = 58   (collected 118, paid out 60)
//   AR                   = 0    (fully paid)
//   Inventory            = 0    (sold)
//   Equity (net income)  = 40
//   Total liabilities    = 18
//   Total assets         = 58

import { describe, it, expect } from 'vitest';
import { getPack } from '../../lib/ledger/packs/index';
import { buildHarness } from './harness';
import {
  postPurchaseReceived,
  postSupplierPayment,
  postInvoiceIssued,
  postSaleCogs,
  postInvoicePayment,
} from '../../lib/ledger/ledgerPosting';
import { profitLossFrom, balanceSheetFrom, trialBalanceFrom } from '../../lib/ledger/statements';

const COUNTRY_CODES = ['IN', 'GB', 'EU', 'US', 'AU', 'NZ'];

const DATE = new Date('2026-06-01');
const USER = 'u-golden';

// ---------------------------------------------------------------------------
// One full scenario against a single pack — returns P&L + balance sheet
// ---------------------------------------------------------------------------

async function runScenario(countryCode: string) {
  const pack = getPack(countryCode);
  if (!pack) throw new Error(`Unknown pack: ${countryCode}`);

  const { tx, balances } = buildHarness(pack, USER);

  // Step 1: Receive inventory (cost 60, no tax)
  await postPurchaseReceived(tx, {
    userId: USER,
    purchaseId: `pu-${countryCode}`,
    date: DATE,
    total: '60',
    tax: '0',
    inventoryNet: '60',
    expenseNet: '0',
  });

  // Step 2: Pay supplier in full (Bank)
  await postSupplierPayment(tx, {
    userId: USER,
    purchaseId: `pu-${countryCode}`,
    paymentId: `sp-${countryCode}`,
    date: DATE,
    amount: '60',
    paymentModeSlug: 'bank-transfer',
  });

  // Step 3: Issue invoice (revenue 100, tax 18, total 118)
  await postInvoiceIssued(tx, {
    userId: USER,
    invoiceId: `inv-${countryCode}`,
    date: DATE,
    total: '118',
    tax: '18',
  });

  // Step 4: Recognize COGS at purchase cost
  await postSaleCogs(tx, {
    userId: USER,
    invoiceId: `inv-${countryCode}`,
    date: DATE,
    cost: '60',
  });

  // Step 5: Collect payment in full (Bank)
  await postInvoicePayment(tx, {
    userId: USER,
    invoiceId: `inv-${countryCode}`,
    paymentId: `ip-${countryCode}`,
    date: DATE,
    amount: '118',
    paymentModeSlug: 'bank-transfer',
  });

  const accts = balances();
  const pl = profitLossFrom(accts);
  const bs = balanceSheetFrom(accts);
  const tb = trialBalanceFrom(accts);

  return { pl, bs, tb, accts };
}

// ---------------------------------------------------------------------------
// Per-pack describe blocks
// ---------------------------------------------------------------------------

for (const cc of COUNTRY_CODES) {
  describe(`Golden scenario — ${cc}`, () => {
    // Run once per pack, share results across its 'it' blocks
    let results: Awaited<ReturnType<typeof runScenario>>;

    it('scenario runs without errors', async () => {
      results = await runScenario(cc);
    });

    it('trial balance is balanced', () => {
      expect(results.tb.balanced).toBe(true);
    });

    it('P&L: revenue = 100', () => {
      expect(results.pl.revenue.total).toBeCloseTo(100, 2);
    });

    it('P&L: COGS = 60', () => {
      expect(results.pl.costOfGoodsSold.total).toBeCloseTo(60, 2);
    });

    it('P&L: gross profit = 40', () => {
      expect(results.pl.grossProfit).toBeCloseTo(40, 2);
    });

    it('P&L: net income = 40', () => {
      expect(results.pl.netIncome).toBeCloseTo(40, 2);
    });

    it('P&L: output tax = 18', () => {
      expect(results.pl.taxes.outputTax).toBeCloseTo(18, 2);
    });

    it('Balance sheet: bank = 58', () => {
      expect(results.bs.assets.current.cashAndBank).toBeCloseTo(58, 2);
    });

    it('Balance sheet: AR = 0', () => {
      expect(results.bs.assets.current.receivables).toBeCloseTo(0, 2);
    });

    it('Balance sheet: inventory = 0', () => {
      expect(results.bs.assets.current.inventory).toBeCloseTo(0, 2);
    });

    it('Balance sheet: total liabilities = 18', () => {
      expect(results.bs.liabilities.total).toBeCloseTo(18, 2);
    });

    it('Balance sheet: total assets = 58', () => {
      expect(results.bs.assets.total).toBeCloseTo(58, 2);
    });

    it('Balance sheet: equity (net income) = 40', () => {
      // retainedEarnings in balanceSheetFrom represents net income for the period
      expect(results.bs.equity.retainedEarnings).toBeCloseTo(40, 2);
    });

    it('Balance sheet: total liabilities + equity = total assets', () => {
      expect(results.bs.totalLiabilitiesAndEquity).toBeCloseTo(results.bs.assets.total, 2);
    });
  });
}

// ---------------------------------------------------------------------------
// Multi-currency / realized FX (Spec G) — statements aggregate BASE amounts.
// Foreign invoice 118 USD @ 80 on issue, paid 118 USD @ 82 → FX gain 236 (base).
// ---------------------------------------------------------------------------
describe('golden — realized FX (foreign invoice paid at a higher rate)', () => {
  async function run() {
    const pack = getPack('IN')!; // functional INR
    const { tx, balances } = buildHarness(pack);
    await postInvoiceIssued(tx, { userId: USER, invoiceId: 'fx1', date: DATE, total: '118', tax: '18', currencyCode: 'USD', exchangeRate: '80' });
    await postInvoicePayment(tx, { userId: USER, invoiceId: 'fx1', paymentId: 'fxp1', date: new Date('2026-06-20'), amount: '118', currencyCode: 'USD', paymentRate: '82', documentRate: '80' });
    return { tb: trialBalanceFrom(balances()), bs: balanceSheetFrom(balances()), b: balances() };
  }

  it('trial balance ties out in base currency', async () => {
    expect((await run()).tb.balanced).toBe(true);
  });

  it('bank recorded at payment-rate base (118 × 82 = 9676)', async () => {
    const { b } = await run();
    const bank = b.find((a) => a.role === 'BANK')!;
    expect(Number(bank.debit) - Number(bank.credit)).toBeCloseTo(9676, 2);
  });

  it('AR fully relieved (0) at the original document rate', async () => {
    const { b } = await run();
    const ar = b.find((a) => a.role === 'AR')!;
    expect(Number(ar.debit) - Number(ar.credit)).toBeCloseTo(0, 2);
  });

  it('FX gain of 236 recognized (credit FX_GAIN_LOSS)', async () => {
    const { b } = await run();
    const fx = b.find((a) => a.role === 'FX_GAIN_LOSS')!;
    expect(Number(fx.credit) - Number(fx.debit)).toBeCloseTo(236, 2);
  });

  it('balance sheet still balances with the FX effect', async () => {
    const { bs } = await run();
    expect(bs.totalLiabilitiesAndEquity).toBeCloseTo(bs.assets.total, 2);
  });
});
