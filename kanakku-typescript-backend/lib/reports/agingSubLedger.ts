// lib/reports/agingSubLedger.ts
//
// GL-derived AR/AP aging sub-ledger loaders.
//
// The aging report is reconstructed from the journal lines posted to the AR /
// AP control account so its grand total equals the GL control balance BY
// CONSTRUCTION (the Balance-Sheet AR / AP figure is the same `Σ baseDebit −
// Σ baseCredit` over the same account). This handles credit/debit notes on
// already-paid invoices, partial payments, and over-credits — cases the legacy
// "open invoice − payments − CN.totalAmount" netting silently dropped or
// mis-netted (CN.totalAmount includes tax; the AR leg moved only ex-tax).
//
// Source-document attribution (JournalEntry.sourceType / sourceId):
//   AR control (roleKey 'AR'):
//     Invoice/issued          Dr AR   sourceId = invoiceId
//     InvoicePayment/payment  Cr AR   sourceId = paymentId   → invoiceId
//     CreditNote/issued       Cr AR   sourceId = creditNoteId→ invoiceId
//     CreditNote/refund       Dr AR   sourceId = creditNoteId→ invoiceId
//   AP control (roleKey 'AP'):
//     Purchase/received       Cr AP   sourceId = purchaseId
//     SupplierPayment/payment Dr AP   sourceId = paymentId   → purchaseId
//     DebitNote/issued        Dr AP   sourceId = debitNoteId → purchaseId
// Anything else (Cutover opening, manual JEs, bank-txn links) is unattributed
// and collapses into one "Unapplied / opening" row so the total still ties out.

import type { PrismaClient } from '@prisma/client';
import { resolveDisplayName } from '../contacts/contactIdentity';
import type { SubLedgerDoc, SubLedgerLine } from './aging';

/** The Prisma client slice the loaders use. Typed as the concrete client so the
 *  generated delegate types satisfy it; the pure aging math lives in aging.ts
 *  and is unit-tested independently of Prisma. */
export type AgingPrisma = Pick<
  PrismaClient,
  | 'ledgerAccountMapping'
  | 'journalLine'
  | 'invoice'
  | 'invoicePayment'
  | 'creditNote'
  | 'purchase'
  | 'supplierPayment'
  | 'debitNote'
>;

export interface SubLedgerData {
  /** Whether a control-account mapping exists (false → caller should fall back). */
  available: boolean;
  lines: SubLedgerLine[];
  docs: Map<string, SubLedgerDoc>;
}

async function controlAccountId(tx: AgingPrisma, userId: string, roleKey: 'AR' | 'AP'): Promise<string | null> {
  const m = await tx.ledgerAccountMapping.findFirst({ where: { userId, roleKey }, select: { accountId: true } });
  return m?.accountId ?? null;
}

async function controlLines(tx: AgingPrisma, userId: string, accountId: string, asOf: Date) {
  const rows = await tx.journalLine.findMany({
    where: { accountId, journalEntry: { userId, isDeleted: false, entryDate: { lte: asOf } } },
    select: {
      baseDebit: true,
      baseCredit: true,
      journalEntry: { select: { sourceType: true, sourceId: true } },
    },
  });
  return rows.map((r) => ({
    baseDebit: r.baseDebit,
    baseCredit: r.baseCredit,
    sourceType: r.journalEntry.sourceType,
    sourceId: r.journalEntry.sourceId,
  }));
}

/**
 * Load the AR control sub-ledger: every journal line on the AR account, each
 * attributed to its source invoice (resolving payment/credit-note ids back to
 * the invoice they settle), plus per-invoice labels and due dates.
 */
export async function loadArSubLedger(tx: AgingPrisma, userId: string, asOf: Date): Promise<SubLedgerData> {
  const accountId = await controlAccountId(tx, userId, 'AR');
  if (!accountId) return { available: false, lines: [], docs: new Map() };

  const raw = await controlLines(tx, userId, accountId, asOf);

  // Resolve the source ids that are NOT themselves invoice ids back to invoices.
  const paymentIds = raw.filter((l) => l.sourceType === 'InvoicePayment' && l.sourceId).map((l) => l.sourceId!);
  const creditNoteIds = raw.filter((l) => l.sourceType === 'CreditNote' && l.sourceId).map((l) => l.sourceId!);

  const [payments, creditNotes] = await Promise.all([
    paymentIds.length
      ? tx.invoicePayment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, invoiceId: true } })
      : Promise.resolve([] as { id: string; invoiceId: string }[]),
    creditNoteIds.length
      ? tx.creditNote.findMany({ where: { id: { in: creditNoteIds } }, select: { id: true, invoiceId: true } })
      : Promise.resolve([] as { id: string; invoiceId: string }[]),
  ]);
  const paymentToInvoice = new Map(payments.map((p) => [p.id, p.invoiceId]));
  const creditNoteToInvoice = new Map(creditNotes.map((c) => [c.id, c.invoiceId]));

  const resolveInvoiceId = (l: { sourceType: string | null; sourceId: string | null }): string | null => {
    if (!l.sourceId) return null;
    switch (l.sourceType) {
      case 'Invoice':
        return l.sourceId;
      case 'InvoicePayment':
        return paymentToInvoice.get(l.sourceId) ?? null;
      case 'CreditNote':
        return creditNoteToInvoice.get(l.sourceId) ?? null;
      default:
        return null; // Cutover opening, manual JE, bank-txn link → unapplied
    }
  };

  const lines: SubLedgerLine[] = raw.map((l) => ({
    bucketKey: resolveInvoiceId(l),
    baseDebit: l.baseDebit,
    baseCredit: l.baseCredit,
  }));

  // Labels + due dates for every invoice referenced by the AR lines.
  const invoiceIds = [...new Set(lines.map((l) => l.bucketKey).filter((k): k is string => !!k))];
  const invoices = invoiceIds.length
    ? await tx.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, customer: { select: { name: true } } },
      })
    : [];
  const docs = new Map<string, SubLedgerDoc>();
  for (const inv of invoices) {
    docs.set(inv.id, {
      label: `${inv.invoiceNumber ?? inv.id} / ${inv.customer?.name ?? ''}`.trim(),
      dueDate: inv.dueDate ?? inv.invoiceDate,
    });
  }

  return { available: true, lines, docs };
}

/**
 * Load the AP control sub-ledger: every journal line on the AP account,
 * attributed to its source purchase (resolving supplier-payment/debit-note ids
 * back to the purchase they settle), plus per-purchase labels and due dates.
 */
export async function loadApSubLedger(tx: AgingPrisma, userId: string, asOf: Date): Promise<SubLedgerData> {
  const accountId = await controlAccountId(tx, userId, 'AP');
  if (!accountId) return { available: false, lines: [], docs: new Map() };

  const raw = await controlLines(tx, userId, accountId, asOf);

  const paymentIds = raw.filter((l) => l.sourceType === 'SupplierPayment' && l.sourceId).map((l) => l.sourceId!);
  const debitNoteIds = raw.filter((l) => l.sourceType === 'DebitNote' && l.sourceId).map((l) => l.sourceId!);

  const [payments, debitNotes] = await Promise.all([
    paymentIds.length
      ? tx.supplierPayment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, purchaseId: true } })
      : Promise.resolve([] as { id: string; purchaseId: string }[]),
    debitNoteIds.length
      ? tx.debitNote.findMany({ where: { id: { in: debitNoteIds } }, select: { id: true, purchaseId: true } })
      : Promise.resolve([] as { id: string; purchaseId: string }[]),
  ]);
  const paymentToPurchase = new Map(payments.map((p) => [p.id, p.purchaseId]));
  const debitNoteToPurchase = new Map(debitNotes.map((d) => [d.id, d.purchaseId]));

  const resolvePurchaseId = (l: { sourceType: string | null; sourceId: string | null }): string | null => {
    if (!l.sourceId) return null;
    switch (l.sourceType) {
      case 'Purchase':
        return l.sourceId;
      case 'SupplierPayment':
        return paymentToPurchase.get(l.sourceId) ?? null;
      case 'DebitNote':
        return debitNoteToPurchase.get(l.sourceId) ?? null;
      default:
        return null;
    }
  };

  const lines: SubLedgerLine[] = raw.map((l) => ({
    bucketKey: resolvePurchaseId(l),
    baseDebit: l.baseDebit,
    baseCredit: l.baseCredit,
  }));

  const purchaseIds = [...new Set(lines.map((l) => l.bucketKey).filter((k): k is string => !!k))];
  const purchases = purchaseIds.length
    ? await tx.purchase.findMany({
        where: { id: { in: purchaseIds } },
        select: {
          id: true,
          purchaseId: true,
          dueDate: true,
          contact: { select: { firstName: true, lastName: true, organisation: true } },
          billFromUser: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const docs = new Map<string, SubLedgerDoc>();
  for (const p of purchases) {
    const supplierName = p.contact
      ? resolveDisplayName(p.contact)
      : `${p.billFromUser?.firstName ?? ''} ${p.billFromUser?.lastName ?? ''}`.trim();
    docs.set(p.id, {
      label: `${p.purchaseId ?? p.id} / ${supplierName}`.trim(),
      dueDate: p.dueDate,
    });
  }

  return { available: true, lines, docs };
}
