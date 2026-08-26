// controllers/agingController.ts
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import {
  bucketAging,
  buildSubLedgerAging,
  creditNoteTotalsByInvoice,
  netInvoiceOutstanding,
  type AgingItem,
  type AgingResult,
} from '../lib/reports/aging';
import { loadArSubLedger, loadApSubLedger } from '../lib/reports/agingSubLedger';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';
import { parseAsOf } from '../lib/reports/asOf';

// =============================================================================
// Helpers
// =============================================================================

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

/** When the GL ledger is live, aging is derived from the control account so it
 *  reconciles to the Balance Sheet by construction. */
async function ledgerLive(userId: string): Promise<boolean> {
  const s = await prisma.companySettings.findFirst({
    where: { userId },
    select: { ledgerInitialized: true },
  });
  return !!s?.ledgerInitialized;
}

function agingResponse(asOf: Date, result: AgingResult): Record<string, unknown> {
  return {
    asOf: asOf.toISOString(),
    buckets: {
      current: Number(result.buckets.current),
      d1_30: Number(result.buckets.d1_30),
      d31_60: Number(result.buckets.d31_60),
      d61_90: Number(result.buckets.d61_90),
      d90plus: Number(result.buckets.d90plus),
    },
    total: Number(result.total),
    rows: result.rows.map((r) => ({
      id: r.id,
      label: r.label,
      amount: Number(r.amount),
      dueDate: r.dueDate.toISOString(),
      daysOverdue: r.daysOverdue,
      bucket: r.bucket,
    })),
  };
}

// =============================================================================
// arAging — GET /reports/ar-aging?asOf=
// =============================================================================

export async function arAging(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const asOf = parseAsOf(req.query.asOf);

    // GL-derived path: reconstruct aging from the AR control sub-ledger so the
    // grand total equals the Balance-Sheet AR control balance BY CONSTRUCTION.
    // This handles credit notes on already-paid invoices and over-credits (which
    // the legacy open-invoice netting drops), and nets by the actual AR leg (ex-
    // tax) rather than CN.totalAmount.
    if (await ledgerLive(userId)) {
      const sub = await loadArSubLedger(prisma, userId, asOf);
      if (sub.available) {
        const result = buildSubLedgerAging(sub.lines, asOf, {
          nature: 'debit',
          docs: sub.docs,
          unappliedLabel: 'Unapplied credits / opening balance',
        });
        res.json({ success: true, data: agingResponse(asOf, result) });
        return;
      }
    }

    // Legacy sub-ledger fallback (pre-ledger installs): open invoices minus
    // payments minus per-invoice credit-note totals — all computed AS-OF the
    // report date, not "now". Sources are point-in-time filtered:
    //  - invoiceDate <= asOf        → an invoice raised after asOf is absent
    //  - payments received_on <= asOf → a payment after asOf can't reduce the balance
    //  - credit notes creditNoteDate <= asOf
    // Status is NOT gated on the current value (a now-PAID invoice may have been
    // fully outstanding at asOf); we only drop DRAFT (never a receivable) and
    // CANCELLED (reversed), then keep rows whose as-of outstanding is positive.
    const invoices = await prisma.invoice.findMany({
      where: {
        userId,
        isDeleted: false,
        invoiceType: 'INVOICE',
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        invoiceDate: { lte: asOf },
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        TotalAmount: true,
        customer: { select: { name: true } },
        // Contact-first party resolution (matches apAging/getPurchaseReport):
        // invoices created via the unified-contact flow have contactId set but
        // a null legacy `customer`, so reading only `customer` left the label
        // blank and the UI rendered "Deleted User".
        contact: {
          select: { id: true, firstName: true, lastName: true, organisation: true },
        },
        payments: { where: { isVoided: false, received_on: { lte: asOf } }, select: { amount: true } },
      },
    });

    // Net credit notes against the invoices they relate to. A credit note posts
    // Cr Accounts Receivable for its totalAmount (postCreditNoteIssued), so the
    // GL AR control is already reduced by every posted CN. Computing outstanding
    // as TotalAmount − payments ignored this, over-stating AR by exactly the CN
    // total. Subtract per-invoice CN totals so AR aging reconciles to the GL AR
    // control account. Each CN is counted once (keyed by its linked invoiceId).
    const invoiceIds = invoices.map((inv) => inv.id);
    const creditNoteByInvoice =
      invoiceIds.length > 0
        ? creditNoteTotalsByInvoice(
            await prisma.creditNote.findMany({
              where: { userId, isDeleted: false, invoiceId: { in: invoiceIds }, creditNoteDate: { lte: asOf } },
              select: { invoiceId: true, totalAmount: true },
            }),
          )
        : new Map<string, Prisma.Decimal>();

    const items: AgingItem[] = [];
    for (const inv of invoices) {
      // Compute outstanding = TotalAmount − Σ payments.amount − Σ credit notes
      const totalPaid = inv.payments.reduce(
        (acc, p) => acc.add(new Prisma.Decimal(p.amount.toString())),
        new Prisma.Decimal(0),
      );
      const creditNoted = creditNoteByInvoice.get(inv.id) ?? new Prisma.Decimal(0);
      const outstanding = netInvoiceOutstanding(inv.TotalAmount, totalPaid, creditNoted);
      if (outstanding.lte(0)) continue;

      const dueDate = inv.dueDate ?? inv.invoiceDate;
      const partyName = (inv.contact ? resolveDisplayName(inv.contact) : '') || inv.customer?.name || '';
      const label = `${inv.invoiceNumber ?? inv.id} / ${partyName}`.trim();

      items.push({
        id: inv.id,
        label,
        amount: outstanding.toString(),
        dueDate,
      });
    }

    const result = bucketAging(items, asOf);

    res.json({ success: true, data: agingResponse(asOf, result) });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching AR aging:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch AR aging report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// apAging — GET /reports/ap-aging?asOf=
// =============================================================================

export async function apAging(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const asOf = parseAsOf(req.query.asOf);

    // GL-derived path: reconstruct from the AP control sub-ledger so the grand
    // total equals the Balance-Sheet AP control balance BY CONSTRUCTION. Handles
    // debit notes (the AP analog of credit notes) on already-paid purchases.
    if (await ledgerLive(userId)) {
      const sub = await loadApSubLedger(prisma, userId, asOf);
      if (sub.available) {
        const result = buildSubLedgerAging(sub.lines, asOf, {
          nature: 'credit',
          docs: sub.docs,
          unappliedLabel: 'Unapplied debits / opening balance',
        });
        res.json({ success: true, data: agingResponse(asOf, result) });
        return;
      }
    }

    // Legacy sub-ledger fallback (pre-ledger installs): purchases outstanding
    // AS-OF the report date. purchaseDate <= asOf excludes bills entered later;
    // the current balanceAmount is made point-in-time by ADDING BACK supplier
    // payments made after asOf (so a bill settled after asOf still shows open).
    // balanceAmount = totalAmount − Σ payments, so balance-at-asOf = current
    // balance + Σ (payments with paymentDate > asOf). Cancelled bills excluded.
    const purchases = await prisma.purchase.findMany({
      where: {
        userId,
        isDeleted: false,
        status: { not: 'cancelled' },
        purchaseDate: { lte: asOf },
      },
      select: {
        id: true,
        purchaseId: true,
        dueDate: true,
        balanceAmount: true,
        // Contact-first party resolution (post vendor->Supplier->Contact
        // migration). Falls back to the legacy User relation when the
        // purchase predates the migration.
        contact: { select: { firstName: true, lastName: true, organisation: true } },
        billFromUser: { select: { firstName: true, lastName: true } },
        supplierPayments: {
          where: { isVoided: false, paymentDate: { gt: asOf } },
          select: { amount: true },
        },
      },
    });

    const items: AgingItem[] = [];
    for (const p of purchases) {
      const laterPaid = p.supplierPayments.reduce(
        (acc, sp) => acc.add(new Prisma.Decimal(sp.amount.toString())),
        new Prisma.Decimal(0),
      );
      const outstanding = new Prisma.Decimal(p.balanceAmount.toString()).add(laterPaid);
      if (outstanding.lte(0)) continue;

      const supplierName = p.contact
        ? resolveDisplayName(p.contact)
        : `${p.billFromUser?.firstName ?? ''} ${p.billFromUser?.lastName ?? ''}`.trim();
      const label = `${p.purchaseId ?? p.id} / ${supplierName}`.trim();
      items.push({
        id: p.id,
        label,
        amount: outstanding.toString(),
        dueDate: p.dueDate,
      });
    }

    const result = bucketAging(items, asOf);

    res.json({ success: true, data: agingResponse(asOf, result) });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching AP aging:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch AP aging report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// collections (dunning) — GET /reports/collections?asOf=
// =============================================================================

const DUNNING_STAGE: Record<string, string> = {
  d1_30: 'reminder',
  d31_60: 'first_notice',
  d61_90: 'second_notice',
  d90plus: 'final_notice',
};

export async function collections(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const asOf = parseAsOf(req.query.asOf);

    // Same source + point-in-time filtering as arAging (open invoices minus
    // as-of payments minus as-of credit notes; DRAFT/CANCELLED excluded).
    const invoices = await prisma.invoice.findMany({
      where: {
        userId,
        isDeleted: false,
        invoiceType: 'INVOICE',
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        invoiceDate: { lte: asOf },
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        TotalAmount: true,
        customer: { select: { name: true } },
        // Contact-first party resolution (see arAging).
        contact: {
          select: { id: true, firstName: true, lastName: true, organisation: true },
        },
        payments: { where: { isVoided: false, received_on: { lte: asOf } }, select: { amount: true } },
      },
    });

    // Net credit notes against linked invoices (same reconciliation as arAging).
    const invoiceIds = invoices.map((inv) => inv.id);
    const creditNoteByInvoice =
      invoiceIds.length > 0
        ? creditNoteTotalsByInvoice(
            await prisma.creditNote.findMany({
              where: { userId, isDeleted: false, invoiceId: { in: invoiceIds }, creditNoteDate: { lte: asOf } },
              select: { invoiceId: true, totalAmount: true },
            }),
          )
        : new Map<string, Prisma.Decimal>();

    const items: AgingItem[] = [];
    for (const inv of invoices) {
      const totalPaid = inv.payments.reduce(
        (acc, p) => acc.add(new Prisma.Decimal(p.amount.toString())),
        new Prisma.Decimal(0),
      );
      const creditNoted = creditNoteByInvoice.get(inv.id) ?? new Prisma.Decimal(0);
      const outstanding = netInvoiceOutstanding(inv.TotalAmount, totalPaid, creditNoted);
      if (outstanding.lte(0)) continue;

      const dueDate = inv.dueDate ?? inv.invoiceDate;
      const partyName = (inv.contact ? resolveDisplayName(inv.contact) : '') || inv.customer?.name || '';
      const label = `${inv.invoiceNumber ?? inv.id} / ${partyName}`.trim();

      items.push({
        id: inv.id,
        label,
        amount: outstanding.toString(),
        dueDate,
      });
    }

    const result = bucketAging(items, asOf);

    // Filter to overdue only and add dunning stage
    const overdueRows = result.rows
      .filter((r) => r.daysOverdue > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map((r) => ({
        id: r.id,
        label: r.label,
        amount: r.amount,
        dueDate: r.dueDate.toISOString(),
        daysOverdue: r.daysOverdue,
        bucket: r.bucket,
        dunningStage: DUNNING_STAGE[r.bucket] ?? 'reminder',
      }));

    res.json({
      success: true,
      data: {
        asOf: asOf.toISOString(),
        buckets: {
          d1_30: result.buckets.d1_30.toString(),
          d31_60: result.buckets.d31_60.toString(),
          d61_90: result.buckets.d61_90.toString(),
          d90plus: result.buckets.d90plus.toString(),
        },
        total: result.total.sub(result.buckets.current).toString(),
        rows: overdueRows,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching collections report:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch collections report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
