// lib/ledger/ledgerPosting.ts
import { post, reverse, type LedgerTx } from './postingEngine';
import { shouldPost } from './postingGate';
import { LedgerError, PeriodLockedError } from './buildLines';
import { toDecimal, sumDecimals } from './money';
import type { LineInstruction, PostingSide } from './types';
import type { CentreNet } from './dimensionSplit';
import type { DecimalInput } from './money';

/** The slice of Prisma the posting layer needs (superset of LedgerTx). */
export interface PostingTx extends LedgerTx {
  companySettings: { findFirst: (args: unknown) => Promise<{ ledgerInitialized: boolean; goLiveDate: Date | null } | null> };
}

const sub = (total: string, tax: string): string => toDecimal(total).minus(toDecimal(tax)).toString();
const isPos = (v: string): boolean => toDecimal(v).greaterThan(0);

/** Fail fast with a domain message when a pre-computed split (e.g. a purchase's
 *  inventory/expense/tax breakdown) does not reconcile to the document total.
 *  Without this, an inconsistent split would surface as an opaque
 *  "unbalanced entry" error from the posting engine. */
function assertSplit(label: string, total: string, parts: string[]): void {
  const partsSum = sumDecimals(parts.map((p) => toDecimal(p)));
  if (!partsSum.equals(toDecimal(total))) {
    throw new LedgerError(
      `${label} split does not reconcile: parts ${partsSum.toFixed(4)} != total ${toDecimal(total).toFixed(4)}`,
    );
  }
}

export function cashRoleFor(p: { paymentModeSlug?: string | null; sourceType?: string | null }): 'BANK' | 'CASH' | 'ACCOUNT_CREDIT' {
  // Redeeming a customer's Account Credit balance settles AR with no real
  // cash/bank movement — Dr ACCOUNT_CREDIT (liability) / Cr AR instead of
  // Dr BANK|CASH. Checked before the cash/bank binary so it never falls
  // through to BANK.
  if (p.paymentModeSlug === 'account-credit') return 'ACCOUNT_CREDIT';
  if (p.sourceType === 'PETTY_CASH') return 'CASH';
  if (p.paymentModeSlug && p.paymentModeSlug.toLowerCase().includes('cash')) return 'CASH';
  return 'BANK';
}

/**
 * Build the cash/bank leg of a posting.
 *
 * When the leg resolves to the BANK role AND a per-bank GL sub-account is known
 * (`bankGlAccountId`, from BankDetail.accountId), target that sub-account via an
 * explicit accountId override so the bank's GL ties out per-account. Otherwise
 * (CASH role, or an un-backfilled bank where bankGlAccountId is null) fall back
 * to the role key exactly as before — identical amount, sign and balance.
 */
function bankCashLeg(
  role: 'BANK' | 'CASH' | 'ACCOUNT_CREDIT',
  side: PostingSide,
  amount: string,
  bankGlAccountId?: string | null,
  baseAmount?: string,
): LineInstruction {
  const leg: LineInstruction =
    role === 'BANK' && bankGlAccountId
      ? { accountId: bankGlAccountId, side, amount }
      : { roleKey: role, side, amount };
  if (baseAmount != null) leg.baseAmount = baseAmount;
  return leg;
}

export async function gatedPost(
  tx: PostingTx, tenantId: string, date: Date,
  sourceType: string, sourceId: string, event: string,
  instructions: LineInstruction[], description?: string,
  currencyCode = 'BASE', exchangeRate?: DecimalInput,
  costCenterId?: string | null, projectId?: string | null,
): Promise<void> {
  const settings = await tx.companySettings.findFirst({ where: { tenantId } });
  if (!shouldPost(settings, date)) return;
  await post(tx, { tenantId, sourceType, sourceId, event, date, currencyCode, exchangeRate, instructions, description, costCenterId, projectId });
}

export async function postInvoiceIssued(
  tx: PostingTx,
  p: { tenantId: string; invoiceId: string; date: Date; total: string; tax: string; currencyCode?: string; exchangeRate?: DecimalInput; costCenterId?: string | null; projectId?: string | null; revenueByCentre?: CentreNet[] },
): Promise<void> {
  const net = sub(p.total, p.tax);
  const lines: LineInstruction[] = [{ roleKey: 'AR', side: 'debit', amount: p.total }];

  if (p.revenueByCentre?.length) {
    // One revenue leg per department. Reconciliation is asserted here rather
    // than left to buildLines, so a bad split reports itself as a split problem
    // instead of an opaque "unbalanced entry".
    assertSplit('invoice.issued revenue', net, p.revenueByCentre.map((g) => g.net));
    for (const g of p.revenueByCentre) {
      lines.push({ roleKey: 'SALES_REVENUE', side: 'credit', amount: g.net, costCenterId: g.costCenterId });
    }
  } else {
    lines.push({ roleKey: 'SALES_REVENUE', side: 'credit', amount: net });
  }

  // AR and OUTPUT_TAX deliberately stay on the document's own centre (they
  // inherit it via the engine's document-level default). A receivable and an
  // output-tax liability are balance-sheet items belonging to the entity, not
  // to a department; splitting them would need an allocation rule.
  if (isPos(p.tax)) lines.push({ roleKey: 'OUTPUT_TAX', side: 'credit', amount: p.tax, taxRoleKey: 'OUTPUT_TAX' });
  await gatedPost(tx, p.tenantId, p.date, 'Invoice', p.invoiceId, 'issued', lines, undefined, p.currencyCode ?? 'BASE', p.exchangeRate, p.costCenterId, p.projectId);
}

export async function postInvoicePayment(
  tx: PostingTx,
  p: {
    tenantId: string;
    invoiceId: string;
    paymentId: string;
    date: Date;
    amount: string;
    paymentModeSlug?: string | null;
    /** Per-bank GL sub-account (BankDetail.accountId) for the BANK leg; null → shared BANK role. */
    bankGlAccountId?: string | null;
    /** FX settlement: foreign currencyCode, rate at payment date, rate at document date */
    currencyCode?: string;
    paymentRate?: DecimalInput;
    documentRate?: DecimalInput;
  },
): Promise<void> {
  const into = cashRoleFor({ paymentModeSlug: p.paymentModeSlug });
  const isForeign = !!p.currencyCode && p.currencyCode !== 'BASE';
  const payRate = isForeign && p.paymentRate != null ? toDecimal(p.paymentRate) : null;
  const docRate = isForeign && p.documentRate != null ? toDecimal(p.documentRate) : null;
  const hasFxDiff = payRate != null && docRate != null && !payRate.equals(docRate);

  if (isForeign && hasFxDiff && payRate != null && docRate != null) {
    const amount = toDecimal(p.amount);
    // Bank: cash in at payment rate
    const bankBase = amount.times(payRate).toFixed(4);
    // AR: relieved at document rate (original posting rate)
    const arBase = amount.times(docRate).toFixed(4);
    // FX residual: |bankBase - arBase| — computed from already-rounded legs so
    // the three base amounts balance by construction (avoids repeating-decimal drift)
    const fxBase = toDecimal(bankBase).minus(toDecimal(arBase)).abs().toFixed(4);
    // paymentRate > documentRate → gain (credit FX); paymentRate < documentRate → loss (debit FX)
    const fxSide = payRate.greaterThan(docRate) ? 'credit' : 'debit';

    const lines: LineInstruction[] = [
      bankCashLeg(into, 'debit', p.amount, p.bankGlAccountId, bankBase),
      { roleKey: 'AR', side: 'credit', amount: p.amount, baseAmount: arBase },
      { roleKey: 'FX_GAIN_LOSS', side: fxSide, amount: '0', baseAmount: fxBase },
    ];
    await gatedPost(tx, p.tenantId, p.date, 'InvoicePayment', p.paymentId, 'payment', lines, undefined, p.currencyCode!, payRate);
  } else {
    // Functional currency path or equal rates — no FX leg
    await gatedPost(tx, p.tenantId, p.date, 'InvoicePayment', p.paymentId, 'payment', [
      bankCashLeg(into, 'debit', p.amount, p.bankGlAccountId),
      { roleKey: 'AR', side: 'credit', amount: p.amount },
    ], undefined, p.currencyCode ?? 'BASE', p.paymentRate);
  }
}

export async function postPurchaseReceived(
  tx: PostingTx,
  p: { tenantId: string; purchaseId: string; date: Date; total: string; tax: string; inventoryNet: string; expenseNet: string; currencyCode?: string; exchangeRate?: DecimalInput; costCenterId?: string | null; projectId?: string | null; inventoryByCentre?: CentreNet[]; expenseByCentre?: CentreNet[] },
): Promise<void> {
  assertSplit('purchase.received', p.total, [p.inventoryNet, p.expenseNet, p.tax]);
  const lines: LineInstruction[] = [];

  // Split each debit bucket across departments when the lines disagree with the
  // header. AP and INPUT_TAX stay on the document's own centre for the same
  // reason AR does on a sale — they are entity-level balance-sheet items.
  const pushSplit = (
    roleKey: 'INVENTORY' | 'PURCHASES',
    bucketTotal: string,
    groups: CentreNet[] | undefined,
  ): void => {
    if (groups?.length) {
      assertSplit(`purchase.received.${roleKey.toLowerCase()}`, bucketTotal, groups.map((g) => g.net));
      for (const g of groups) {
        if (isPos(g.net)) lines.push({ roleKey, side: 'debit', amount: g.net, costCenterId: g.costCenterId });
      }
      return;
    }
    if (isPos(bucketTotal)) lines.push({ roleKey, side: 'debit', amount: bucketTotal });
  };

  pushSplit('INVENTORY', p.inventoryNet, p.inventoryByCentre);
  pushSplit('PURCHASES', p.expenseNet, p.expenseByCentre);
  if (isPos(p.tax)) lines.push({ roleKey: 'INPUT_TAX', side: 'debit', amount: p.tax, taxRoleKey: 'INPUT_TAX' });
  lines.push({ roleKey: 'AP', side: 'credit', amount: p.total });
  await gatedPost(tx, p.tenantId, p.date, 'Purchase', p.purchaseId, 'received', lines, undefined, p.currencyCode ?? 'BASE', p.exchangeRate, p.costCenterId, p.projectId);
}

export async function postSupplierPayment(
  tx: PostingTx,
  p: {
    tenantId: string;
    purchaseId: string;
    paymentId: string;
    date: Date;
    amount: string;
    sourceType?: string | null;
    paymentModeSlug?: string | null;
    /** Per-bank GL sub-account (BankDetail.accountId) for the BANK leg; null → shared BANK role. */
    bankGlAccountId?: string | null;
    /** FX settlement: foreign currencyCode, rate at payment date, rate at document date */
    currencyCode?: string;
    paymentRate?: DecimalInput;
    documentRate?: DecimalInput;
  },
): Promise<void> {
  const from = cashRoleFor({ sourceType: p.sourceType, paymentModeSlug: p.paymentModeSlug });
  const isForeign = !!p.currencyCode && p.currencyCode !== 'BASE';
  const payRate = isForeign && p.paymentRate != null ? toDecimal(p.paymentRate) : null;
  const docRate = isForeign && p.documentRate != null ? toDecimal(p.documentRate) : null;
  const hasFxDiff = payRate != null && docRate != null && !payRate.equals(docRate);

  if (isForeign && hasFxDiff && payRate != null && docRate != null) {
    const amount = toDecimal(p.amount);
    // AP: settled at document rate (original posting rate)
    const apBase = amount.times(docRate).toFixed(4);
    // Bank/Cash: paid out at payment rate
    const cashBase = amount.times(payRate).toFixed(4);
    // FX residual: |cashBase - apBase| — computed from already-rounded legs so
    // the three base amounts balance by construction (avoids repeating-decimal drift)
    const fxBase = toDecimal(cashBase).minus(toDecimal(apBase)).abs().toFixed(4);
    // paymentRate > documentRate → we paid MORE base → FX loss (debit)
    // paymentRate < documentRate → we paid LESS base → FX gain (credit)
    // Verify balance: Dr AP (apBase) + Dr/Cr FX = Cr Cash (cashBase)
    // paymentRate > docRate: Dr AP (apBase) + Dr FX (fxBase) = Cr CASH (cashBase)
    //   e.g. apBase=80000 + fxBase=3000 = cashBase=83000 ✓
    // paymentRate < docRate: Dr AP (apBase) = Cr CASH (cashBase) + Cr FX (fxBase)
    //   e.g. apBase=80000 = cashBase=79000 + fxBase=1000 ✓
    const fxSide = payRate.greaterThan(docRate) ? 'debit' : 'credit';

    const lines: LineInstruction[] = [
      { roleKey: 'AP', side: 'debit', amount: p.amount, baseAmount: apBase },
      bankCashLeg(from, 'credit', p.amount, p.bankGlAccountId, cashBase),
      { roleKey: 'FX_GAIN_LOSS', side: fxSide, amount: '0', baseAmount: fxBase },
    ];
    await gatedPost(tx, p.tenantId, p.date, 'SupplierPayment', p.paymentId, 'payment', lines, undefined, p.currencyCode!, payRate);
  } else {
    // Functional currency path or equal rates — no FX leg
    await gatedPost(tx, p.tenantId, p.date, 'SupplierPayment', p.paymentId, 'payment', [
      { roleKey: 'AP', side: 'debit', amount: p.amount },
      bankCashLeg(from, 'credit', p.amount, p.bankGlAccountId),
    ], undefined, p.currencyCode ?? 'BASE', p.paymentRate);
  }
}

export async function postExpense(
  tx: PostingTx,
  p: { tenantId: string; expenseId: string; date: Date; total: string; tax: string; expenseAccountId: string; sourceType?: string | null; paymentModeSlug?: string | null; bankGlAccountId?: string | null; employeePayableAccountId?: string; costCenterId?: string | null; projectId?: string | null; currencyCode?: string; exchangeRate?: DecimalInput },
): Promise<void> {
  const net = sub(p.total, p.tax);
  const lines: LineInstruction[] = [{ accountId: p.expenseAccountId, side: 'debit', amount: net }];
  if (isPos(p.tax)) lines.push({ roleKey: 'INPUT_TAX', side: 'debit', amount: p.tax, taxRoleKey: 'INPUT_TAX' });
  if (p.sourceType === 'EMPLOYEE_PAID') {
    // Reimbursable: company hasn't paid — owe the employee the gross amount.
    if (!p.employeePayableAccountId) {
      throw new LedgerError('postExpense: employeePayableAccountId is required for EMPLOYEE_PAID expenses');
    }
    lines.push({ accountId: p.employeePayableAccountId, side: 'credit', amount: p.total });
  } else {
    const from = cashRoleFor({ sourceType: p.sourceType, paymentModeSlug: p.paymentModeSlug });
    lines.push(bankCashLeg(from, 'credit', p.total, p.bankGlAccountId));
  }
  const effectiveCurrency = p.currencyCode && p.currencyCode !== 'BASE' ? p.currencyCode : 'BASE';
  const effectiveRate = effectiveCurrency !== 'BASE' ? p.exchangeRate : undefined;
  await gatedPost(tx, p.tenantId, p.date, 'Expense', p.expenseId, 'recorded', lines, undefined, effectiveCurrency, effectiveRate, p.costCenterId, p.projectId);
}

export async function postCreditNoteIssued(
  tx: PostingTx, p: { tenantId: string; creditNoteId: string; date: Date; total: string; tax: string; currencyCode?: string; exchangeRate?: DecimalInput },
): Promise<void> {
  const net = sub(p.total, p.tax);
  const lines: LineInstruction[] = [{ roleKey: 'SALES_RETURNS', side: 'debit', amount: net }];
  if (isPos(p.tax)) lines.push({ roleKey: 'OUTPUT_TAX', side: 'debit', amount: p.tax, taxRoleKey: 'OUTPUT_TAX' });
  lines.push({ roleKey: 'AR', side: 'credit', amount: p.total });
  await gatedPost(tx, p.tenantId, p.date, 'CreditNote', p.creditNoteId, 'issued', lines, undefined, p.currencyCode ?? 'BASE', p.exchangeRate);
}

/**
 * Post a cash refund of a credit note: Dr AR / Cr BANK.
 * Mirrors the `credit_note_link` posting in explainPosting.ts.
 * Calling this removes the credit note from the AR sub-ledger
 * (the unrefunded CN balance in AR is extinguished).
 */
export async function postCreditNoteRefund(
  tx: PostingTx, p: { tenantId: string; creditNoteId: string; date: Date; amount: string; currencyCode?: string; exchangeRate?: DecimalInput },
): Promise<void> {
  await gatedPost(tx, p.tenantId, p.date, 'CreditNote', p.creditNoteId, 'refund', [
    { roleKey: 'AR', side: 'debit', amount: p.amount },
    { roleKey: 'BANK', side: 'credit', amount: p.amount },
  ], undefined, p.currencyCode ?? 'BASE', p.exchangeRate);
}

export async function postDebitNoteIssued(
  tx: PostingTx, p: { tenantId: string; debitNoteId: string; date: Date; total: string; tax: string; inventoryNet: string; expenseNet: string },
): Promise<void> {
  assertSplit('debitNote.issued', p.total, [p.inventoryNet, p.expenseNet, p.tax]);
  const lines: LineInstruction[] = [{ roleKey: 'AP', side: 'debit', amount: p.total }];
  if (isPos(p.tax)) lines.push({ roleKey: 'INPUT_TAX', side: 'credit', amount: p.tax, taxRoleKey: 'INPUT_TAX' });
  if (isPos(p.inventoryNet)) lines.push({ roleKey: 'INVENTORY', side: 'credit', amount: p.inventoryNet });
  if (isPos(p.expenseNet)) lines.push({ roleKey: 'PURCHASES', side: 'credit', amount: p.expenseNet });
  await gatedPost(tx, p.tenantId, p.date, 'DebitNote', p.debitNoteId, 'issued', lines);
}

/** Recognize COGS on a sale: Dr COGS / Cr INVENTORY at cost. event 'cogs'. No-op if cost <= 0. */
export async function postSaleCogs(
  tx: PostingTx,
  p: { tenantId: string; invoiceId: string; date: Date; cost: string; costCenterId?: string | null; projectId?: string | null; cogsByCentre?: CentreNet[] },
): Promise<void> {
  if (!isPos(p.cost)) return;

  // COGS must carry the same dimension as the revenue it offsets. Without it
  // departmental revenue posts but departmental cost does not, so every tagged
  // department reports an inflated gross margin and the unallocated column
  // absorbs the whole COGS balance.
  const lines: LineInstruction[] = [];
  if (p.cogsByCentre?.length) {
    assertSplit('invoice.cogs', p.cost, p.cogsByCentre.map((g) => g.net));
    for (const g of p.cogsByCentre) {
      lines.push({ roleKey: 'COGS', side: 'debit', amount: g.net, costCenterId: g.costCenterId });
    }
  } else {
    lines.push({ roleKey: 'COGS', side: 'debit', amount: p.cost });
  }
  lines.push({ roleKey: 'INVENTORY', side: 'credit', amount: p.cost });

  await gatedPost(tx, p.tenantId, p.date, 'Invoice', p.invoiceId, 'cogs', lines, undefined, 'BASE', undefined, p.costCenterId, p.projectId);
}

/** Reverse a sales return's COGS (restock): Dr INVENTORY / Cr COGS. event 'cogs' on the CreditNote. */
export async function postReturnCogs(
  tx: PostingTx, p: { tenantId: string; creditNoteId: string; date: Date; cost: string },
): Promise<void> {
  if (!isPos(p.cost)) return;
  await gatedPost(tx, p.tenantId, p.date, 'CreditNote', p.creditNoteId, 'cogs', [
    { roleKey: 'INVENTORY', side: 'debit', amount: p.cost },
    { roleKey: 'COGS', side: 'credit', amount: p.cost },
  ]);
}

/**
 * Post a straight-line depreciation charge:
 *   Dr DEPRECIATION_EXPENSE / Cr ACCUMULATED_DEPRECIATION
 *
 * Gated (no-op when ledger not live). Idempotent per asset + period via
 * event key `depr.<period>` (e.g. 'depr.2026-06').
 */
export async function postDepreciation(
  tx: PostingTx,
  p: { tenantId: string; assetId: string; date: Date; amount: string; period: string },
): Promise<void> {
  await gatedPost(tx, p.tenantId, p.date, 'FixedAsset', p.assetId, `depr.${p.period}`, [
    { roleKey: 'DEPRECIATION_EXPENSE', side: 'debit', amount: p.amount },
    { roleKey: 'ACCUMULATED_DEPRECIATION', side: 'credit', amount: p.amount },
  ]);
}

/**
 * Post an asset acquisition (opt-in):
 *   Dr FIXED_ASSET / Cr BANK at cost.
 *
 * Defaults to false on asset creation to avoid double-counting a purchase
 * already recorded elsewhere in the ledger. Only call when the acquisition
 * has NOT been posted by any other document (invoice, purchase, etc.).
 *
 * Gated (no-op when ledger not live).
 */
export async function postAssetAcquisition(
  tx: PostingTx,
  p: { tenantId: string; assetId: string; date: Date; cost: string },
): Promise<void> {
  await gatedPost(tx, p.tenantId, p.date, 'FixedAsset', p.assetId, 'acquisition', [
    { roleKey: 'FIXED_ASSET', side: 'debit', amount: p.cost },
    { roleKey: 'BANK', side: 'credit', amount: p.cost },
  ]);
}

/**
 * Post the disposal of a capital asset:
 *
 *   Dr BANK                       (grossProceeds)         gross cash received
 *   Cr OUTPUT_TAX                 (tax)                   only when tax > 0
 *   Dr ACCUMULATED_DEPRECIATION   (accumulatedDepreciation)
 *   Cr FIXED_ASSET                (cost)
 *   Cr GAIN_ON_DISPOSAL           (netProceeds − NBV)     only when gain > 0
 *     — or —
 *   Dr LOSS_ON_DISPOSAL           (NBV − netProceeds)     only when loss > 0
 *
 * Balance proof (NBV = cost − accumulatedDepreciation, netP = grossProceeds − tax):
 *   Debits  = grossProceeds + accumulatedDepreciation + max(0, NBV − netP)
 *   Credits = tax + cost + max(0, netP − NBV)
 *   With NBV substituted these are equal for all gain / loss / break-even cases.
 *
 * Gated (no-op when ledger not live). Idempotent via event key 'disposal'.
 * Reversible via reverseDocument / voidDocument with sourceType 'FixedAssetDisposal'.
 */
export async function postAssetDisposal(
  tx: PostingTx,
  p: {
    tenantId: string;
    assetId: string;
    date: Date;
    grossProceeds: DecimalInput;
    tax: DecimalInput;
    cost: DecimalInput;
    accumulatedDepreciation: DecimalInput;
    /** Per-bank GL sub-account (BankDetail.accountId) for the BANK leg; null → shared BANK role. */
    bankGlAccountId?: string | null;
    currencyCode?: string;
  },
): Promise<void> {
  const gross = toDecimal(p.grossProceeds);
  const tax   = toDecimal(p.tax);
  const cost  = toDecimal(p.cost);
  const accum = toDecimal(p.accumulatedDepreciation);

  const netP = gross.minus(tax);
  const nbv  = cost.minus(accum);
  const gl   = netP.minus(nbv); // positive = gain, negative = loss

  const lines: LineInstruction[] = [
    bankCashLeg('BANK', 'debit', gross.toString(), p.bankGlAccountId),
  ];
  if (tax.greaterThan(0)) {
    lines.push({ roleKey: 'OUTPUT_TAX', side: 'credit', amount: tax.toString(), taxRoleKey: 'OUTPUT_TAX' });
  }
  lines.push({ roleKey: 'ACCUMULATED_DEPRECIATION', side: 'debit', amount: accum.toString() });
  lines.push({ roleKey: 'FIXED_ASSET', side: 'credit', amount: cost.toString() });
  if (gl.greaterThan(0)) {
    lines.push({ roleKey: 'GAIN_ON_DISPOSAL', side: 'credit', amount: gl.toString() });
  } else if (gl.lessThan(0)) {
    lines.push({ roleKey: 'LOSS_ON_DISPOSAL', side: 'debit', amount: gl.abs().toString() });
  }
  // gl === 0: no gain/loss leg; entry still balances

  await gatedPost(
    tx, p.tenantId, p.date,
    'FixedAssetDisposal', p.assetId, 'disposal',
    lines, undefined, p.currencyCode ?? 'BASE',
  );
}

/** Reverse a previously-posted document entry (for edit/void). No-op if none. */
export async function reverseDocument(
  tx: PostingTx, p: { tenantId: string; sourceType: string; sourceId: string; event: string },
): Promise<void> {
  const existing = await tx.journalEntry.findFirst({
    where: { tenantId: p.tenantId, sourceType: p.sourceType, sourceId: p.sourceId, event: p.event, isDeleted: false },
  });
  if (!existing) return;
  await reverse(tx, existing.id);
}

/**
 * Void a previously-posted document entry by SOFT-DELETING the forward
 * JournalEntry (and freeing its idempotency slot). No-op if none.
 *
 * Why not `reverseDocument` here? `reverse()` mints a `.reversal` mirror but
 * leaves the original entry live, so a later `post()` on the SAME
 * (tenantId, sourceType, sourceId, event) triple is a no-op — the idempotency
 * findFirst (`isDeleted:false`) returns the stale original and no fresh posting
 * is created. That is the re-explain no-op bug for sources whose sourceId is the
 * bank-txn id (BankTxnExplain behaviours, invoice_link, bill_link).
 *
 * Every GL-balance query (trial balance, P&L, balance sheet, dimension reports,
 * budget actuals) aggregates `account.journalLines` filtered by
 * `journalEntry: { isDeleted: false }`, so a soft-deleted JE contributes ZERO to
 * all balances. Removing the forward entry therefore nets the source to zero
 * WITHOUT leaving a lone reversal — the books stay balanced by removal, and the
 * audit row survives (soft-deleted, not hard-deleted).
 *
 * The DB unique constraint `@@unique([tenantId, sourceType, sourceId, event])` does
 * NOT include `isDeleted`, so a soft-deleted row would still occupy the slot and
 * make a fresh `post()` throw P2002. We therefore also mangle the voided entry's
 * `event` to free the slot for a clean re-post.
 */
export async function voidDocument(
  tx: PostingTx, p: { tenantId: string; sourceType: string; sourceId: string; event: string },
): Promise<void> {
  const existing = (await tx.journalEntry.findFirst({
    where: { tenantId: p.tenantId, sourceType: p.sourceType, sourceId: p.sourceId, event: p.event, isDeleted: false },
  })) as { id: string; entryDate: Date } | null;
  if (!existing) return;

  // Period lock — mirror post()/reverse(): a soft-delete of the forward JE mutates
  // the closed-period trial balance / P&L just as a fresh posting would, so it must
  // be blocked identically. Keyed on the entry-being-voided's date + tenantId.
  const locked = await tx.accountingPeriod.findFirst({
    where: {
      tenantId: p.tenantId, isLocked: true,
      startDate: { lte: existing.entryDate }, endDate: { gte: existing.entryDate },
    },
  });
  if (locked) {
    throw new PeriodLockedError(`Accounting period is locked for ${existing.entryDate.toISOString().slice(0, 10)}`);
  }

  await tx.journalEntry.update({
    where: { id: existing.id },
    // Free the (tenantId, sourceType, sourceId, event) idempotency slot so a later
    // re-post creates a FRESH entry instead of colliding on the unique index.
    data: { isDeleted: true, event: `${p.event}.voided.${existing.id}` },
  });
}
