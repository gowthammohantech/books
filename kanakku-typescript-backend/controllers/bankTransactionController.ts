import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { BankTransactionType, ExplainStatus } from '@prisma/client';
import { parse } from 'csv-parse/sync';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

import { matchBankTransaction, type MatchCandidate } from '../lib/reconciliationMatcher';
import { applyAutoMatch, type ApplyProposalDb } from '../lib/moneyFlow/applyProposal';
import { suggestBankTxnCategory } from '../lib/moneyFlow/aiCategorySuggest';
import { explainAndPost, ExplainError, type ExplainInput } from '../lib/moneyFlow/explainPosting';
import { recordHint } from '../lib/moneyFlow/explanationHints';
import { getTransactionType } from '../lib/moneyFlow/types';
import { sendPrismaError } from '../middleware/prismaError';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function toNumber(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isDebitType(t: string): boolean {
  return t === 'WITHDRAWAL' || t === 'TRANSFER_OUT' || t === 'PAYMENT';
}

const MONEY_IN_TYPES = new Set(['DEPOSIT', 'RECEIPT', 'TRANSFER_IN']);

// relatedType values that mean "this line was created BY a document/payment
// flow" (InvoicePayment / SupplierPayment / Expense recording, or a
// bank<->petty-cash transfer), as opposed to 'MANUAL' (a plain user-entered or
// CSV-imported row) or null. Document-linked lines must be undone through that
// document's own void/delete flow — see PaymentEffectsTx reversal helpers in
// lib/ledger/voidPaymentEffects.ts and the expense/petty-cash delete paths —
// which already restore bankDetail.currentBalance. Raw-removing the bank line
// AND later voiding/deleting the parent would reverse the same economic event
// twice.
const DOCUMENT_RELATED_TYPES = new Set([
  'INVOICE_PAYMENT',
  'SUPPLIER_PAYMENT',
  'EXPENSE',
  'PETTYCASH',
]);

function isDocumentLinked(relatedType: string | null, relatedId: string | null): boolean {
  return relatedType !== null && DOCUMENT_RELATED_TYPES.has(relatedType) && relatedId !== null;
}

function txnDirection(type: string): 'money_in' | 'money_out' {
  return MONEY_IN_TYPES.has(type) ? 'money_in' : 'money_out';
}

async function resolveDefaultCurrencyCode(): Promise<string | null> {
  const defaultCurrency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return defaultCurrency?.code ?? null;
}

/**
 * Ensures a PaymentMode exists that we can attach to CSV-imported transactions.
 * BankTransaction.paymentModeId is non-nullable in the schema, but CSV rows
 * typically don't carry an explicit payment mode, so we lazily create an
 * "Other" sentinel and reuse it.
 */
async function getOrCreateDefaultPaymentMode(
  tx: Prisma.TransactionClient,
): Promise<{ id: string; name: string; slug: string }> {
  const slug = 'other';
  const existing = await tx.paymentMode.findUnique({ where: { slug } });
  if (existing) {
    return { id: existing.id, name: existing.name, slug: existing.slug };
  }
  const created = await tx.paymentMode.create({
    data: { name: 'Other', slug, status: true },
  });
  return { id: created.id, name: created.name, slug: created.slug };
}

// -----------------------------------------------------------------------------
// Explanation + proposal labels (additive — read-only; no GL/status change)
// -----------------------------------------------------------------------------

export interface ExplanationLabel {
  kind: string;
  label: string;
  documentNo?: string | null;
  partyName?: string | null;
  link?: string | null;
  /** GL account the txn posted to (null when not resolvable for this kind). */
  accountCode?: string | null;
  accountName?: string | null;
  /** Raw linkage so the explain form can prefill its picker after unexplain. */
  relatedType?: string | null;
  relatedId?: string | null;
  /** Id of the linked document/entity (invoice / purchase / expense / etc.). */
  entityId?: string | null;
}

export interface ProposalLabel extends ExplanationLabel {
  confidence: string | null;
  score: number | null;
  /** Prefill for the inline explain form (from the stored proposed* columns). */
  transactionTypeKey?: string | null;
  categoryId?: string | null;
}

/** A subset of BankTransaction columns the labellers read. */
interface LabelTxn {
  id: string;
  explainStatus: string;
  relatedType: string | null;
  relatedId: string | null;
  postedSourceType: string | null;
  postedSourceId: string | null;
  /** The GL account id backing this txn's bank account (the cash/bank line). */
  bankGlAccountId?: string | null;
  categoryId: string | null;
  category?: { id: string; name: string; accountId?: string | null } | null;
  transactionTypeKey: string | null;
  userPaymentReason: string | null;
  explainedDescription: string | null;
  proposedRelatedType: string | null;
  proposedRelatedId: string | null;
  proposedTransactionTypeKey: string | null;
  proposedCategoryId: string | null;
  matchConfidence: string | null;
  matchScore: number | null;
}

/** Human-readable name for an invoice/credit-note Contact (org or person). */
function contactName(
  c: { firstName: string | null; lastName: string | null; organisation: string | null } | null,
): string | null {
  if (!c) return null;
  if (c.organisation) return c.organisation;
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return full || null;
}

/**
 * Resolve `explanation` (when EXPLAINED) for every txn on a page in BATCH — group
 * source-doc ids by type, run ONE query per type, then map each txn back. No N+1.
 *
 * Sources, by precedence: postedSourceType/Id first, else relatedType/Id, else
 * the txn's own category / transactionTypeKey. All lookups are tenant-scoped.
 */
async function buildExplanationMap(
  txns: LabelTxn[],
  userId: string,
): Promise<Map<string, ExplanationLabel>> {
  const out = new Map<string, ExplanationLabel>();

  // Collect ids per source model. A txn references its InvoicePayment /
  // SupplierPayment / Expense by *payment/expense* id (postedSourceId, or the
  // mirrored relatedId) — never the parent invoice/purchase id.
  const invoicePaymentIds = new Set<string>();
  const supplierPaymentIds = new Set<string>();
  const expenseIds = new Set<string>();

  // Classify each txn's primary source once.
  type Src =
    | { model: 'invoicePayment'; id: string }
    | { model: 'supplierPayment'; id: string }
    | { model: 'expense'; id: string }
    | { model: 'category' }
    | { model: 'typeKey' }
    | null;
  const srcOf = new Map<string, Src>();

  for (const t of txns) {
    const postedType = t.postedSourceType;
    const postedId = t.postedSourceId;
    const rel = t.relatedType;
    const relId = t.relatedId;

    if (t.explainStatus !== 'EXPLAINED') {
      // For unexplained rows that retained their prior relatedType/relatedId
      // (after unexplain), build a source entry so the frontend can prefill
      // the picker with a human-readable label. No posting exists, so
      // accountCode/accountName will be null — that is intentional.
      if (rel === 'INVOICE_PAYMENT' && relId) {
        invoicePaymentIds.add(relId);
        srcOf.set(t.id, { model: 'invoicePayment', id: relId });
      } else if (rel === 'SUPPLIER_PAYMENT' && relId) {
        supplierPaymentIds.add(relId);
        srcOf.set(t.id, { model: 'supplierPayment', id: relId });
      } else if (rel === 'EXPENSE' && relId) {
        expenseIds.add(relId);
        srcOf.set(t.id, { model: 'expense', id: relId });
      } else {
        srcOf.set(t.id, null);
      }
      continue;
    }

    if ((postedType === 'InvoicePayment' && postedId) || (rel === 'INVOICE_PAYMENT' && relId)) {
      const id = (postedType === 'InvoicePayment' ? postedId : relId) as string;
      invoicePaymentIds.add(id);
      srcOf.set(t.id, { model: 'invoicePayment', id });
    } else if (
      (postedType === 'SupplierPayment' && postedId) ||
      (rel === 'SUPPLIER_PAYMENT' && relId)
    ) {
      const id = (postedType === 'SupplierPayment' ? postedId : relId) as string;
      supplierPaymentIds.add(id);
      srcOf.set(t.id, { model: 'supplierPayment', id });
    } else if ((postedType === 'Expense' && postedId) || (rel === 'EXPENSE' && relId)) {
      const id = (postedType === 'Expense' ? postedId : relId) as string;
      expenseIds.add(id);
      srcOf.set(t.id, { model: 'expense', id });
    } else if (t.categoryId) {
      srcOf.set(t.id, { model: 'category' });
    } else if (t.transactionTypeKey) {
      srcOf.set(t.id, { model: 'typeKey' });
    } else {
      srcOf.set(t.id, null);
    }
  }

  // One query per source model, tenant-scoped.
  const [invoicePayments, supplierPayments, expenses] = await Promise.all([
    invoicePaymentIds.size
      ? prisma.invoicePayment.findMany({
          where: { id: { in: [...invoicePaymentIds] }, invoice: { userId } },
          select: {
            id: true,
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                customer: { select: { name: true } },
                contact: { select: { firstName: true, lastName: true, organisation: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    supplierPaymentIds.size
      ? prisma.supplierPayment.findMany({
          where: { id: { in: [...supplierPaymentIds] }, purchase: { userId } },
          select: {
            id: true,
            purchase: {
              select: {
                id: true,
                purchaseId: true,
                supplier: { select: { supplier_name: true } },
                contact: { select: { firstName: true, lastName: true, organisation: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    expenseIds.size
      ? prisma.expense.findMany({
          where: { id: { in: [...expenseIds] }, userId },
          select: {
            id: true,
            description: true,
            expenseCategory: { select: { title: true } },
            supplier: { select: { supplier_name: true } },
            contact: { select: { firstName: true, lastName: true, organisation: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const invoicePaymentById = new Map(invoicePayments.map((p) => [p.id, p]));
  const supplierPaymentById = new Map(supplierPayments.map((p) => [p.id, p]));
  const expenseById = new Map(expenses.map((e) => [e.id, e]));

  // -------------------------------------------------------------------------
  // GL account enrichment (read-only). Two resolution paths:
  //   • category kind   → the category's mapped Account (direct & reliable).
  //   • document kinds   → the posted JournalEntry's NON-bank line account, i.e.
  //     the income/expense/AR/AP leg (the bank/cash leg is excluded by matching
  //     the txn's own bank GL account, with a debit/credit fallback by kind).
  // Anything unresolved leaves accountCode/accountName null (never throws).
  // -------------------------------------------------------------------------
  const categoryIds = new Set<string>();
  // Journal lookups for document-backed kinds: (sourceType, sourceId) pairs.
  const jeSourceIds = new Set<string>(); // dedup of postedSourceId values
  const jeSourceTypes = new Set<string>();
  for (const t of txns) {
    const src = srcOf.get(t.id);
    if (!src) continue;
    if (src.model === 'category' && t.category?.accountId) {
      categoryIds.add(t.category.accountId);
    }
    if (t.postedSourceType && t.postedSourceId) {
      jeSourceTypes.add(t.postedSourceType);
      jeSourceIds.add(t.postedSourceId);
    }
  }

  const [catAccounts, journalEntries] = await Promise.all([
    categoryIds.size
      ? prisma.account.findMany({
          where: { id: { in: [...categoryIds] }, userId },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
    jeSourceIds.size
      ? prisma.journalEntry.findMany({
          where: {
            userId,
            isDeleted: false,
            sourceType: { in: [...jeSourceTypes] },
            sourceId: { in: [...jeSourceIds] },
          },
          select: {
            sourceType: true,
            sourceId: true,
            lines: {
              select: {
                accountId: true,
                debit: true,
                credit: true,
                account: { select: { code: true, name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const catAccountById = new Map(catAccounts.map((a) => [a.id, a]));
  // Key journal entries by `${sourceType}:${sourceId}` for O(1) lookup.
  const jeByKey = new Map(journalEntries.map((je) => [`${je.sourceType}:${je.sourceId}`, je]));

  /**
   * Pick the GL account a txn "is about" from its posted journal entry: the
   * non-bank line. Excludes the line on the txn's own bank GL account; when
   * several non-bank legs remain (e.g. an expense split + tax), pick the leg
   * with the largest absolute amount as the principal account. Returns null if
   * nothing resolves — display enrichment must never throw.
   */
  function resolvePostedAccount(t: LabelTxn): { code: string; name: string } | null {
    if (!t.postedSourceType || !t.postedSourceId) return null;
    const je = jeByKey.get(`${t.postedSourceType}:${t.postedSourceId}`);
    if (!je || je.lines.length === 0) return null;
    const nonBank = je.lines.filter((l) => l.accountId !== t.bankGlAccountId);
    const candidates = nonBank.length ? nonBank : je.lines;
    const principal = candidates.reduce((best, l) => {
      const amt = Math.abs(toNumber(l.debit)) + Math.abs(toNumber(l.credit));
      const bestAmt = Math.abs(toNumber(best.debit)) + Math.abs(toNumber(best.credit));
      return amt > bestAmt ? l : best;
    });
    const a = principal.account;
    return a ? { code: a.code, name: a.name } : null;
  }

  for (const t of txns) {
    const src = srcOf.get(t.id) ?? null;
    if (!src) continue;

    // Shared linkage carried on every explanation so the explain form can
    // prefill its picker after unexplain. `entityId` is the linked parent
    // document/entity (invoice / purchase / expense / asset id), distinct from
    // the payment/source id stored on the row.
    const posted = resolvePostedAccount(t);
    const linkage = {
      relatedType: t.relatedType,
      relatedId: t.relatedId,
      accountCode: posted?.code ?? null,
      accountName: posted?.name ?? null,
    };

    if (src.model === 'invoicePayment') {
      const p = invoicePaymentById.get(src.id);
      if (!p?.invoice) continue;
      const inv = p.invoice;
      const no = inv.invoiceNumber ?? inv.id;
      const party = inv.customer?.name ?? contactName(inv.contact) ?? null;
      out.set(t.id, {
        kind: 'invoice',
        label: `Invoice ${no}${party ? ` — ${party}` : ''}`,
        documentNo: no,
        partyName: party,
        link: `/admin/invoices/${inv.id}`,
        entityId: inv.id,
        ...linkage,
      });
    } else if (src.model === 'supplierPayment') {
      const p = supplierPaymentById.get(src.id);
      if (!p?.purchase) continue;
      const pur = p.purchase;
      const no = pur.purchaseId ?? pur.id;
      const party = pur.supplier?.supplier_name ?? contactName(pur.contact) ?? null;
      out.set(t.id, {
        kind: 'bill',
        label: `Bill ${no}${party ? ` — ${party}` : ''}`,
        documentNo: no,
        partyName: party,
        link: `/admin/purchases/${pur.id}`,
        entityId: pur.id,
        ...linkage,
      });
    } else if (src.model === 'expense') {
      const e = expenseById.get(src.id);
      const detail = e?.expenseCategory?.title ?? e?.description ?? t.explainedDescription ?? null;
      const party = e?.supplier?.supplier_name ?? contactName(e?.contact ?? null) ?? null;
      out.set(t.id, {
        kind: 'expense',
        label: `Expense${detail ? ` — ${detail}` : ''}`,
        documentNo: null,
        partyName: party,
        link: null,
        entityId: e?.id ?? src.id,
        ...linkage,
      });
    } else if (src.model === 'category') {
      const name = t.category?.name ?? null;
      // Category posts directly to its mapped GL account — prefer it over the
      // journal-derived account (it is the authoritative single leg).
      const catAcc = t.category?.accountId ? catAccountById.get(t.category.accountId) : null;
      out.set(t.id, {
        kind: 'category',
        label: name ?? 'Categorised',
        documentNo: null,
        partyName: null,
        link: null,
        entityId: t.categoryId,
        ...linkage,
        accountCode: catAcc?.code ?? linkage.accountCode,
        accountName: catAcc?.name ?? linkage.accountName,
      });
    } else if (src.model === 'typeKey') {
      const def = t.transactionTypeKey ? getTransactionType(t.transactionTypeKey) : undefined;
      const kind = transactionTypeKind(t.transactionTypeKey);
      out.set(t.id, {
        kind,
        label: def?.label ?? t.explainedDescription ?? 'Explained',
        documentNo: null,
        partyName: null,
        link: null,
        entityId: t.relatedId,
        ...linkage,
      });
    }
  }

  return out;
}

/** Coarse kind tag for owner/user/asset transaction-type behaviours. */
function transactionTypeKind(key: string | null): string {
  if (!key) return 'other';
  const def = getTransactionType(key);
  switch (def?.postingBehaviour) {
    case 'owner_funds':
      return 'owner';
    case 'user_payment':
      return 'user';
    case 'capital_asset':
    case 'asset_disposal':
      return 'asset';
    case 'credit_note_link':
      return 'credit_note';
    default:
      return 'category';
  }
}

/**
 * Build the `proposal` label for a FOR_APPROVAL txn from its stored proposed*
 * columns. Resolves the proposed invoice/purchase (tenant-scoped) for a
 * document-backed proposal, else falls back to the proposed category / type.
 */
async function buildProposal(t: LabelTxn, userId: string): Promise<ProposalLabel | null> {
  if (t.explainStatus !== 'FOR_APPROVAL') return null;

  const base = {
    confidence: t.matchConfidence,
    score: t.matchScore,
    transactionTypeKey: t.proposedTransactionTypeKey ?? null,
    categoryId: t.proposedCategoryId ?? null,
  };

  if (t.proposedRelatedType === 'INVOICE' && t.proposedRelatedId) {
    const inv = await prisma.invoice.findFirst({
      where: { id: t.proposedRelatedId, userId },
      select: {
        id: true,
        invoiceNumber: true,
        customer: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, organisation: true } },
      },
    });
    if (inv) {
      const no = inv.invoiceNumber ?? inv.id;
      const party = inv.customer?.name ?? contactName(inv.contact) ?? null;
      return {
        kind: 'invoice',
        label: `Proposed: Invoice ${no}${party ? ` — ${party}` : ''}`,
        documentNo: no,
        partyName: party,
        link: `/admin/invoices/${inv.id}`,
        relatedType: 'INVOICE_PAYMENT',
        entityId: inv.id,
        ...base,
      };
    }
  } else if (t.proposedRelatedType === 'PURCHASE' && t.proposedRelatedId) {
    const pur = await prisma.purchase.findFirst({
      where: { id: t.proposedRelatedId, userId },
      select: {
        id: true,
        purchaseId: true,
        supplier: { select: { supplier_name: true } },
        contact: { select: { firstName: true, lastName: true, organisation: true } },
      },
    });
    if (pur) {
      const no = pur.purchaseId ?? pur.id;
      const party = pur.supplier?.supplier_name ?? contactName(pur.contact) ?? null;
      return {
        kind: 'bill',
        label: `Proposed: Bill ${no}${party ? ` — ${party}` : ''}`,
        documentNo: no,
        partyName: party,
        link: `/admin/purchases/${pur.id}`,
        relatedType: 'SUPPLIER_PAYMENT',
        entityId: pur.id,
        ...base,
      };
    }
  }

  // Payment / category-style proposal (hint-backed; no document).
  if (t.proposedCategoryId) {
    const cat = await prisma.transactionCategory.findFirst({
      where: { id: t.proposedCategoryId, userId },
      select: { name: true },
    });
    if (cat) {
      return {
        kind: 'category',
        label: `Proposed: ${cat.name}`,
        documentNo: null,
        partyName: null,
        link: null,
        ...base,
      };
    }
  }

  // Last resort: label from the proposed transaction-type.
  const def = t.proposedTransactionTypeKey
    ? getTransactionType(t.proposedTransactionTypeKey)
    : undefined;
  return {
    kind: transactionTypeKind(t.proposedTransactionTypeKey),
    label: `Proposed: ${def?.label ?? 'Match'}`,
    documentNo: null,
    partyName: null,
    link: null,
    ...base,
  };
}

// =============================================================================
// list
// =============================================================================

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)));

    // Only see transactions on bank accounts owned by this user.
    const accounts = await prisma.bankDetail.findMany({
      where: { userId, isDeleted: false },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);

    const baseWhere: Prisma.BankTransactionWhereInput = {
      bankAccountId: { in: accountIds },
      isDeleted: false,
    };

    const where: Prisma.BankTransactionWhereInput = { ...baseWhere };
    const bankAccountIdFilter = req.query.bankAccountId as string | undefined;
    if (bankAccountIdFilter) where.bankAccountId = bankAccountIdFilter;
    const type = req.query.type as string | undefined;
    if (type) where.type = type as BankTransactionType;
    const isReconciled = req.query.isReconciled as string | undefined;
    if (isReconciled === 'true' || isReconciled === 'false') {
      where.isReconciled = isReconciled === 'true';
    }
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (from || to) {
      where.transactionDate = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const explainStatusFilter = req.query.explainStatus as string | undefined;
    if (explainStatusFilter) {
      where.explainStatus = explainStatusFilter as ExplainStatus;
    }
    const categoryIdFilter = req.query.categoryId as string | undefined;
    if (categoryIdFilter) where.categoryId = categoryIdFilter;
    const search = (req.query.search as string | undefined)?.trim();
    if (search) {
      where.OR = [
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { remarks: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total, companyDefaultCurrency, unexplainedCount, forApprovalCount, allCount] =
      await Promise.all([
        prisma.bankTransaction.findMany({
          where,
          include: {
            bankAccount: {
              select: {
                id: true,
                bankName: true,
                accountNumber: true,
                accountHoldername: true,
                currencyCode: true,
                accountId: true,
              },
            },
            paymentMode: { select: { id: true, name: true, slug: true } },
            category: { select: { id: true, name: true, group: true, accountId: true } },
          },
          orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.bankTransaction.count({ where }),
        resolveDefaultCurrencyCode(),
        prisma.bankTransaction.count({ where: { ...baseWhere, explainStatus: 'UNEXPLAINED' } }),
        prisma.bankTransaction.count({ where: { ...baseWhere, explainStatus: 'FOR_APPROVAL' } }),
        prisma.bankTransaction.count({ where: baseWhere }),
      ]);

    // Additive labels: WHAT each txn is explained as (+ the proposed match for
    // FOR_APPROVAL rows). Batched lookups across the page — no N+1.
    const labelTxns: LabelTxn[] = rows.map((r) => ({
      id: r.id,
      explainStatus: r.explainStatus,
      relatedType: r.relatedType,
      relatedId: r.relatedId,
      postedSourceType: r.postedSourceType,
      postedSourceId: r.postedSourceId,
      bankGlAccountId: r.bankAccount?.accountId ?? null,
      categoryId: r.categoryId,
      category: r.category
        ? { id: r.category.id, name: r.category.name, accountId: r.category.accountId }
        : null,
      transactionTypeKey: r.transactionTypeKey,
      userPaymentReason: r.userPaymentReason,
      explainedDescription: r.explainedDescription,
      proposedRelatedType: r.proposedRelatedType,
      proposedRelatedId: r.proposedRelatedId,
      proposedTransactionTypeKey: r.proposedTransactionTypeKey,
      proposedCategoryId: r.proposedCategoryId,
      matchConfidence: r.matchConfidence,
      matchScore: r.matchScore,
    }));
    const explanationMap = await buildExplanationMap(labelTxns, userId);
    const proposalMap = new Map<string, ProposalLabel>();
    await Promise.all(
      labelTxns
        .filter((t) => t.explainStatus === 'FOR_APPROVAL')
        .map(async (t) => {
          const p = await buildProposal(t, userId);
          if (p) proposalMap.set(t.id, p);
        }),
    );

    const transformed = rows.map((r) => ({
      id: r.id,
      bankAccountId: r.bankAccountId,
      bankAccount: r.bankAccount
        ? {
            id: r.bankAccount.id,
            bankName: r.bankAccount.bankName,
            accountNumber: r.bankAccount.accountNumber,
            accountHoldername: r.bankAccount.accountHoldername,
            currencyCode: r.bankAccount.currencyCode,
          }
        : null,
      transactionDate: r.transactionDate,
      type: r.type,
      direction: txnDirection(r.type),
      amount: toNumber(r.amount),
      balanceBefore: toNumber(r.balanceBefore),
      balanceAfter: toNumber(r.balanceAfter),
      currencyCode: r.bankAccount?.currencyCode ?? companyDefaultCurrency ?? null,
      paymentMode: r.paymentMode
        ? { id: r.paymentMode.id, name: r.paymentMode.name, slug: r.paymentMode.slug }
        : null,
      referenceNo: r.referenceNo,
      remarks: r.remarks,
      relatedType: r.relatedType,
      relatedId: r.relatedId,
      isReconciled: r.isReconciled,
      reconciledBy: r.reconciledBy,
      reconciliationDate: r.reconciliationDate,
      explainStatus: r.explainStatus,
      // AUTO-POST tier: true when this row was posted straight to the GL by the
      // auto-post pass (skipping the approval queue). Drives the FE badge + Undo.
      autoPosted: r.autoPosted,
      // Payment-born rows render read-only in banking (edit at source).
      isPaymentBorn: r.isPaymentBorn,
      taxTreatment: r.taxTreatment,
      transactionTypeKey: r.transactionTypeKey,
      explainedDescription: r.explainedDescription,
      categoryId: r.categoryId,
      category: r.category ?? null,
      explanation: explanationMap.get(r.id) ?? null,
      ...(r.explainStatus === 'FOR_APPROVAL'
        ? { proposal: proposalMap.get(r.id) ?? null }
        : {}),
    }));

    res.json({
      success: true,
      data: {
        bankTransactions: transformed,
        // Back-compat for the older `finance-and-accounting/BankTransactionList`
        // page which still consumes `data.transactions`.
        transactions: transformed,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        counts: {
          unexplained: unexplainedCount,
          forApproval: forApprovalCount,
          all: allCount,
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list bank transactions' });
  }
}

// =============================================================================
// getById
// =============================================================================

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const row = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
      include: {
        bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        paymentMode: { select: { id: true, name: true, slug: true } },
        category: { select: { id: true, name: true, group: true } },
      },
    });
    if (!row) {
      res.status(404).json({ success: false, message: 'Bank transaction not found' });
      return;
    }

    const labelTxn: LabelTxn = {
      id: row.id,
      explainStatus: row.explainStatus,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      postedSourceType: row.postedSourceType,
      postedSourceId: row.postedSourceId,
      categoryId: row.categoryId,
      category: row.category ? { id: row.category.id, name: row.category.name } : null,
      transactionTypeKey: row.transactionTypeKey,
      userPaymentReason: row.userPaymentReason,
      explainedDescription: row.explainedDescription,
      proposedRelatedType: row.proposedRelatedType,
      proposedRelatedId: row.proposedRelatedId,
      proposedTransactionTypeKey: row.proposedTransactionTypeKey,
      proposedCategoryId: row.proposedCategoryId,
      matchConfidence: row.matchConfidence,
      matchScore: row.matchScore,
    };
    const explanationMap = await buildExplanationMap([labelTxn], userId);
    const proposal =
      row.explainStatus === 'FOR_APPROVAL' ? await buildProposal(labelTxn, userId) : null;

    res.json({
      success: true,
      data: {
        bankTransaction: {
          ...row,
          amount: toNumber(row.amount),
          balanceBefore: toNumber(row.balanceBefore),
          balanceAfter: toNumber(row.balanceAfter),
          explanation: explanationMap.get(row.id) ?? null,
          ...(row.explainStatus === 'FOR_APPROVAL' ? { proposal } : {}),
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction getById error:', err);
    res.status(500).json({ success: false, message: 'Failed to load bank transaction' });
  }
}

// =============================================================================
// create — manual entry
// =============================================================================

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as {
      bankAccountId?: string;
      transactionDate?: string;
      type?: string;
      amount?: number | string;
      paymentModeId?: string;
      referenceNo?: string;
      remarks?: string;
    };

    if (!body.bankAccountId || !body.amount || !body.type) {
      res.status(400).json({
        success: false,
        message: 'bankAccountId, type, amount required',
      });
      return;
    }

    const account = await prisma.bankDetail.findFirst({
      where: { id: body.bankAccountId, userId, isDeleted: false },
    });
    if (!account) {
      res.status(404).json({ success: false, message: 'Bank account not found' });
      return;
    }

    const amount = new Prisma.Decimal(Number(body.amount));
    const balanceBefore = new Prisma.Decimal(
      (account.currentBalance ?? new Prisma.Decimal(0)).toString(),
    );
    const balanceAfter = isDebitType(body.type)
      ? balanceBefore.minus(amount)
      : balanceBefore.plus(amount);

    // Collects ids the matcher flags auto-post-eligible; posted post-commit below.
    const autoPostEligibleIds: string[] = [];
    const created = await prisma.$transaction(async (tx) => {
      // BankTransaction.paymentModeId is non-nullable; fall back to the
      // "Other" sentinel if the caller didn't supply one.
      let paymentModeId = body.paymentModeId;
      if (!paymentModeId) {
        const pm = await getOrCreateDefaultPaymentMode(tx);
        paymentModeId = pm.id;
      }

      const t = await tx.bankTransaction.create({
        data: {
          bankAccountId: body.bankAccountId!,
          transactionDate: body.transactionDate ? new Date(body.transactionDate) : new Date(),
          type: body.type as BankTransactionType,
          amount,
          balanceBefore,
          balanceAfter,
          paymentModeId,
          referenceNo: body.referenceNo || '',
          remarks: body.remarks || '',
          relatedType: 'MANUAL',
          relatedId: null,
        },
      });
      await tx.bankDetail.update({
        where: { id: body.bankAccountId! },
        data: { currentBalance: balanceAfter },
      });

      // Auto-analyse the freshly-created MANUAL txn: an AUTO best-match stamps the
      // proposal + FOR_APPROVAL (fills the approval queue). Best-effort — a matcher
      // error must never fail the create.
      try {
        const applied = await applyAutoMatch(
          tx as unknown as ApplyProposalDb,
          {
            id: t.id,
            type: t.type,
            amount: toNumber(t.amount),
            transactionDate: t.transactionDate,
            referenceNo: t.referenceNo,
            remarks: t.remarks,
            relatedType: t.relatedType,
            explainStatus: t.explainStatus,
          },
          userId,
        );
        if (applied.autoPostEligible) autoPostEligibleIds.push(t.id);
      } catch (matchErr) {
        console.error('bankTransaction create auto-analyse error:', matchErr);
      }

      return t;
    });

    // Post-commit AUTO-POST pass: safe (isolated tx), best-effort, gated on the
    // tenant toggle. A failure leaves the durable FOR_APPROVAL row untouched.
    await runAutoPostPass(userId, autoPostEligibleIds);

    res.status(201).json({
      success: true,
      message: 'Bank transaction created',
      data: {
        bankTransaction: {
          ...created,
          amount: toNumber(created.amount),
          balanceBefore: toNumber(created.balanceBefore),
          balanceAfter: toNumber(created.balanceAfter),
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create bank transaction' });
  }
}

// =============================================================================
// remove — soft delete
// =============================================================================

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Bank transaction not found' });
      return;
    }

    // DOUBLE-REVERSAL GUARD. A document-linked line (created by recording an
    // invoice payment / supplier payment / expense / petty-cash transfer) is
    // NOT a raw bank row — it is the bank-side mirror of that document. Voiding
    // or deleting the parent document already restores currentBalance via
    // lib/ledger/voidPaymentEffects.ts (or the expense/petty-cash delete path).
    // Removing this row too would apply that same reversal a second time.
    // Refuse; direct the caller to undo it from the source document instead.
    if (isDocumentLinked(existing.relatedType, existing.relatedId)) {
      res.status(409).json({
        success: false,
        message: `This transaction is linked to a ${existing.relatedType}; remove it by voiding/deleting that document instead of the bank transaction.`,
      });
      return;
    }

    // Soft-deleting a bank txn must also UNDO its effect on the account's running
    // currentBalance — otherwise the balance stays permanently skewed by the
    // removed line. A money-out txn (WITHDRAWAL/TRANSFER_OUT/PAYMENT) reduced the
    // balance on create, so removal adds the amount back; a money-in txn
    // (DEPOSIT/RECEIPT/TRANSFER_IN) added it, so removal subtracts it. Using the
    // row's own signed delta (balanceAfter − balanceBefore) inverts EXACTLY what
    // was applied. Note: earlier rows' materialized balanceBefore/After snapshots
    // are NOT retro-recomputed (out of scope) — only currentBalance is corrected.
    await prisma.$transaction(async (tx) => {
      const appliedDelta = new Prisma.Decimal(existing.balanceAfter.toString()).minus(
        new Prisma.Decimal(existing.balanceBefore.toString()),
      );
      const account = await tx.bankDetail.findFirst({
        where: { id: existing.bankAccountId, userId, isDeleted: false },
        select: { id: true, currentBalance: true },
      });
      if (account) {
        const newBalance = new Prisma.Decimal(
          (account.currentBalance ?? new Prisma.Decimal(0)).toString(),
        ).minus(appliedDelta);
        await tx.bankDetail.update({
          where: { id: account.id },
          data: { currentBalance: newBalance },
        });
      }
      await tx.bankTransaction.update({ where: { id }, data: { isDeleted: true } });
    });
    res.json({ success: true, message: 'Bank transaction deleted' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction remove error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete bank transaction' });
  }
}

// =============================================================================
// importPreview — parse CSV, return preview rows without persisting
// =============================================================================

interface PreviewRow {
  date: string;
  description: string;
  amount: number;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  reference: string;
  error?: string;
}

/**
 * Tolerant header aliases for a reference/cheque-number column. Matched
 * case-insensitively against the raw CSV header names (see importPreview).
 * Populating this improves the auto-matcher's reference-based scoring
 * (lib/reconciliationMatcher.ts, lib/moneyFlow/autoMatch.ts) instead of the
 * previously hardcoded '' on every imported row.
 */
const REFERENCE_COLUMN_ALIASES = [
  'reference',
  'ref',
  'ref_no',
  'reference_no',
  'referenceno',
  'cheque',
  'cheque_no',
  'chq',
  'chq_no',
  'utr',
  'rrn',
  'transaction_id',
  'transaction id',
];

function extractReference(row: Record<string, string>): string {
  for (const [key, value] of Object.entries(row)) {
    if (REFERENCE_COLUMN_ALIASES.includes(key.trim().toLowerCase())) {
      const trimmed = (value || '').trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

export async function importPreview(req: Request, res: Response): Promise<void> {
  try {
    requireUserId(req);
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ success: false, message: 'CSV file required' });
      return;
    }

    const csvText = file.buffer.toString('utf-8');
    let records: Array<Record<string, string>>;
    try {
      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, string>>;
    } catch (e) {
      res.status(400).json({
        success: false,
        message: `CSV parse error: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    const previewRows: PreviewRow[] = records.map((row) => {
      const date = row.date || row.Date || row.transaction_date || '';
      const description =
        row.description || row.Description || row.narration || row.remarks || '';
      const amountStr = row.amount || row.Amount || '';
      const typeStr = (row.type || row.Type || '').toUpperCase();
      const reference = extractReference(row);

      const errors: string[] = [];
      if (!date || isNaN(new Date(date).getTime())) errors.push('invalid date');
      const amt = Number(amountStr);
      if (!Number.isFinite(amt) || amt === 0) errors.push('invalid amount');

      let inferredType: 'DEPOSIT' | 'WITHDRAWAL' = 'DEPOSIT';
      if (typeStr === 'WITHDRAWAL' || typeStr === 'DEBIT' || amt < 0) {
        inferredType = 'WITHDRAWAL';
      }

      return {
        date,
        description,
        amount: Math.abs(amt) || 0,
        type: inferredType,
        reference,
        ...(errors.length ? { error: errors.join('; ') } : {}),
      };
    });

    res.json({
      success: true,
      data: {
        previewRows,
        validCount: previewRows.filter((r) => !r.error).length,
        invalidCount: previewRows.filter((r) => r.error).length,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction importPreview error:', err);
    res.status(500).json({ success: false, message: 'Failed to parse CSV' });
  }
}

// =============================================================================
// importConfirm — bulk insert reviewed rows, maintain running balance
// =============================================================================

export async function importConfirm(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as {
      bankAccountId?: string;
      rows?: Array<{
        date: string;
        description: string;
        amount: number;
        type: 'DEPOSIT' | 'WITHDRAWAL';
        reference?: string;
      }>;
    };

    if (!body.bankAccountId || !Array.isArray(body.rows) || body.rows.length === 0) {
      res.status(400).json({
        success: false,
        message: 'bankAccountId + non-empty rows[] required',
      });
      return;
    }

    const account = await prisma.bankDetail.findFirst({
      where: { id: body.bankAccountId, userId, isDeleted: false },
    });
    if (!account) {
      res.status(404).json({ success: false, message: 'Bank account not found' });
      return;
    }

    let runningBalance = new Prisma.Decimal(
      (account.currentBalance ?? new Prisma.Decimal(0)).toString(),
    );

    // Collects ids the matcher flags auto-post-eligible; posted post-commit below.
    const autoPostEligibleIds: string[] = [];
    const created = await prisma.$transaction(async (tx) => {
      const pm = await getOrCreateDefaultPaymentMode(tx);
      const out: Array<{ id: string }> = [];
      for (const row of body.rows!) {
        const amount = new Prisma.Decimal(row.amount);
        const before = runningBalance;
        const isDebit = row.type === 'WITHDRAWAL';
        const after = isDebit ? before.minus(amount) : before.plus(amount);
        runningBalance = after;

        const t = await tx.bankTransaction.create({
          data: {
            bankAccountId: body.bankAccountId!,
            transactionDate: new Date(row.date),
            type: row.type === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT',
            amount,
            balanceBefore: before,
            balanceAfter: after,
            paymentModeId: pm.id,
            referenceNo: row.reference || '',
            remarks: row.description,
            relatedType: 'MANUAL',
            relatedId: null,
          },
        });

        // Auto-analyse each imported MANUAL row (best-effort; never fail import).
        try {
          const applied = await applyAutoMatch(
            tx as unknown as ApplyProposalDb,
            {
              id: t.id,
              type: t.type,
              amount: toNumber(t.amount),
              transactionDate: t.transactionDate,
              referenceNo: t.referenceNo,
              remarks: t.remarks,
              relatedType: t.relatedType,
              explainStatus: t.explainStatus,
            },
            userId,
          );
          if (applied.autoPostEligible) autoPostEligibleIds.push(t.id);
        } catch (matchErr) {
          console.error('bankTransaction import auto-analyse error:', matchErr);
        }

        out.push({ id: t.id });
      }
      await tx.bankDetail.update({
        where: { id: body.bankAccountId! },
        data: { currentBalance: runningBalance },
      });
      return out;
    });

    // Post-commit AUTO-POST pass over the eligible imported rows: safe (isolated
    // per-row tx), best-effort, gated on the tenant toggle. One row's post failure
    // leaves it FOR_APPROVAL and never affects the others.
    await runAutoPostPass(userId, autoPostEligibleIds);

    res.status(201).json({
      success: true,
      message: `${created.length} bank transactions imported`,
      data: { ids: created.map((c) => c.id) },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction importConfirm error:', err);
    res.status(500).json({ success: false, message: 'Failed to import bank transactions' });
  }
}

// =============================================================================
// suggestMatches — return ranked candidate matches for an unreconciled bank txn
// =============================================================================

export async function suggestMatches(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const txn = await prisma.bankTransaction.findFirst({
      where: {
        id,
        bankAccount: { userId, isDeleted: false },
        isDeleted: false,
        isReconciled: false,
      },
    });
    if (!txn) {
      res
        .status(404)
        .json({ success: false, message: 'Bank transaction not found or already reconciled' });
      return;
    }

    const txnAmount = Number(txn.amount);
    const isInbound =
      txn.type === 'DEPOSIT' || txn.type === 'TRANSFER_IN' || txn.type === 'RECEIPT';

    let candidates: MatchCandidate[] = [];

    if (isInbound) {
      // Match against InvoicePayments (customer payments incoming)
      const payments = await prisma.invoicePayment.findMany({
        where: {
          invoice: { userId, isDeleted: false },
          paymentTransactionId: null, // not already linked to a gateway txn
        },
        include: {
          invoice: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: { received_on: 'desc' },
        take: 100,
      });
      candidates = payments.map((p) => ({
        id: p.id,
        kind: 'INVOICE_PAYMENT' as const,
        amount: Number(p.amount),
        date: p.received_on,
        reference: p.notes ?? '',
        parentLabel: p.invoice?.invoiceNumber ?? p.invoiceId,
      }));
    } else {
      // Match against SupplierPayments (outgoing payments to vendors)
      const payments = await prisma.supplierPayment.findMany({
        where: { createdBy: userId, isDeleted: false },
        include: {
          purchase: { select: { id: true, purchaseId: true } },
        },
        orderBy: { paymentDate: 'desc' },
        take: 100,
      });
      candidates = payments.map((p) => ({
        id: p.id,
        kind: 'SUPPLIER_PAYMENT' as const,
        amount: Number(p.paidAmount ?? p.amount),
        date: p.paymentDate,
        reference: p.referenceNumber ?? '',
        parentLabel: p.purchase?.purchaseId ?? p.purchaseId,
      }));
    }

    const matches = matchBankTransaction({
      txnAmount,
      txnDate: txn.transactionDate,
      txnReference: txn.referenceNo ?? '',
      candidates,
    });

    res.json({
      success: true,
      data: {
        bankTransactionId: txn.id,
        matches: matches.slice(0, 10).map((m) => ({
          candidateId: m.candidate.id,
          kind: m.candidate.kind,
          amount: m.candidate.amount,
          date: m.candidate.date,
          reference: m.candidate.reference,
          parentLabel: m.candidate.parentLabel,
          score: m.score,
          reasons: m.reasons,
        })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction suggestMatches error:', err);
    res.status(500).json({ success: false, message: 'Failed to suggest matches' });
  }
}

// =============================================================================
// link — mark a bank transaction as reconciled against a payment candidate
// =============================================================================

export async function link(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as {
      relatedType?: 'INVOICE_PAYMENT' | 'SUPPLIER_PAYMENT';
      relatedId?: string;
      note?: string;
    };

    if (!body.relatedType || !body.relatedId) {
      res
        .status(400)
        .json({ success: false, message: 'relatedType + relatedId required' });
      return;
    }

    const txn = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
    });
    if (!txn) {
      res.status(404).json({ success: false, message: 'Bank transaction not found' });
      return;
    }

    // PAYMENT-BORN GUARD. Several explain-flow posting outcomes (Expense/generic
    // category, income, capital asset, owner funds, user payment, etc.) set
    // explainStatus='EXPLAINED' and postedSourceType while leaving relatedType at its
    // default 'MANUAL' — so the relatedType-based guard below cannot see them. Without
    // this check `link` could still be called on an already-explained/posted txn,
    // stomping its relatedType/relatedId/isReconciled. That mis-link would then be
    // PERMANENTLY stuck, because `unlink` refuses to touch a payment-born line (by the
    // same explainStatus/postedSourceType test) — undo only via voiding/deleting the
    // source document, never via link/unlink.
    if (txn.explainStatus === 'EXPLAINED' || txn.postedSourceType != null) {
      res.status(409).json({
        success: false,
        message: `This transaction is linked to a posted document (${
          txn.postedSourceType ?? txn.relatedType ?? 'source'
        }); undo it by voiding/deleting that document instead of linking.`,
      });
      return;
    }

    // DOUBLE-POST GUARD (A2). A txn whose relatedType is already set and != MANUAL is
    // payment-born: it is ALREADY linked to its originating posted document. Re-linking
    // (or explaining) it would create a second payment → double-post. Refuse.
    if (txn.relatedType != null && txn.relatedType !== 'MANUAL') {
      res.status(409).json({
        success: false,
        message: `Bank transaction is already linked to its source (${txn.relatedType}${
          txn.relatedId ? ` ${txn.relatedId}` : ''
        }) and cannot be linked again.`,
      });
      return;
    }

    // EXCLUSIVITY GUARD. A single payment (InvoicePayment/SupplierPayment) settles
    // exactly ONE bank movement; nothing else marks it "consumed". Without this
    // check the same relatedId could be linked to unlimited bank txns, each
    // counting the payment toward its own cleared balance → the reconciled/cleared
    // balance double-counts. Reject if another non-deleted bank line in this tenant
    // already carries this (relatedType, relatedId) — including a payment-born line
    // created by the explain flow.
    const alreadyLinked = await prisma.bankTransaction.findFirst({
      where: {
        id: { not: id },
        isDeleted: false,
        relatedType: body.relatedType,
        relatedId: body.relatedId,
        bankAccount: { userId, isDeleted: false },
      },
      select: { id: true },
    });
    if (alreadyLinked) {
      res.status(409).json({
        success: false,
        message: `This ${body.relatedType} (${body.relatedId}) is already reconciled to another bank transaction (${alreadyLinked.id}) and cannot be linked again.`,
      });
      return;
    }

    const updated = await prisma.bankTransaction.update({
      where: { id },
      data: {
        relatedType: body.relatedType,
        relatedId: body.relatedId,
        isReconciled: true,
        reconciledBy: userId,
        reconciliationDate: new Date(),
        reconciliationNote: body.note ?? null,
      },
    });

    res.json({
      success: true,
      message: 'Linked + reconciled',
      data: { bankTransaction: { ...updated } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction link error:', err);
    res.status(500).json({ success: false, message: 'Failed to link' });
  }
}

// =============================================================================
// unlink — reset reconciliation state back to MANUAL/unreconciled
// =============================================================================

export async function unlink(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const txn = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
    });
    if (!txn) {
      res.status(404).json({ success: false, message: 'Bank transaction not found' });
      return;
    }

    // PAYMENT-BORN GUARD. `link` only ever transitions a MANUAL/unlinked line into a
    // reconciled one, so the ORIGINAL state we must restore on unlink is MANUAL/null.
    // But a payment-born line (created EXPLAINED by the explain flow, with a
    // postedSourceType and a posted journal entry behind it) was NEVER link-created —
    // blindly rewriting it to MANUAL erases the linkage the double-post guard and the
    // explain flow rely on, letting a second explain double-post the payment (the
    // original economic event is only reversed by voiding/deleting that document).
    // Refuse: such a line must be undone through its source document, not unlink.
    if (txn.explainStatus === 'EXPLAINED' || txn.postedSourceType != null) {
      res.status(409).json({
        success: false,
        message: `This transaction is linked to a posted document (${
          txn.postedSourceType ?? txn.relatedType ?? 'source'
        }); undo it by voiding/deleting that document instead of unlinking.`,
      });
      return;
    }

    const updated = await prisma.bankTransaction.update({
      where: { id },
      data: {
        relatedType: 'MANUAL',
        relatedId: null,
        isReconciled: false,
        reconciledBy: null,
        reconciliationDate: null,
        reconciliationNote: null,
      },
    });

    res.json({
      success: true,
      message: 'Unlinked',
      data: { bankTransaction: { ...updated } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction unlink error:', err);
    res.status(500).json({ success: false, message: 'Failed to unlink' });
  }
}

// =============================================================================
// analyse — run the auto-matcher on one UNEXPLAINED MANUAL txn (on demand)
// =============================================================================

export async function analyse(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const txn = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
    });
    if (!txn) {
      res.status(404).json({ success: false, message: 'Bank transaction not found' });
      return;
    }

    const { status, candidates, best, autoPostEligible } = await applyAutoMatch(
      prisma as unknown as ApplyProposalDb,
      {
        id: txn.id,
        type: txn.type,
        amount: toNumber(txn.amount),
        transactionDate: txn.transactionDate,
        referenceNo: txn.referenceNo,
        remarks: txn.remarks,
        relatedType: txn.relatedType,
        explainStatus: txn.explainStatus,
      },
      userId,
    );

    // On-demand analyse also honours the auto-post tier (same best-effort pass).
    if (autoPostEligible) await runAutoPostPass(userId, [txn.id]);

    // AI fallback: if the local matcher found nothing, ask the gateway to
    // classify the transaction into a category (best-effort, never throws).
    let effectiveStatus = status;
    if (status === 'UNEXPLAINED') {
      const ai = await suggestBankTxnCategory(
        {
          id: txn.id,
          type: txn.type,
          amount: txn.amount,
          remarks: txn.remarks,
          referenceNo: txn.referenceNo,
          relatedType: txn.relatedType,
          explainStatus: txn.explainStatus,
        },
        userId,
      );
      effectiveStatus = ai.status;
    }

    res.json({ success: true, data: { status: effectiveStatus, candidates, best } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction analyse error:', err);
    res.status(500).json({ success: false, message: 'Failed to analyse bank transaction' });
  }
}

// =============================================================================
// analyseAll — run the auto-matcher over the tenant's UNEXPLAINED MANUAL txns
// =============================================================================

const ANALYSE_ALL_CAP = 500;

export async function analyseAll(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const txns = await prisma.bankTransaction.findMany({
      where: {
        bankAccount: { userId, isDeleted: false },
        isDeleted: false,
        relatedType: 'MANUAL',
        explainStatus: 'UNEXPLAINED',
      },
      take: ANALYSE_ALL_CAP,
      orderBy: { transactionDate: 'desc' },
    });

    let analysed = 0;
    let queued = 0;
    const autoPostEligibleIds: string[] = [];
    for (const txn of txns) {
      analysed += 1;
      try {
        const { status, autoPostEligible } = await applyAutoMatch(
          prisma as unknown as ApplyProposalDb,
          {
            id: txn.id,
            type: txn.type,
            amount: toNumber(txn.amount),
            transactionDate: txn.transactionDate,
            referenceNo: txn.referenceNo,
            remarks: txn.remarks,
            relatedType: txn.relatedType,
            explainStatus: txn.explainStatus,
          },
          userId,
        );
        if (status === 'FOR_APPROVAL') queued += 1;
        if (autoPostEligible) autoPostEligibleIds.push(txn.id);
      } catch (matchErr) {
        console.error('bankTransaction analyseAll item error:', matchErr);
      }
    }

    // Post-pass auto-post over eligible rows (best-effort, tenant-gated).
    const autoPosted = await runAutoPostPass(userId, autoPostEligibleIds);

    res.json({ success: true, data: { analysed, queued, autoPosted } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction analyseAll error:', err);
    res.status(500).json({ success: false, message: 'Failed to analyse bank transactions' });
  }
}

// =============================================================================
// approve — one-click post a FOR_APPROVAL txn from its stored proposal
// =============================================================================

/**
 * Map a proposal's relatedType to the explain-input id field the type's posting
 * behaviour expects. invoice → invoiceId, bill/purchase → billId.
 */
function proposalLinkFields(
  relatedType: string | null | undefined,
  relatedId: string | null | undefined,
): { invoiceId?: string; billId?: string } {
  if (!relatedId) return {};
  switch (relatedType) {
    case 'INVOICE':
    case 'INVOICE_PAYMENT':
      return { invoiceId: relatedId };
    case 'PURCHASE':
    case 'SUPPLIER_PAYMENT':
    case 'BILL':
      return { billId: relatedId };
    default:
      return {};
  }
}

// Structural slice of the FOR_APPROVAL bank row the proposal-posting path reads.
interface ProposalTxnRow {
  id: string;
  proposedTransactionTypeKey: string | null;
  proposedCategoryId: string | null;
  proposedRelatedType: string | null;
  proposedRelatedId: string | null;
  transactionTypeKey: string | null;
  categoryId: string | null;
  payToUserId: string | null;
  userPaymentReason: string | null;
  explainedDescription: string | null;
  remarks: string | null;
  referenceNo: string | null;
}

/**
 * Atomically CLAIM a FOR_APPROVAL row for posting — closes the double-post TOCTOU.
 *
 * explainAndPost has NO engine-level idempotency guard for MANUAL rows (its guard
 * only covers payment-born, non-MANUAL rows). Two concurrent posters (two analyse
 * / analyseAll passes, or the auto-post pass racing a manual approve) could both
 * read FOR_APPROVAL and both post → duplicate JE/expense. This conditional
 * updateMany flips FOR_APPROVAL → EXPLAINED in a single atomic statement; exactly
 * one caller wins (count === 1), the loser gets count === 0 and must NOT post.
 * Tenant-scoped defensively. When markAutoPosted, the winning claim also stamps
 * autoPosted=true so the row is EXPLAINED + auto-posted atomically.
 */
async function claimForApproval(
  userId: string,
  id: string,
  opts?: { markAutoPosted?: boolean },
): Promise<boolean> {
  const res = await prisma.bankTransaction.updateMany({
    where: { id, explainStatus: 'FOR_APPROVAL', bankAccount: { userId, isDeleted: false }, isDeleted: false },
    data: { explainStatus: 'EXPLAINED', ...(opts?.markAutoPosted ? { autoPosted: true } : {}) },
  });
  return res.count > 0;
}

/**
 * Release a claim back to FOR_APPROVAL when the subsequent post FAILS (so the row
 * returns to the queue and nothing is lost). Also clears autoPosted for the
 * auto-post path. Safe to call unconditionally on the failure branch.
 */
async function releaseClaim(
  userId: string,
  id: string,
  opts?: { markAutoPosted?: boolean },
): Promise<void> {
  await prisma.bankTransaction.updateMany({
    where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
    data: { explainStatus: 'FOR_APPROVAL', ...(opts?.markAutoPosted ? { autoPosted: false } : {}) },
  });
}

/**
 * Build the ExplainInput that posts a FOR_APPROVAL row from its stored proposal.
 *
 * Shared by BOTH the manual approve endpoint and the auto-post pass so the two use
 * the IDENTICAL posting path (proposal → explainAndPost → recordHint + clear
 * snapshot) and never diverge. `body` supplies edit-then-approve overrides (empty
 * for the auto-post pass). When `markAutoPosted` is set, the atomic onPosted hook
 * also stamps autoPosted=true so the row commits EXPLAINED + auto-posted together.
 * Returns null when there is no transaction type to post (caller decides: approve
 * → 400; auto-post pass → skip).
 */
function assembleProposalExplainInput(
  txn: ProposalTxnRow,
  userId: string,
  body: Record<string, unknown>,
  opts?: { markAutoPosted?: boolean },
): ExplainInput | null {
  const proposalLinks = proposalLinkFields(txn.proposedRelatedType, txn.proposedRelatedId);

  const transactionTypeKey =
    (body.transactionTypeKey as string | undefined) ??
    txn.proposedTransactionTypeKey ??
    txn.transactionTypeKey ??
    undefined;
  if (!transactionTypeKey) return null;

  const categoryId =
    (body.categoryId as string | undefined) ?? txn.proposedCategoryId ?? txn.categoryId ?? undefined;
  const payToUserId = (body.payToUserId as string | undefined) ?? txn.payToUserId ?? undefined;
  const invoiceId = (body.invoiceId as string | undefined) ?? proposalLinks.invoiceId;
  const billId = (body.billId as string | undefined) ?? proposalLinks.billId;

  return {
    bankTxnId: txn.id,
    userId,
    transactionTypeKey,
    categoryId,
    payToUserId,
    invoiceId,
    billId,
    taxTreatment: body.taxTreatment as string | undefined,
    manualTaxAmount: body.manualTaxAmount as string | number | undefined,
    explainedDescription:
      (body.explainedDescription as string | undefined) ?? txn.explainedDescription ?? undefined,
    attachment: body.attachment as string | undefined,
    assetType: body.assetType as string | undefined,
    depreciationMethod: body.depreciationMethod as string | undefined,
    assetLifeMonths: body.assetLifeMonths as number | undefined,
    creditNoteId: body.creditNoteId as string | undefined,
    assetId: body.assetId as string | undefined,
    reason: (body.reason as string | undefined) ?? txn.userPaymentReason ?? undefined,
    // Atomic learning capture + proposal clear: runs inside explainAndPost's
    // $transaction, after the stamp, so it rolls back if posting fails.
    onPosted: async (tx) => {
      await recordHint(tx as never, {
        userId,
        payee: txn.remarks || txn.referenceNo,
        transactionTypeKey,
        categoryId,
        payToUserId,
      });
      await tx.bankTransaction.update({
        where: { id: txn.id },
        data: {
          proposedTransactionTypeKey: null,
          proposedCategoryId: null,
          proposedRelatedType: null,
          proposedRelatedId: null,
          matchConfidence: null,
          matchScore: null,
          // Auto-post tier: stamp the audit/badge marker atomically with the post.
          ...(opts?.markAutoPosted ? { autoPosted: true } : {}),
        },
      });
    },
  };
}

/**
 * Post-commit AUTO-POST pass (Option 1).
 *
 * Runs AFTER the create/import/analyse transaction has COMMITTED. For each row the
 * matcher flagged auto-post-eligible, if the tenant opted in (bankAutoPostEnabled),
 * post it straight to the GL via explainAndPost — its OWN transaction, the exact
 * path approveBankTransaction uses. This is deliberately NOT done inside the
 * caller's transaction: explainAndPost writes sub-ledger rows before its period-lock
 * / posting checks can throw, and Prisma has no savepoint, so a mid-post failure
 * inside the caller's transaction could commit an orphaned sub-ledger row. Running
 * post-commit in an isolated transaction makes every failure roll back cleanly.
 *
 * Best-effort + safe fallback: the durable FOR_APPROVAL row was already written by
 * applyAutoMatch, so on PeriodLockedError OR ANY posting error we simply leave the
 * row in the approval queue, log a warning, and CONTINUE — one row's failure never
 * affects the others or the import.
 *
 * approvalsEnabled interaction: auto-post honours the explicit bankAutoPostEnabled
 * opt-in INDEPENDENTLY of approvalsEnabled. A maker-checker tenant that also enables
 * auto-post has deliberately chosen to bypass review for the strongest matches; the
 * strict eligibility bar (autoMatch.autoPostEligible) + one-click unexplain undo are
 * the compensating controls (the FE toggle copy warns the user).
 */
async function runAutoPostPass(userId: string, eligibleIds: string[]): Promise<number> {
  if (eligibleIds.length === 0) return 0;

  let posted = 0;
  // Pass-level guard: the whole pass (settings read + loop) runs AFTER the caller's
  // rows already committed. A throw here (e.g. the settings read failing) must NEVER
  // turn a successful import into a 500 — that could make the client retry and
  // duplicate the imported rows. Swallow + warn; the durable FOR_APPROVAL rows stand.
  try {
    const settings = await prisma.companySettings.findFirst({
      where: { userId },
      select: { bankAutoPostEnabled: true },
    });
    if (!settings?.bankAutoPostEnabled) return 0; // default OFF → preserve queue behaviour

    for (const id of eligibleIds) {
      // Atomic claim: exactly one poster wins FOR_APPROVAL → EXPLAINED (+autoPosted).
      // A loser (already claimed by a concurrent pass/approve) gets false → skip.
      const claimed = await claimForApproval(userId, id, { markAutoPosted: true });
      if (!claimed) continue;

      try {
        // Read AFTER claiming; proposal fields are still intact (explainAndPost's
        // onPosted clears them only on success).
        const txn = await prisma.bankTransaction.findFirst({
          where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
        });
        const input = txn
          ? assembleProposalExplainInput(txn as unknown as ProposalTxnRow, userId, {}, { markAutoPosted: true })
          : null;
        if (!input) {
          // Nothing to post from — undo the claim so the row returns to the queue.
          await releaseClaim(userId, id, { markAutoPosted: true });
          continue;
        }

        await explainAndPost(input);
        posted += 1;
      } catch (err) {
        // PeriodLockedError or ANY posting error → roll the claim back to
        // FOR_APPROVAL (never lose the match), warn, and carry on with the rest.
        await releaseClaim(userId, id, { markAutoPosted: true });
        console.warn(
          `bank auto-post skipped for ${id}; left in FOR_APPROVAL queue:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (passErr) {
    console.warn(
      'bank auto-post pass aborted; eligible rows left in FOR_APPROVAL queue:',
      passErr instanceof Error ? passErr.message : passErr,
    );
  }
  return posted;
}

export async function approveBankTransaction(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;

    const txn = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
    });
    if (!txn) {
      res.status(404).json({ success: false, message: 'Bank transaction not found' });
      return;
    }
    if (txn.explainStatus !== 'FOR_APPROVAL') {
      res.status(409).json({
        success: false,
        message: 'Bank transaction is not awaiting approval',
      });
      return;
    }

    // Build the explain input from the stored proposal, letting an optional body
    // override each field (edit-then-approve). Reuses the SAME assembler as the
    // auto-post pass so the two posting paths never diverge.
    const input = assembleProposalExplainInput(txn as unknown as ProposalTxnRow, userId, body);
    if (!input) {
      res.status(400).json({
        success: false,
        message: 'No proposed transaction type to approve',
      });
      return;
    }

    // Atomic claim to close the double-post TOCTOU (shares the guard with the
    // auto-post pass): flips FOR_APPROVAL → EXPLAINED in one statement so an
    // auto-post pass or a second approve racing this one cannot also post.
    const claimed = await claimForApproval(userId, id);
    if (!claimed) {
      res.status(409).json({
        success: false,
        message: 'Bank transaction is not awaiting approval',
      });
      return;
    }

    let out;
    try {
      out = await explainAndPost(input);
    } catch (postErr) {
      // Post failed → roll the claim back to FOR_APPROVAL so it can be retried,
      // then let the outer catch map the error (ExplainError → status, etc.).
      await releaseClaim(userId, id);
      throw postErr;
    }

    res.status(200).json({ success: true, message: 'Approved and posted', data: out });
  } catch (err) {
    if (err instanceof ExplainError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    sendPrismaError(res, err);
  }
}

// =============================================================================
// reject — send a FOR_APPROVAL txn back to UNEXPLAINED, clear the proposal
// =============================================================================

export async function rejectBankTransaction(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const txn = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId, isDeleted: false }, isDeleted: false },
    });
    if (!txn) {
      res.status(404).json({ success: false, message: 'Bank transaction not found' });
      return;
    }
    if (txn.explainStatus !== 'FOR_APPROVAL') {
      res.status(409).json({
        success: false,
        message: 'Bank transaction is not awaiting approval',
      });
      return;
    }

    // No GL — only reset the workflow state + clear the proposal snapshot and
    // its mirrored explain-input fields stamped by the matcher (B3).
    const updated = await prisma.bankTransaction.update({
      where: { id },
      data: {
        explainStatus: 'UNEXPLAINED',
        proposedTransactionTypeKey: null,
        proposedCategoryId: null,
        proposedRelatedType: null,
        proposedRelatedId: null,
        matchConfidence: null,
        matchScore: null,
        transactionTypeKey: null,
        categoryId: null,
        payToUserId: null,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Rejected; returned to unexplained',
      data: { bankTransaction: { id: updated.id, explainStatus: updated.explainStatus } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('bankTransaction reject error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject bank transaction' });
  }
}

// CommonJS interop for adminRoutes.js which uses `require(...)`.
const handlers = {
  list,
  getById,
  create,
  remove,
  importPreview,
  importConfirm,
  suggestMatches,
  link,
  unlink,
  analyse,
  analyseAll,
  approveBankTransaction,
  rejectBankTransaction,
};
module.exports = handlers;
module.exports.default = handlers;
