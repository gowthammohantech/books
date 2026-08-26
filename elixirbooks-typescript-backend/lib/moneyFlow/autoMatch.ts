// lib/moneyFlow/autoMatch.ts
//
// Banking Phase B / B2 — the auto-matcher.
//
// Given an UNEXPLAINED MANUAL bank transaction, propose the best explanation by:
//   (a) consulting the learning store (lookupHint: payee -> type/category), and
//   (b) scoring candidate documents — OPEN invoices (inbound), OPEN
//       bills/purchases (outbound) — by amount + date + reference (reusing the
//       existing pure scorer in lib/reconciliationMatcher) PLUS a party/contact
//       name bonus when the candidate's party matches the normalised payee.
//
// The returned ProposedExplanation carries the EXACT transactionTypeKey + id
// field that explainAndPost expects, so a later approve (Task 4) can feed the
// proposal straight into explainAndPost:
//   invoice_receipt -> behaviour 'invoice_link', expects input.invoiceId  (relatedType 'INVOICE')
//   bill_payment    -> behaviour 'bill_link',    expects input.billId     (relatedType 'PURCHASE')
//   payment         -> behaviour 'generic_category', expects input.categoryId (from the hint)
//
// This module does pure proposal building — it never writes. Persisting the
// proposal columns (Task 3) and the approve endpoint (Task 4) live elsewhere.

import { matchBankTransaction, type MatchCandidate } from '../reconciliationMatcher';
import { lookupHint, normalisePayeeKey } from './explanationHints';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProposedExplanation {
  transactionTypeKey: string;
  relatedType?: string;
  relatedId?: string;
  categoryId?: string | null;
  payToUserId?: string | null;
  partyName?: string;
  score: number;
  confidence: 'AUTO' | 'SUGGEST';
  /**
   * The STRICTER bar for the auto-post tier (a superset gate ON TOP of AUTO).
   *
   * True ONLY when confidence is AUTO AND at least one STRONG "agreed" signal
   * holds:
   *   - hint-backed — the user previously approved this exact payee's treatment
   *     (a learned, user-confirmed mapping — the truest "taken as agreed"), OR
   *   - a document match (invoice/bill) with EXACT amount AND party-name match.
   *
   * A plain AUTO backed only by e.g. exact-amount + reference (no party, no hint)
   * is a single weak signal → autoPostEligible=false → it stays FOR_APPROVAL
   * (queue) and is NEVER auto-posted. SUGGEST is always false.
   */
  autoPostEligible: boolean;
  /**
   * Internal signal: did this DOCUMENT candidate match the txn amount EXACTLY?
   * Used to gate hint-reinforced auto-post eligibility — a hint substitutes for a
   * party-name match but NEVER for exact amount, so a wrong-amount receipt cannot
   * auto-post as a partial payment. Undefined for non-doc (hint-generic) proposals.
   */
  exactAmount?: boolean;
  label: string;
}

export interface AutoMatchResult {
  candidates: ProposedExplanation[];
  best?: ProposedExplanation;
}

// Minimal structural slice of the Prisma (tx) client this matcher needs.
// Keeping it structural lets the spec drive it with stubbed fetchers.
export interface AutoMatchDb {
  invoice: {
    findMany: (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown[]>;
  };
  purchase: {
    findMany: (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown[]>;
  };
  expense: {
    findMany: (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown[]>;
  };
}

export interface AutoMatchBankTxn {
  id: string;
  type: string;
  amount: number | string;
  transactionDate?: Date;
  referenceNo?: string | null;
  remarks?: string | null;
}

// ---------------------------------------------------------------------------
// Constants — direction + scoring
// ---------------------------------------------------------------------------

const INBOUND_TYPES = new Set(['DEPOSIT', 'RECEIPT', 'TRANSFER_IN']);

// reconciliationMatcher filters at score >= 50 (its internal threshold). We
// reuse that as the "clears threshold" bar for `best`.
const MATCH_THRESHOLD = 50;
// Bonus added when the candidate's party/contact name matches the payee. Large
// enough to break ties between equally-scored docs and to lift a party match
// clearly above a non-party hint proposal, but it does not by itself clear the
// threshold (so a far-off amount can't be rescued by party alone).
const PARTY_BONUS = 20;
// A hint with no document match still produces a usable proposal; give it a
// score that exactly clears the threshold so it can be `best` only when no
// (better-scoring) document candidate exists.
const HINT_BASE_SCORE = MATCH_THRESHOLD;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInbound(bankTxnType: string): boolean {
  return INBOUND_TYPES.has(String(bankTxnType).toUpperCase());
}

/** Derive the raw payee text from a bank txn (remarks preferred, then ref). */
function rawPayee(bankTxn: AutoMatchBankTxn): string {
  return (bankTxn.remarks ?? '') || (bankTxn.referenceNo ?? '') || '';
}

/** Resolve a candidate's party/contact display name (customer/supplier/contact). */
function partyNameOf(doc: Record<string, unknown>): string | null {
  const customer = doc.customer as { name?: string | null } | null | undefined;
  const supplier = doc.supplier as { name?: string | null } | null | undefined;
  const contact = doc.contact as
    | { organisation?: string | null; firstName?: string | null; lastName?: string | null }
    | null
    | undefined;
  if (customer?.name) return customer.name;
  if (supplier?.name) return supplier.name;
  if (contact) {
    if (contact.organisation) return contact.organisation;
    const full = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
    if (full) return full;
  }
  return null;
}

/**
 * True when the candidate's party name matches the normalised payee. We accept
 * a match when either normalised string contains the other (so "ACME CORP" on
 * the statement matches a "Acme Corp" customer, and a longer bank memo that
 * embeds the party name also matches).
 */
function partyMatches(payeeKey: string, partyName: string | null): boolean {
  if (!payeeKey || !partyName) return false;
  const partyKey = normalisePayeeKey(partyName);
  if (!partyKey) return false;
  return payeeKey.includes(partyKey) || partyKey.includes(payeeKey);
}

// ---------------------------------------------------------------------------
// autoMatch
// ---------------------------------------------------------------------------

export async function autoMatch(
  tx: AutoMatchDb,
  bankTxn: AutoMatchBankTxn,
  userId: string,
): Promise<AutoMatchResult> {
  const amount = Number(bankTxn.amount);
  const date = bankTxn.transactionDate instanceof Date ? bankTxn.transactionDate : new Date();
  const reference = String(bankTxn.referenceNo ?? '');
  const payeeKey = normalisePayeeKey(rawPayee(bankTxn));
  const inbound = isInbound(bankTxn.type);

  // 1. Learning store — consult the hint first.
  const hint = await lookupHint(tx as never, userId, rawPayee(bankTxn));

  const candidates: ProposedExplanation[] = [];

  // 2 + 3 + 4. Fetch + score direction-appropriate documents.
  if (inbound) {
    // OPEN invoices: unpaid / partially-paid, not deleted, tenant-scoped.
    const invoices = (await tx.invoice.findMany({
      where: {
        userId,
        isDeleted: false,
        status: { in: ['UNPAID', 'PARTIALLY_PAID', 'SENT', 'OVERDUE'] },
      },
      include: { customer: true, contact: true },
    })) as Record<string, unknown>[];

    for (const inv of invoices) {
      const proposal = scoreDoc({
        doc: inv,
        amount: Number(inv.TotalAmount),
        docDate: (inv.invoiceDate as Date | undefined) ?? date,
        docReference: String(inv.referenceNo ?? ''),
        txnAmount: amount,
        txnDate: date,
        txnReference: reference,
        payeeKey,
        hintBacks: false,
        transactionTypeKey: 'invoice_receipt',
        relatedType: 'INVOICE',
        relatedId: String(inv.id),
        docNo: (inv.invoiceNumber as string | undefined) ?? null,
        labelPrefix: 'Invoice',
      });
      if (proposal) candidates.push(proposal);
    }
  } else {
    // OPEN bills/purchases: pending / partially-paid, not deleted, tenant-scoped.
    const purchases = (await tx.purchase.findMany({
      where: {
        userId,
        isDeleted: false,
        status: { in: ['pending', 'partially_paid', 'new'] },
      },
      include: { supplier: true, contact: true },
    })) as Record<string, unknown>[];

    for (const pur of purchases) {
      // Score against the OUTSTANDING balance when present (a part-paid bill is
      // settled by its remaining balance), else the total.
      const balance = pur.balanceAmount != null ? Number(pur.balanceAmount) : Number(pur.totalAmount);
      const proposal = scoreDoc({
        doc: pur,
        amount: balance,
        docDate: (pur.purchaseDate as Date | undefined) ?? date,
        docReference: String(pur.referenceNo ?? ''),
        txnAmount: amount,
        txnDate: date,
        txnReference: reference,
        payeeKey,
        hintBacks: false,
        transactionTypeKey: 'bill_payment',
        relatedType: 'PURCHASE',
        relatedId: String(pur.id),
        docNo: (pur.purchaseId as string | undefined) ?? null,
        labelPrefix: 'Bill',
      });
      if (proposal) candidates.push(proposal);
    }
  }

  // 3b. Hint-backed generic proposal (no document needed). Built when a hint
  // exists; for outbound this is the "expense-like" fallback (payment + learned
  // category). It always carries the learned type/category/payTo.
  if (hint) {
    const hintProposal: ProposedExplanation = {
      transactionTypeKey: hint.transactionTypeKey,
      categoryId: hint.categoryId,
      payToUserId: hint.payToUserId,
      score: HINT_BASE_SCORE,
      // A hint is a learned, user-confirmed mapping for this payee → trust it.
      confidence: 'AUTO',
      // Hint-backed → strongest "agreed" signal → auto-post eligible.
      autoPostEligible: true,
      label: hintLabel(hint.transactionTypeKey),
    };
    candidates.push(hintProposal);

    // If a document candidate shares the hint's transactionTypeKey, the hint
    // reinforces it: bump that doc's confidence to AUTO. A hint substitutes for a
    // party-name match (so it can lift eligibility without a party hit) but NEVER
    // for exact amount — only mark a hint-reinforced DOC auto-post eligible when it
    // matched the amount EXACTLY, so a wrong-amount receipt can't auto-post as a
    // partial payment. (A pure hint-backed generic proposal with no doc stays
    // eligible — that's the "you taught this payee" case.)
    for (const c of candidates) {
      if (c.relatedId && c.transactionTypeKey === hint.transactionTypeKey) {
        c.confidence = 'AUTO';
        if (c.exactAmount === true) c.autoPostEligible = true;
        c.score += PARTY_BONUS; // hint reinforcement, same weight as a party hit
      }
    }
  }

  // 5. Rank by score (desc); best = top candidate that clears the threshold.
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.length > 0 && candidates[0].score >= MATCH_THRESHOLD ? candidates[0] : undefined;

  return { candidates, best };
}

// ---------------------------------------------------------------------------
// scoreDoc — score one document candidate via the shared matcher + party bonus
// ---------------------------------------------------------------------------

function scoreDoc(p: {
  doc: Record<string, unknown>;
  amount: number;
  docDate: Date;
  docReference: string;
  txnAmount: number;
  txnDate: Date;
  txnReference: string;
  payeeKey: string;
  hintBacks: boolean;
  transactionTypeKey: string;
  relatedType: string;
  relatedId: string;
  docNo: string | null;
  labelPrefix: string;
}): ProposedExplanation | null {
  const candidate: MatchCandidate = {
    id: p.relatedId,
    // kind is unused by our consumer; tag by direction for completeness.
    kind: p.transactionTypeKey === 'invoice_receipt' ? 'INVOICE_PAYMENT' : 'SUPPLIER_PAYMENT',
    amount: p.amount,
    date: p.docDate,
    reference: p.docReference,
    parentLabel: p.docNo ?? '',
  };

  const scored = matchBankTransaction({
    txnAmount: p.txnAmount,
    txnDate: p.txnDate,
    txnReference: p.txnReference,
    candidates: [candidate],
  });
  // matchBankTransaction filters < 50 out; below threshold → not a candidate.
  if (scored.length === 0) return null;

  const base = scored[0];
  const exactAmount = base.reasons.includes('exact amount');
  const referenceMatch = base.reasons.includes('reference match');

  const partyName = partyNameOf(p.doc);
  const party = partyMatches(p.payeeKey, partyName);

  let score = base.score;
  if (party) score += PARTY_BONUS;

  // AUTO when (exact amount) AND (party OR reference OR a hint backs it); else SUGGEST.
  const confidence: 'AUTO' | 'SUGGEST' =
    exactAmount && (party || referenceMatch || p.hintBacks) ? 'AUTO' : 'SUGGEST';

  // Auto-post eligibility for a DOCUMENT match: only the strong "agreed" combo of
  // EXACT amount AND a party-name match. (A hint reinforcing this candidate can
  // still flip it eligible later — see the hint loop in autoMatch.) A match that
  // is merely exact-amount + reference is AUTO but NOT auto-post eligible.
  const autoPostEligible = confidence === 'AUTO' && exactAmount && party;

  const label = p.docNo
    ? `${p.labelPrefix} ${p.docNo}${partyName ? ` — ${partyName}` : ''}`
    : `${p.labelPrefix}${partyName ? ` — ${partyName}` : ''}`;

  return {
    transactionTypeKey: p.transactionTypeKey,
    relatedType: p.relatedType,
    relatedId: p.relatedId,
    partyName: partyName ?? undefined,
    score,
    confidence,
    autoPostEligible,
    exactAmount,
    label,
  };
}

function hintLabel(transactionTypeKey: string): string {
  switch (transactionTypeKey) {
    case 'payment':
      return 'Payment (learned category)';
    case 'invoice_receipt':
      return 'Invoice receipt (learned)';
    case 'bill_payment':
      return 'Bill payment (learned)';
    default:
      return `${transactionTypeKey} (learned)`;
  }
}

// CommonJS interop for any legacy JS consumers.
module.exports = { autoMatch };
module.exports.autoMatch = autoMatch;
