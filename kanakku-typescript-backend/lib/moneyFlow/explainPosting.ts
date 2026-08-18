// lib/moneyFlow/explainPosting.ts
//
// The explain → post / unexplain service: the core of the Money In/Out layer.
// Turns an "explanation" of a bank transaction (Direction → Type → Category)
// into the correct ledger posting (and document, where applicable), and can
// cleanly reverse it. All posting runs inside a single prisma.$transaction so a
// failed dispatch never leaves a partial post.

import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { getTransactionType, USER_PAYMENT_REASONS, type FieldKey } from './types';
import { post, type LedgerTx } from '../ledger/postingEngine';
import {
  postExpense,
  postSupplierPayment,
  postAssetDisposal,
  voidDocument,
  type PostingTx,
} from '../ledger/ledgerPosting';
import { applyInvoiceReceipt, type ApplyDb } from '../ledger/applyInvoiceReceipt';
import { applyBillPayment, type ApplyBillPaymentDb } from '../ledger/applyBillPayment';
import { postMoneyIn } from '../ledger/postMoneyIn';
import { shouldPost } from '../ledger/postingGate';
import { computeLineTaxes } from '../taxEngine';
import { toDecimal } from '../ledger/money';
import type { LineInstruction } from '../ledger/types';

// ---------------------------------------------------------------------------
// Errors — carry an HTTP-ish status the controller can map.
// ---------------------------------------------------------------------------

export class ExplainError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ExplainError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplainInput {
  bankTxnId: string;
  userId: string;
  transactionTypeKey: string;
  categoryId?: string;
  payToUserId?: string;
  taxTreatment?: string; // AUTO | <taxRateId> | ZERO | EXEMPT | OUT_OF_SCOPE | MANUAL
  manualTaxAmount?: string | number; // honoured when taxTreatment === 'MANUAL'
  explainedDescription?: string;
  attachment?: string;
  assetType?: string;
  depreciationMethod?: string;
  assetLifeMonths?: number;
  invoiceId?: string;
  billId?: string;
  assetId?: string;
  reason?: string;
  creditNoteId?: string;
  /**
   * Optional hook run inside the SAME $transaction as the posting, after the
   * bank txn is stamped EXPLAINED but before commit. Used by the approve path
   * to record a learning hint atomically — it rolls back with the posting if
   * anything throws. Receives the transaction client so it composes without a
   * nested transaction. A throw aborts the whole explain (and the post).
   */
  onPosted?: (tx: Prisma.TransactionClient, result: ExplainResult) => Promise<void>;
}

export interface ExplainResult {
  bankTxnId: string;
  journalEntryId?: string;
  expenseId?: string;
}

export interface UnexplainInput {
  bankTxnId: string;
  userId: string;
}

// Minimal structural slice of the Prisma client this service needs. Keeping it
// structural lets the integration test drive it with an in-memory fake.
interface ExplainDb extends PostingTx {
  bankTransaction: {
    findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  bankDetail: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string; userId: string; currencyCode: string | null; accountId?: string | null } | null>;
  };
  transactionCategory: {
    findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
  };
  taxRate: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string; name: string; taxKind: string | null; rate: string | number } | null>;
  };
  expense: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  paymentMode: {
    findUnique: (args: { where: { id: string } }) => Promise<{ slug: string } | null>;
  };
  fixedAsset: {
    findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: string; cost: unknown; accumulatedDepreciation: unknown; salvageValue?: unknown; lastDepreciatedOn?: unknown; status: string } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  account: {
    findFirst: (args: { where: { userId: string; code: string; isDeleted: boolean } }) => Promise<{ id: string; accountType: string } | null>;
  };
  invoice: {
    findFirst: (args: { where: { id: string; userId: string; isDeleted: boolean } }) => Promise<{ id: string; TotalAmount: unknown; status: string; userId: string; exchangeRate?: unknown } | null>;
    update: (args: { where: { id: string }; data: { status: string } }) => Promise<unknown>;
  };
  invoicePayment: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string; invoiceId: string; amount: unknown; isVoided: boolean } | null>;
    aggregate: (args: { where: { invoiceId: string; isVoided: boolean }; _sum: { amount: true } }) => Promise<{ _sum: { amount: unknown } }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  creditNote: {
    findFirst: (args: { where: { id: string; userId: string; isDeleted: boolean } }) => Promise<{ id: string; totalAmount: unknown; status: string; userId: string } | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  purchase: {
    findFirst: (args: { where: { id: string; userId: string; isDeleted: boolean } }) => Promise<{ id: string; totalAmount: unknown; paidAmount: unknown; balanceAmount: unknown; status: string; userId: string; supplierId?: string | null; vendorId?: string | null; billTo?: string | null } | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  supplierPayment: {
    aggregate: (args: { where: { purchaseId: string; isVoided: boolean; isDeleted: boolean }; _sum: { amount: true } }) => Promise<{ _sum: { amount: unknown } }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string; purchaseId: string; amount: unknown; isVoided: boolean } | null>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONEY_IN_TYPES = new Set(['DEPOSIT', 'RECEIPT', 'TRANSFER_IN']);

function isMoneyIn(bankTxnType: string): boolean {
  return MONEY_IN_TYPES.has(bankTxnType);
}

function requireField(fields: FieldKey[], field: FieldKey, value: unknown, label: string): void {
  if (fields.includes(field) && (value === undefined || value === null || value === '')) {
    throw new ExplainError(400, `${label} is required for this transaction type`);
  }
}

/**
 * Compute the tax portion of a tax-inclusive bank amount.
 *
 * The wrappers (postExpense / postMoneyIn) derive net = total - tax, so `total`
 * is the gross (tax-inclusive) bank amount and we must return the tax slice of
 * it. We get the net from the inclusive total (net = total / (1 + r/100)) and
 * then run computeLineTaxes on that net so the canonical tax engine produces
 * the rounded tax figure.
 */
function computeInclusiveTax(
  total: string,
  rate: { id: string; name: string; taxKind: string | null; rate: string | number },
): string {
  const percent = Number(rate.rate);
  if (!Number.isFinite(percent) || percent <= 0) return '0';
  const totalDec = toDecimal(total);
  const net = totalDec.dividedBy(toDecimal(1).plus(toDecimal(percent).dividedBy(100)));
  const out = computeLineTaxes({
    qty: 1,
    rate: net.toNumber(),
    appliedTaxes: [{ id: rate.id, name: rate.name, taxKind: rate.taxKind as never, rate: percent }],
  });
  return String(out.totalTax);
}

interface ResolvedTax {
  amount: string;
  taxRateId: string | null;
}

async function resolveTax(
  db: ExplainDb,
  def: { taxApplicable: boolean },
  category: { taxApplicable?: boolean; defaultTaxRateId?: string | null } | null,
  total: string,
  treatment: string | undefined,
  manualTaxAmount: string | number | undefined,
): Promise<ResolvedTax> {
  if (!def.taxApplicable || !category || category.taxApplicable === false) {
    return { amount: '0', taxRateId: null };
  }

  const t = (treatment ?? 'AUTO').toUpperCase();

  if (t === 'ZERO' || t === 'EXEMPT' || t === 'OUT_OF_SCOPE') {
    return { amount: '0', taxRateId: null };
  }
  if (t === 'MANUAL') {
    const amt = manualTaxAmount != null ? String(manualTaxAmount) : '0';
    return { amount: amt, taxRateId: null };
  }

  // AUTO → category default rate; otherwise treat the treatment string as a taxRateId.
  const rateId = t === 'AUTO' ? category.defaultTaxRateId ?? null : treatment ?? null;
  if (!rateId) return { amount: '0', taxRateId: null };

  const rate = await db.taxRate.findUnique({ where: { id: rateId } });
  if (!rate) {
    // AUTO falling back to a stale category default is tolerable (post zero tax),
    // but an explicit taxRateId the caller chose that we can't find is an error —
    // silently posting tax 0 would understate the liability.
    if (t === 'AUTO') return { amount: '0', taxRateId: null };
    throw new ExplainError(400, `Tax rate not found: ${rateId}`);
  }

  return { amount: computeInclusiveTax(total, rate), taxRateId: rate.id };
}

async function loadCategory(
  db: ExplainDb,
  fields: FieldKey[],
  categoryId: string | undefined,
): Promise<Record<string, unknown> | null> {
  requireField(fields, 'category', categoryId, 'Category');
  if (!categoryId) return null;
  const cat = await db.transactionCategory.findUnique({ where: { id: categoryId } });
  if (!cat) throw new ExplainError(400, 'Category not found');
  return cat;
}

function categoryAccountId(category: Record<string, unknown> | null): string {
  const id = category?.accountId as string | undefined;
  if (!id) throw new ExplainError(400, 'Selected category has no ledger account mapping');
  return id;
}

async function paymentModeSlugFor(db: ExplainDb, paymentModeId: unknown): Promise<string | null> {
  if (typeof paymentModeId !== 'string' || !paymentModeId) return null;
  const pm = await db.paymentMode.findUnique({ where: { id: paymentModeId } });
  return pm?.slug ?? null;
}

// ---------------------------------------------------------------------------
// Account-code resolver (GAP 2 — reason-based routing)
// ---------------------------------------------------------------------------

const ACCOUNT_TYPE_BY_CODE: Record<string, string> = {
  '9200': 'LIABILITY',
  '9210': 'EQUITY',
  '9220': 'EQUITY',
  '9230': 'EXPENSE',
  '9250': 'LIABILITY',
  '9260': 'LIABILITY',
  '9270': 'LIABILITY',
};

async function resolveAccountByCode(
  db: ExplainDb,
  userId: string,
  code: string,
): Promise<string> {
  // Filter isDeleted: a soft-deleted account at this code must NOT resolve and
  // get posted to (the @@unique([userId, code]) row survives a soft delete).
  const acct = await db.account.findFirst({ where: { userId, code, isDeleted: false } });
  if (!acct) throw new ExplainError(400, `Required account code ${code} not found. Please ensure the ledger is initialized.`);
  const expectedType = ACCOUNT_TYPE_BY_CODE[code];
  if (expectedType && acct.accountType !== expectedType) {
    throw new ExplainError(500, `Account ${code} has unexpected type ${acct.accountType} (expected ${expectedType})`);
  }
  return acct.id;
}

// ---------------------------------------------------------------------------
// explainAndPost
// ---------------------------------------------------------------------------

export async function explainAndPost(input: ExplainInput): Promise<ExplainResult> {
  return prisma.$transaction(async (txClient) => {
    const db = txClient as unknown as ExplainDb;

    // 1. Load + ownership-scope the bank txn.
    const bankTxn = await db.bankTransaction.findUnique({ where: { id: input.bankTxnId } });
    if (!bankTxn) throw new ExplainError(404, 'Bank transaction not found');

    const bank = await db.bankDetail.findUnique({ where: { id: bankTxn.bankAccountId as string } });
    if (!bank || bank.userId !== input.userId) {
      throw new ExplainError(404, 'Bank transaction not found');
    }

    // PAYMENT-BORN GUARD. A row created BY a module payment flow (invoice /
    // supplier payment, expense, petty-cash — explainedBankFields stamps
    // isPaymentBorn at create) is a mirror of that source document. Explaining
    // it in banking would mint a SECOND payment + JE → double-post. Refuse;
    // it is edited at source. (Idempotently self-heal explainStatus for any
    // legacy row that slipped through — commits outside this $transaction so
    // the 409 throw below doesn't roll it back.)
    if (bankTxn.isPaymentBorn === true) {
      if (bankTxn.explainStatus !== 'EXPLAINED') {
        await prisma.bankTransaction.update({
          where: { id: bankTxn.id as string },
          data: { explainStatus: 'EXPLAINED' },
        });
      }
      throw new ExplainError(
        409,
        `Bank transaction was created by its source payment (${
          (bankTxn.relatedType as string | null) ?? 'linked document'
        }${bankTxn.relatedId ? ` ${bankTxn.relatedId}` : ''}) and cannot be explained in banking. Edit it at the source document.`,
      );
    }

    // RE-EXPLAIN. An already-EXPLAINED manual row is being edited: void the
    // prior posting (GL + payment/asset artefacts, same guards as unexplain —
    // e.g. 409 if depreciation was posted on a created asset) inside THIS
    // transaction, then fall through and post the new explanation atomically.
    if (bankTxn.explainStatus === 'EXPLAINED') {
      await unexplainCore(db, { bankTxnId: input.bankTxnId, userId: input.userId }, bankTxn);
    }

    // Load the Type def.
    const def = getTransactionType(input.transactionTypeKey);
    if (!def) throw new ExplainError(400, `Unknown transaction type: ${input.transactionTypeKey}`);

    // Required-field validation per the Type registry.
    requireField(def.fields, 'person', input.payToUserId, 'Payment-to person');
    requireField(def.fields, 'invoiceLink', input.invoiceId, 'Invoice');
    requireField(def.fields, 'billLink', input.billId, 'Bill');
    requireField(def.fields, 'creditNoteLink', input.creditNoteId, 'Credit note');

    // 2. Direction + total.
    const total = String(bankTxn.amount);
    const date = (bankTxn.transactionDate as Date | undefined) ?? new Date();
    const currencyCode = bank.currencyCode ?? 'BASE';
    // Per-bank GL sub-account (A1: BankDetail.accountId). When set, every BANK leg
    // below targets this account instead of the shared BANK role so the bank ties
    // out per-account. Null (un-backfilled bank / no ledger) → shared BANK role,
    // identical to prior behaviour. Children roll up to the BANK parent, so the
    // trial balance and parent rollup are unchanged either way.
    const bankGlAccountId = bank.accountId ?? null;
    // Build a BANK leg that targets the per-bank sub-account when known, else the
    // shared BANK role. Used by the inline-instruction behaviours below.
    const bankLeg = (side: 'debit' | 'credit', amount: string): LineInstruction =>
      bankGlAccountId
        ? { accountId: bankGlAccountId, side, amount }
        : { roleKey: 'BANK', side, amount };
    const moneyIn = isMoneyIn(String(bankTxn.type));
    void moneyIn; // direction is captured here; behaviours already encode in/out

    const userId = input.userId;
    let postedSourceType: string | null = null;
    let postedSourceId: string | null = null;
    let expenseId: string | undefined;
    let journalEntryId: string | undefined;
    let resolvedTaxAmount = '0';
    let relatedType: string | undefined;
    let relatedId: string | undefined;
    let createdAssetId: string | undefined;

    // Pre-fetch ledger settings once so we can decide isReconciled at stamp time
    // without an extra round-trip (the posting sub-functions also fetch settings
    // inside the same transaction).
    const ledgerSettings = await db.companySettings.findFirst({ where: { userId } });
    // willPost is true when the ledger gate would allow a JE for this date.
    // Used below to avoid marking the bank txn isReconciled=true when no GL
    // entry was actually posted (pre-go-live transactions are explained but
    // NOT reconciled until a full ledger posting exists).
    const willPost = shouldPost(ledgerSettings, date);

    // 3 + 4. Compute tax (per behaviour) and dispatch.
    switch (def.postingBehaviour) {
      case 'generic_category': {
        const category = await loadCategory(db, def.fields, input.categoryId);
        const acctId = categoryAccountId(category);
        const tax = await resolveTax(db, def, category as never, total, input.taxTreatment, input.manualTaxAmount);
        resolvedTaxAmount = tax.amount;

        const paymentModeSlug = await paymentModeSlugFor(db, bankTxn.paymentModeId);

        const net = toDecimal(total).minus(toDecimal(tax.amount)).toString();
        const expense = await db.expense.create({
          data: {
            amount: net,
            tax: tax.amount,
            taxRateId: tax.taxRateId,
            expenseDate: date,
            description: input.explainedDescription ?? (bankTxn.remarks as string | undefined) ?? '',
            attachment: input.attachment ?? null,
            sourceType: 'BANK',
            bankId: bankTxn.bankAccountId,
            userId,
            // The money-flow layer categorizes via TransactionCategory (kept on
            // the bank txn), not the legacy ExpenseCategory. Column is nullable.
            expenseCategoryId: null,
          },
        });
        expenseId = expense.id;

        await postExpense(db, {
          userId,
          expenseId: expense.id,
          date,
          total,
          tax: tax.amount,
          expenseAccountId: acctId,
          sourceType: 'BANK',
          paymentModeSlug,
          bankGlAccountId,
          currencyCode,
        });
        postedSourceType = 'Expense';
        postedSourceId = expense.id;
        break;
      }

      case 'income_generic': {
        const category = await loadCategory(db, def.fields, input.categoryId);
        const acctId = categoryAccountId(category);
        const tax = await resolveTax(db, def, category as never, total, input.taxTreatment, input.manualTaxAmount);
        resolvedTaxAmount = tax.amount;

        await postMoneyIn(db, {
          userId,
          sourceType: 'BankTxnExplain',
          sourceId: bankTxn.id as string,
          event: 'explained',
          date,
          total,
          tax: tax.amount,
          incomeAccountId: acctId,
          bankGlAccountId,
          currencyCode,
        });
        postedSourceType = 'BankTxnExplain';
        postedSourceId = bankTxn.id as string;
        break;
      }

      case 'capital_asset': {
        const category = await loadCategory(db, def.fields, input.categoryId);
        const acctId = categoryAccountId(category);
        const tax = await resolveTax(db, def, category as never, total, input.taxTreatment, input.manualTaxAmount);
        resolvedTaxAmount = tax.amount;

        const net = toDecimal(total).minus(toDecimal(tax.amount)).toString();
        const instructions: LineInstruction[] = [{ accountId: acctId, side: 'debit', amount: net }];
        if (toDecimal(tax.amount).greaterThan(0)) {
          instructions.push({ roleKey: 'INPUT_TAX', side: 'debit', amount: tax.amount, taxRoleKey: 'INPUT_TAX' });
        }
        instructions.push(bankLeg('credit', total));

        const je = await postGated(db, {
          userId, sourceType: 'BankTxnExplain', sourceId: bankTxn.id as string,
          event: 'explained', date, currencyCode, instructions,
        });
        journalEntryId = je?.id;
        postedSourceType = 'BankTxnExplain';
        postedSourceId = bankTxn.id as string;

        // GAP 4: Create a FixedAsset register row so the asset register ties to
        // the GL fixed-asset balance. The acquisition GL debit is already posted
        // above to the category account (which the user configures as their
        // fixed-asset account). We do NOT post acquisition again (no double-post).
        // cost = net (ex-tax) — equals the asset-account debit.
        // This runs whether or not the GL post was gated (asset register is real
        // master data independent of the GL posting gate).
        {
          const assetName =
            (input.explainedDescription ?? (bankTxn.remarks as string | undefined) ?? input.assetType ?? 'Capital Asset').trim() || 'Capital Asset';

          // usefulLifeMonths: validate > 0 or fall back to 60 (5 years).
          const rawLife = input.assetLifeMonths;
          const usefulLifeMonths = typeof rawLife === 'number' && rawLife > 0 ? rawLife : 60;

          // Map depreciationMethod form value to FixedAsset.method enum.
          // Accepted values: STRAIGHT_LINE | REDUCING_BALANCE | NONE (and aliases).
          const rawMethod = (input.depreciationMethod ?? 'STRAIGHT_LINE').toUpperCase();
          const method =
            rawMethod === 'REDUCING_BALANCE' || rawMethod === 'DECLINING_BALANCE'
              ? 'REDUCING_BALANCE'
              : rawMethod === 'NONE' || rawMethod === 'NO_DEPRECIATION'
              ? 'NONE'
              : 'STRAIGHT_LINE';

          const createdAsset = await db.fixedAsset.create({
            data: {
              userId,
              name: assetName,
              cost: net,
              salvageValue: '0',
              usefulLifeMonths,
              method,
              acquisitionDate: date,
              accumulatedDepreciation: '0',
              status: 'active',
              isDeleted: false,
            },
          });
          // Store the asset id for unexplain (allows reversing the register row).
          createdAssetId = createdAsset.id;
        }
        break;
      }

      case 'owner_funds': {
        if (def.key === 'money_received_from_user') {
          // GAP 2: reason-based routing for the new collapsed type
          if (!input.payToUserId) throw new ExplainError(400, 'Payment-to person is required for this transaction type');
          if (!input.reason) throw new ExplainError(400, 'Reason is required for Money Received from User');
          const reasonDef = USER_PAYMENT_REASONS.money_received_from_user.find((r) => r.key === input.reason);
          if (!reasonDef) throw new ExplainError(400, `Invalid reason for Money Received from User: ${input.reason}`);
          const acctId = await resolveAccountByCode(db, userId, reasonDef.accountCode);
          // Dr Bank, Cr resolved account (loan/equity) — no tax.
          const je = await postGated(db, {
            userId, sourceType: 'BankTxnExplain', sourceId: bankTxn.id as string,
            event: 'explained', date, currencyCode,
            instructions: [
              bankLeg('debit', total),
              { accountId: acctId, side: 'credit', amount: total },
            ],
          });
          journalEntryId = je?.id;
          postedSourceType = 'BankTxnExplain';
          postedSourceId = bankTxn.id as string;
          break;
        }
        // Legacy path: category-based routing (back-compat)
        const category = await loadCategory(db, def.fields, input.categoryId);
        const acctId = categoryAccountId(category);
        // Dr Bank, Cr category (loan/equity) — no tax.
        const je = await postGated(db, {
          userId, sourceType: 'BankTxnExplain', sourceId: bankTxn.id as string,
          event: 'explained', date, currencyCode,
          instructions: [
            { roleKey: 'BANK', side: 'debit', amount: total },
            { accountId: acctId, side: 'credit', amount: total },
          ],
        });
        journalEntryId = je?.id;
        postedSourceType = 'BankTxnExplain';
        postedSourceId = bankTxn.id as string;
        break;
      }

      case 'user_payment': {
        if (def.key === 'money_paid_to_user') {
          // GAP 2: reason-based routing for the new collapsed type
          if (!input.payToUserId) throw new ExplainError(400, 'Payment-to person is required for this transaction type');
          if (!input.reason) throw new ExplainError(400, 'Reason is required for Money Paid to User');
          const reasonDef = USER_PAYMENT_REASONS.money_paid_to_user.find((r) => r.key === input.reason);
          if (!reasonDef) throw new ExplainError(400, `Invalid reason for Money Paid to User: ${input.reason}`);
          const acctId = await resolveAccountByCode(db, userId, reasonDef.accountCode);
          // Dr resolved account (payroll/dividend/loan), Cr Bank — no tax.
          const je = await postGated(db, {
            userId, sourceType: 'BankTxnExplain', sourceId: bankTxn.id as string,
            event: 'explained', date, currencyCode,
            instructions: [
              { accountId: acctId, side: 'debit', amount: total },
              bankLeg('credit', total),
            ],
          });
          journalEntryId = je?.id;
          postedSourceType = 'BankTxnExplain';
          postedSourceId = bankTxn.id as string;
          break;
        }
        // Legacy path: category-based routing (back-compat)
        requireField(def.fields, 'person', input.payToUserId, 'Payment-to person');
        const category = await loadCategory(db, def.fields, input.categoryId);
        const acctId = categoryAccountId(category);
        // Dr category (payroll/dividend/loan), Cr Bank — no tax.
        const je = await postGated(db, {
          userId, sourceType: 'BankTxnExplain', sourceId: bankTxn.id as string,
          event: 'explained', date, currencyCode,
          instructions: [
            { accountId: acctId, side: 'debit', amount: total },
            { roleKey: 'BANK', side: 'credit', amount: total },
          ],
        });
        journalEntryId = je?.id;
        postedSourceType = 'BankTxnExplain';
        postedSourceId = bankTxn.id as string;
        break;
      }

      case 'invoice_link': {
        if (!input.invoiceId) throw new ExplainError(400, 'Invoice is required for this transaction type');
        const paymentModeId = typeof bankTxn.paymentModeId === 'string' && bankTxn.paymentModeId
          ? bankTxn.paymentModeId
          : null;
        if (!paymentModeId) throw new ExplainError(400, 'Bank transaction has no payment mode; cannot create invoice receipt');
        const bankAccountId = bankTxn.bankAccountId as string;
        const paymentModeSlug = await paymentModeSlugFor(db, paymentModeId);
        let receiptResult: { invoicePaymentId: string };
        try {
          receiptResult = await applyInvoiceReceipt(db as unknown as ApplyDb, {
            userId,
            invoiceId: input.invoiceId,
            amount: total,
            date,
            bankAccountId,
            bankGlAccountId,
            paymentModeId,
            paymentModeSlug,
            currencyCode,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'INVOICE_NOT_FOUND') throw new ExplainError(404, 'Invoice not found');
          if (msg === 'INVOICE_ALREADY_PAID') throw new ExplainError(400, 'Invoice is already fully paid');
          if (msg.startsWith('PAYMENT_EXCEEDS:')) {
            const remaining = msg.split(':')[1];
            throw new ExplainError(400, `Payment amount exceeds invoice remaining balance of ${remaining}`);
          }
          throw err;
        }
        relatedType = 'INVOICE_PAYMENT';
        relatedId = receiptResult.invoicePaymentId;
        postedSourceType = 'InvoicePayment';
        postedSourceId = receiptResult.invoicePaymentId;   // KEY: store the InvoicePayment id, not bankTxn id
        break;
      }

      case 'bill_link': {
        if (!input.billId) throw new ExplainError(400, 'Bill is required for this transaction type');
        const bankAccountId = bankTxn.bankAccountId as string;
        const paymentModeId = typeof bankTxn.paymentModeId === 'string' && bankTxn.paymentModeId
          ? bankTxn.paymentModeId : null;
        const paymentModeSlug = await paymentModeSlugFor(db, paymentModeId);
        let billResult: { supplierPaymentId: string };
        try {
          billResult = await applyBillPayment(db as unknown as ApplyBillPaymentDb, {
            userId,
            purchaseId: input.billId,
            amount: total,
            date,
            bankAccountId,
            bankGlAccountId,
            paymentModeId,
            paymentModeSlug,
            currencyCode,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'BILL_NOT_FOUND') throw new ExplainError(404, 'Bill not found');
          if (msg === 'BILL_ALREADY_PAID') throw new ExplainError(400, 'Bill is already fully paid');
          if (msg.startsWith('PAYMENT_EXCEEDS:')) {
            const remaining = msg.split(':')[1];
            throw new ExplainError(400, `Payment amount exceeds bill remaining balance of ${remaining}`);
          }
          throw err;
        }
        relatedType = 'SUPPLIER_PAYMENT';
        relatedId = billResult.supplierPaymentId;
        postedSourceType = 'SupplierPayment';
        postedSourceId = billResult.supplierPaymentId;   // KEY: store the SupplierPayment id, not bankTxn id
        break;
      }

      case 'credit_note_link': {
        if (!input.creditNoteId) throw new ExplainError(400, 'Credit note is required for this transaction type');
        const creditNote = await db.creditNote.findFirst({
          where: { id: input.creditNoteId, userId, isDeleted: false },
        });
        if (!creditNote) throw new ExplainError(404, 'Credit note not found');
        // Post: Dr AR / Cr Bank.
        // (Credit note issued: Dr SALES_RETURNS / Cr AR — so AR has a credit balance representing
        //  money owed back to the customer. Refunding cash: Dr AR / Cr Bank — relieves the
        //  credit-note AR balance and pays out from bank. No tax: accounted on original issuance.)
        const je = await postGated(db, {
          userId,
          sourceType: 'CreditNote',
          sourceId: input.creditNoteId,
          event: 'refund',
          date,
          currencyCode,
          instructions: [
            { roleKey: 'AR', side: 'debit', amount: total },
            bankLeg('credit', total),
          ],
        });
        journalEntryId = je?.id;
        postedSourceType = 'CreditNote';
        postedSourceId = input.creditNoteId;
        break;
      }

      case 'asset_disposal': {
        if (!input.assetId) {
          throw new ExplainError(400, 'A linked fixed asset is required for disposal');
        }
        const asset = await db.fixedAsset.findFirst({
          where: { id: input.assetId, userId, isDeleted: false },
        });
        if (!asset) throw new ExplainError(404, 'Fixed asset not found');
        if (asset.status !== 'active' && asset.status !== 'fully_depreciated') {
          throw new ExplainError(400, `Asset cannot be disposed: status is '${asset.status}'`);
        }

        const tax = await resolveTax(db, def, { taxApplicable: true, defaultTaxRateId: null }, total, input.taxTreatment, input.manualTaxAmount);
        resolvedTaxAmount = tax.amount;

        await postAssetDisposal(db, {
          userId,
          assetId: input.assetId,
          date,
          grossProceeds: total,
          tax: tax.amount,
          cost: String(asset.cost),
          accumulatedDepreciation: String(asset.accumulatedDepreciation),
          bankGlAccountId,
          currencyCode,
        });

        const netProceeds = toDecimal(total).minus(toDecimal(tax.amount)).toString();
        await db.fixedAsset.update({
          where: { id: input.assetId },
          data: {
            status: 'disposed',
            disposalDate: date,
            disposalProceeds: netProceeds,
          },
        });

        postedSourceType = 'FixedAssetDisposal';
        postedSourceId = input.assetId;
        break;
      }

      default: {
        throw new ExplainError(400, `Unsupported posting behaviour: ${def.postingBehaviour}`);
      }
    }

    // 5. Stamp the explanation onto the bank txn.
    // isReconciled is set only when the ledger gate allowed a GL posting for this
    // transaction date. Pre-go-live transactions are EXPLAINED (the user's intent
    // is recorded) but NOT reconciled — no journal entry exists yet, so marking
    // them reconciled would silently break GL tie-out.
    //
    // Document-backed sources (InvoicePayment) persist a real sub-ledger row that
    // exists regardless of whether the GL JE was gated out (pre-go-live). Keep the
    // bank txn linked to it so unexplain can reverse the row even with no JE.
    // Other (JE-only) sources have nothing to reverse when unposted, so null them.
    // capital_asset: retain the createdAssetId linkage even pre-go-live so unexplain
    // can delete the asset register row (it's real master data, not a GL artefact).
    const retainLinkage = willPost || postedSourceType === 'InvoicePayment' || postedSourceType === 'SupplierPayment'
      || (postedSourceType === 'BankTxnExplain' && createdAssetId != null);
    await db.bankTransaction.update({
      where: { id: bankTxn.id as string },
      data: {
        transactionTypeKey: input.transactionTypeKey,
        categoryId: input.categoryId ?? null,
        payToUserId: input.payToUserId ?? null,
        taxTreatment: input.taxTreatment ?? null,
        taxAmount: resolvedTaxAmount,
        explainedDescription: input.explainedDescription ?? null,
        attachment: input.attachment ?? null,
        assetType: input.assetType ?? null,
        depreciationMethod: input.depreciationMethod ?? null,
        assetLifeMonths: input.assetLifeMonths ?? null,
        userPaymentReason: input.reason ?? null,
        explainStatus: 'EXPLAINED',
        approvedById: userId,
        approvedAt: new Date(),
        // Only mark reconciled when a GL posting was actually made.
        isReconciled: willPost,
        // InvoicePayment/SupplierPayment/capital_asset linkage is retained even pre-go-live
        // so unexplain can reverse the sub-ledger row. For other JE-only sources, null out when unposted.
        postedSourceType: retainLinkage ? postedSourceType : null,
        postedSourceId: retainLinkage ? postedSourceId : null,
        ...(relatedType ? { relatedType, relatedId: relatedId ?? null } : {}),
        // capital_asset: store the new FixedAsset id so unexplain can delete the register row.
        ...(createdAssetId != null ? { createdAssetId } : {}),
      },
    });

    const result: ExplainResult = { bankTxnId: bankTxn.id as string, journalEntryId, expenseId };

    // 6. Post-commit-in-transaction hook (approve path: learning hint). Runs
    // inside this same $transaction so it rolls back if it throws — the hint is
    // never recorded for a posting that didn't commit.
    if (input.onPosted) {
      await input.onPosted(txClient as unknown as Prisma.TransactionClient, result);
    }

    return result;
  });
}

/**
 * Generic gated posting for the behaviours that have no dedicated wrapper
 * (capital_asset / owner_funds / user_payment). Mirrors ledgerPosting's gate
 * so postings are skipped when the ledger isn't live.
 */
async function postGated(
  db: ExplainDb,
  p: {
    userId: string; sourceType: string; sourceId: string; event: string;
    date: Date; currencyCode: string; instructions: LineInstruction[];
  },
): Promise<{ id: string } | undefined> {
  const settings = await db.companySettings.findFirst({ where: { userId: p.userId } });
  if (!shouldPost(settings, p.date)) return undefined;
  const effectiveCurrency = p.currencyCode && p.currencyCode !== 'BASE' ? p.currencyCode : 'BASE';
  return post(db as unknown as LedgerTx, {
    userId: p.userId,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    event: p.event,
    date: p.date,
    currencyCode: effectiveCurrency,
    instructions: p.instructions,
  });
}

// ---------------------------------------------------------------------------
// unexplain
// ---------------------------------------------------------------------------

/**
 * Core unexplain flow — voids the forward posting (GL + payment/asset
 * artefacts) and resets the row's status, against an ALREADY-LOADED and
 * ownership-checked bank txn, using the caller's transaction client.
 * Called by unexplain() (own $transaction) and by explainAndPost() for the
 * re-explain path (inside its existing $transaction).
 */
async function unexplainCore(
  db: ExplainDb,
  input: UnexplainInput,
  bankTxn: Record<string, unknown>,
): Promise<void> {
  const postedSourceType = (bankTxn.postedSourceType as string | null) ?? null;
  const postedSourceId = (bankTxn.postedSourceId as string | null) ?? null;

  // Void the forward posting using the EXACT (sourceType, sourceId, event)
  // triple that explainAndPost posted with — voidDocument matches on all
  // three, so a mismatched event silently no-ops and orphans the original.
  // voidDocument SOFT-DELETES the forward JE (and frees its idempotency slot)
  // rather than minting a `.reversal` mirror, so a later re-explain posts a
  // FRESH entry instead of hitting the idempotency no-op. Balances exclude
  // soft-deleted JEs, so the source nets to zero by removal (no lone reversal).
  //   Expense (generic_category)        → postExpense          event 'recorded'
  //   InvoicePayment (invoice_link)     → postInvoicePayment   event 'payment'
  //   SupplierPayment (bill_link)       → postSupplierPayment  event 'payment'
  //   BankTxnExplain (income/asset/...) → post/postMoneyIn     event 'explained'
  if (postedSourceType === 'Expense' && postedSourceId) {
    // Void the expense's GL entry, then soft-delete the expense itself.
    await voidDocument(db, {
      userId: input.userId,
      sourceType: 'Expense',
      sourceId: postedSourceId,
      event: 'recorded',
    });
    await db.expense.update({ where: { id: postedSourceId }, data: { isDeleted: true } });
  } else if (postedSourceType === 'InvoicePayment') {
    const invoicePaymentId = postedSourceId;
    if (invoicePaymentId) {
      // 1. Void the GL journal entry for this InvoicePayment.
      await voidDocument(db, {
        userId: input.userId,
        sourceType: 'InvoicePayment',
        sourceId: invoicePaymentId,
        event: 'payment',
      });
      // 2. Mark the InvoicePayment as voided (mirrors invoicePaymentController void path).
      await db.invoicePayment.update({
        where: { id: invoicePaymentId },
        data: {
          isVoided: true,
          voidedById: input.userId,
          voidedAt: new Date(),
          voidReason: 'Unexplained from bank transaction',
        },
      });
      // 3. Recompute invoice status from non-voided payments (post-void).
      // Load the invoicePayment to get invoiceId.
      const payment = await db.invoicePayment.findUnique({ where: { id: invoicePaymentId } });
      if (payment) {
        const invoiceId = payment.invoiceId as string;
        const paidAgg = await db.invoicePayment.aggregate({
          where: { invoiceId, isVoided: false },
          _sum: { amount: true },
        });
        const paid = Number(paidAgg._sum.amount ?? 0);
        const inv = await db.invoice.findFirst({
          where: { id: invoiceId, userId: input.userId, isDeleted: false },
        });
        if (inv) {
          const total = Number(inv.TotalAmount);
          let status: string = 'UNPAID';
          if (paid >= total) status = 'PAID';
          else if (paid > 0) status = 'PARTIALLY_PAID';
          await db.invoice.update({ where: { id: invoiceId }, data: { status: status as 'UNPAID' | 'PAID' | 'PARTIALLY_PAID' } });
        }
      }
    } else {
      // Fallback: just void the GL entry keyed to the bank txn (old behavior for legacy records).
      await voidDocument(db, {
        userId: input.userId,
        sourceType: 'InvoicePayment',
        sourceId: input.bankTxnId,
        event: 'payment',
      });
    }
  } else if (postedSourceType === 'SupplierPayment') {
    const supplierPaymentId = postedSourceId;
    if (supplierPaymentId) {
      // 1. Void the GL journal entry for this SupplierPayment.
      await voidDocument(db, {
        userId: input.userId,
        sourceType: 'SupplierPayment',
        sourceId: supplierPaymentId,
        event: 'payment',
      });
      // 2. Mark the SupplierPayment as voided.
      await db.supplierPayment.update({
        where: { id: supplierPaymentId },
        data: {
          isVoided: true,
          voidedById: input.userId,
          voidedAt: new Date(),
          voidReason: 'Unexplained from bank transaction',
        },
      });
      // 3. Recompute purchase status from non-voided, non-deleted payments.
      const sp = await db.supplierPayment.findUnique({ where: { id: supplierPaymentId } });
      if (sp) {
        const purchaseId = sp.purchaseId as string;
        const paidAgg = await db.supplierPayment.aggregate({
          where: { purchaseId, isVoided: false, isDeleted: false },
          _sum: { amount: true },
        });
        const paid = Number(paidAgg._sum.amount ?? 0);
        const purchase = await db.purchase.findFirst({
          where: { id: purchaseId, userId: input.userId, isDeleted: false },
        });
        if (purchase) {
          const purchaseTotal = Number(purchase.totalAmount);
          const newBalance = purchaseTotal - paid;
          let newStatus: string = 'pending';
          if (newBalance <= 0) newStatus = 'paid';
          else if (paid > 0) newStatus = 'partially_paid';
          // If nothing paid, revert to 'pending' as safe default
          // (original status before payment is not stored; 'pending' is the most common open state)
          await db.purchase.update({
            where: { id: purchaseId },
            data: {
              paidAmount: toDecimal(paid),
              balanceAmount: toDecimal(newBalance),
              status: newStatus as 'pending' | 'partially_paid' | 'paid',
            },
          });
        }
      }
    } else {
      // Fallback: legacy record with no SupplierPayment id, just void the GL.
      await voidDocument(db, {
        userId: input.userId,
        sourceType: 'SupplierPayment',
        sourceId: input.bankTxnId,
        event: 'payment',
      });
    }
  } else if (postedSourceType === 'CreditNote') {
    await voidDocument(db, {
      userId: input.userId,
      sourceType: 'CreditNote',
      sourceId: postedSourceId ?? input.bankTxnId,
      event: 'refund',
    });
  } else if (postedSourceType === 'FixedAssetDisposal' && postedSourceId) {
    await voidDocument(db, {
      userId: input.userId,
      sourceType: 'FixedAssetDisposal',
      sourceId: postedSourceId,
      event: 'disposal',
    });
    // Restore the pre-disposal status: derive from depreciation state rather than
    // hard-coding 'active', so a fully-depreciated asset isn't silently downgraded
    // (which would wrongly re-depreciate it on the next run).
    const disposed = await db.fixedAsset.findFirst({ where: { id: postedSourceId, userId: input.userId } });
    let restoreStatus = 'active';
    if (disposed) {
      const accum = toDecimal(String(disposed.accumulatedDepreciation ?? '0'));
      const cost = toDecimal(String(disposed.cost ?? '0'));
      const salvage = toDecimal(String(disposed.salvageValue ?? '0'));
      if (accum.greaterThanOrEqualTo(cost.minus(salvage))) restoreStatus = 'fully_depreciated';
    }
    await db.fixedAsset.update({
      where: { id: postedSourceId },
      data: {
        status: restoreStatus,
        disposalDate: null,
        disposalProceeds: null,
      },
    });
  } else {
    // BankTxnExplain behaviours (income_generic / capital_asset / owner_funds / user_payment)
    await voidDocument(db, {
      userId: input.userId,
      sourceType: postedSourceType ?? 'BankTxnExplain',
      sourceId: postedSourceId ?? input.bankTxnId,
      event: 'explained',
    });

    // GAP 4: capital_asset unexplain — delete the FixedAsset register row created
    // by this explain, but ONLY if no depreciation has been posted against it yet.
    // If depreciation exists, the asset is entangled with GL entries we cannot
    // auto-reverse here; the user must reverse depreciation first.
    const linkedAssetId = (bankTxn.createdAssetId as string | null) ?? null;
    if (linkedAssetId) {
      const asset = await db.fixedAsset.findFirst({ where: { id: linkedAssetId, userId: input.userId } });
      if (asset) {
        const hasDepreciation =
          toDecimal(String(asset.accumulatedDepreciation ?? '0')).greaterThan(0) ||
          asset.lastDepreciatedOn != null;
        if (hasDepreciation) {
          throw new ExplainError(
            409,
            'Cannot unexplain: depreciation has been posted against the linked fixed asset. ' +
            'Reverse all depreciation entries first.',
          );
        }
        // Soft-delete the asset register row (no depreciation entanglement).
        await db.fixedAsset.update({
          where: { id: linkedAssetId },
          data: { isDeleted: true, status: 'disposed' },
        });
      }
    }
  }

  // Unexplain reverses the LEDGER + posting artefacts, but RETAINS the user's
  // prior selection on the row so the explain form can prefill it for re-edit.
  await db.bankTransaction.update({
    where: { id: input.bankTxnId },
    data: {
      // RETAINED (prior selection — drives form prefill):
      //   transactionTypeKey, categoryId, payToUserId, taxTreatment, taxAmount,
      //   explainedDescription, attachment, assetType, depreciationMethod,
      //   assetLifeMonths, userPaymentReason.
      // RESET (posting artefacts + status):
      explainStatus: 'UNEXPLAINED',
      approvedById: null,
      approvedAt: null,
      isReconciled: false,
      postedSourceType: null,
      postedSourceId: null,
      createdAssetId: null,
      autoPosted: false,
      // Linkage is CLEARED (new): the linked payment/artefact was voided above,
      // so a retained pointer is stale — and a retained non-MANUAL relatedType
      // used to permanently lock the row read-only (the stuck-green bug).
      // Clearing isPaymentBorn converts an unexplained payment-born row into a
      // normal manual row the user can explain in banking.
      relatedType: 'MANUAL',
      relatedId: null,
      isPaymentBorn: false,
    },
  });
}

export async function unexplain(input: UnexplainInput): Promise<void> {
  await prisma.$transaction(async (txClient) => {
    const db = txClient as unknown as ExplainDb;

    const bankTxn = await db.bankTransaction.findUnique({ where: { id: input.bankTxnId } });
    if (!bankTxn) throw new ExplainError(404, 'Bank transaction not found');

    const bank = await db.bankDetail.findUnique({ where: { id: bankTxn.bankAccountId as string } });
    if (!bank || bank.userId !== input.userId) {
      throw new ExplainError(404, 'Bank transaction not found');
    }

    await unexplainCore(db, input, bankTxn);
  });
}

// CommonJS interop for any legacy JS consumers.
module.exports = { explainAndPost, unexplain, ExplainError };
module.exports.explainAndPost = explainAndPost;
module.exports.unexplain = unexplain;
module.exports.ExplainError = ExplainError;
