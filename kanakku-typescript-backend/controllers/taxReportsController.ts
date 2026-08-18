import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { getGstSummary } from '../lib/financialQueries';

function defaultMonthRange(req: Request): { fromDate: Date; toDate: Date } {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const toDate = to ? new Date(to) : new Date();
  // Default: current month
  const fromDate = from ? new Date(from) : new Date(toDate.getFullYear(), toDate.getMonth(), 1);
  toDate.setHours(23, 59, 59, 999);
  fromDate.setHours(0, 0, 0, 0);
  return { fromDate, toDate };
}

interface ItemTaxLine {
  taxRateId?: string;
  name?: string;
  kind?: string | null;
  percent?: number;
  amount?: number;
}

interface InvoiceItem {
  qty?: number;
  rate?: number;
  taxes?: ItemTaxLine[];
  totalTax?: number;
}

/** Non-DRAFT/CANCELLED sale statuses that contribute output tax. Mirrors the
 *  P&L / getGstSummary status filter so every GST report scopes supplies the
 *  same way (a draft is not a supply; a cancelled invoice was reversed). */
const OUTWARD_INVOICE_STATUSES = ['UNPAID', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'SENT'] as const;

interface GstKindTotals {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

/**
 * Decompose one document's item-level taxes into GST kinds. When the line items
 * carry no decomposable GST (empty/legacy items) but the document has a `vat`
 * total, fall back to treating it as IGST — the same fallback GSTR-1 has always
 * applied, now shared so GSTR-3B matches GSTR-1 exactly.
 */
function decomposeGstKinds(items: InvoiceItem[] | null | undefined, vatFallback: number): GstKindTotals {
  let cgst = 0, sgst = 0, igst = 0, cess = 0;
  for (const item of items ?? []) {
    for (const t of item.taxes ?? []) {
      const amt = Number(t.amount ?? 0);
      if (t.kind === 'CGST') cgst += amt;
      else if (t.kind === 'SGST' || t.kind === 'UTGST') sgst += amt;
      else if (t.kind === 'IGST') igst += amt;
      else if (t.kind === 'CESS') cess += amt;
    }
  }
  if (cgst === 0 && sgst === 0 && igst === 0 && vatFallback) {
    igst = vatFallback; // can't decompose → treat whole vat as IGST
  }
  return { cgst, sgst, igst, cess };
}

interface CreditNoteGstTotals extends GstKindTotals {
  taxableValue: number;
}

/**
 * Period total of non-cancelled sales credit notes (CDNR), decomposed into GST
 * kinds with the same vat fallback as invoices. These reduce output tax: a
 * credit note reverses the output GST originally charged, so the period's net
 * outward tax must subtract it or the filing over-states tax owed.
 */
async function creditNoteGstTotals(userId: string, fromDate: Date, toDate: Date): Promise<CreditNoteGstTotals> {
  const creditNotes = await prisma.creditNote.findMany({
    where: {
      userId,
      isDeleted: false,
      status: { not: 'CANCELLED' },
      creditNoteDate: { gte: fromDate, lte: toDate },
    },
    select: { items: true, vat: true, taxableAmount: true },
  });
  const totals: CreditNoteGstTotals = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
  for (const cn of creditNotes) {
    totals.taxableValue += Number(cn.taxableAmount ?? 0);
    const k = decomposeGstKinds(cn.items as unknown as InvoiceItem[] | null, Number(cn.vat ?? 0));
    totals.cgst += k.cgst;
    totals.sgst += k.sgst;
    totals.igst += k.igst;
    totals.cess += k.cess;
  }
  return totals;
}

/**
 * GET /api/admin/reports/tax-summary?from=&to=&regime=
 */
export async function taxSummary(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromDate, toDate } = defaultMonthRange(req);

    // Shared with the AI co-pilot's get_gst_summary tool via
    // lib/financialQueries so the human report and the AI answer agree.
    const gst = await getGstSummary(userId, fromDate, toDate);

    res.json({
      success: true,
      data: {
        period: { from: gst.from, to: gst.to },
        outwardTaxes: { ...gst.outwardByKind, TOTAL: gst.outwardTotal },
        inwardTaxes: { ...gst.inwardByKind, TOTAL: gst.inwardTotal },
        netTaxLiability: { ...gst.netByKind, TOTAL: gst.netTotal },
        reverseCharge: gst.reverseCharge,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('taxSummary error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute tax summary' });
  }
}

/**
 * GET /api/admin/reports/gstr-1?from=&to=
 * GSTR-1: outward supplies summary. B2B = customers with GSTIN; B2C = everyone else.
 */
export async function gstr1(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromDate, toDate } = defaultMonthRange(req);

    const invoices = await prisma.invoice.findMany({
      where: {
        userId,
        isDeleted: false,
        invoiceType: 'INVOICE',
        invoiceDate: { gte: fromDate, lte: toDate },
        status: { in: [...OUTWARD_INVOICE_STATUSES] },
      },
      include: {
        billToCustomer: { select: { id: true, name: true, gstin: true, billingAddress: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    interface B2BRow {
      gstin: string;
      customerName: string;
      invoiceNumber: string | null;
      date: Date;
      taxableValue: number;
      igst: number;
      cgst: number;
      sgst: number;
      cess: number;
      total: number;
    }
    const b2b: B2BRow[] = [];
    interface B2CBucket {
      placeOfSupply: string;
      invoiceCount: number;
      taxableValue: number;
      tax: number;
    }
    const b2cMap = new Map<string, B2CBucket>();

    let totalTaxableValue = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0, totalCess = 0;

    for (const inv of invoices) {
      const invTaxable = Number(inv.taxableAmount ?? 0);
      const { cgst: invCgst, sgst: invSgst, igst: invIgst, cess: invCess } = decomposeGstKinds(
        inv.items as unknown as InvoiceItem[] | null,
        Number(inv.vat ?? 0),
      );

      const gstin = inv.billToCustomer?.gstin?.trim();
      totalTaxableValue += invTaxable;
      totalCgst += invCgst;
      totalSgst += invSgst;
      totalIgst += invIgst;
      totalCess += invCess;

      if (gstin) {
        b2b.push({
          gstin,
          customerName: inv.billToCustomer?.name ?? '',
          invoiceNumber: inv.invoiceNumber,
          date: inv.invoiceDate,
          taxableValue: invTaxable,
          igst: invIgst,
          cgst: invCgst,
          sgst: invSgst,
          cess: invCess,
          total: invTaxable + invCgst + invSgst + invIgst + invCess,
        });
      } else {
        // B2C: bucket by place of supply (use customer.billingAddress.state or "Unknown")
        const addr = inv.billToCustomer?.billingAddress as { state?: string } | null;
        const place = addr?.state ?? 'Unknown';
        const cur = b2cMap.get(place);
        const tax = invCgst + invSgst + invIgst + invCess;
        if (cur) {
          cur.invoiceCount += 1;
          cur.taxableValue += invTaxable;
          cur.tax += tax;
        } else {
          b2cMap.set(place, { placeOfSupply: place, invoiceCount: 1, taxableValue: invTaxable, tax });
        }
      }
    }

    // Net non-cancelled credit notes (CDNR) out of the outward summary so the
    // period's net output tax + taxable value are correct. The B2B/B2C rows
    // remain gross of credit notes (there is no CDNR line section in this
    // response shape); the summary is the filing-relevant net-of-CN figure.
    const cn = await creditNoteGstTotals(userId, fromDate, toDate);
    totalTaxableValue -= cn.taxableValue;
    totalCgst -= cn.cgst;
    totalSgst -= cn.sgst;
    totalIgst -= cn.igst;
    totalCess -= cn.cess;

    res.json({
      success: true,
      data: {
        period: { from: fromDate, to: toDate },
        // NOTE: b2b/b2c below are gross of credit notes; summary (below) is
        // net of credit notes (see comment above `cn` computation). Do not
        // sum these line arrays and expect them to equal `summary` — that
        // asymmetry is intentional (filing net-of-CN belongs in the summary,
        // not the line items) until a dedicated CDNR section is added.
        b2b: b2b.sort((a, b) => a.date.getTime() - b.date.getTime()),
        b2c: Array.from(b2cMap.values()),
        summary: {
          totalInvoices: invoices.length,
          totalTaxableValue,
          totalCgst,
          totalSgst,
          totalIgst,
          totalCess,
          totalTax: totalCgst + totalSgst + totalIgst + totalCess,
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('gstr1 error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute GSTR-1' });
  }
}

/**
 * GET /api/admin/reports/gstr-3b?from=&to=
 */
export async function gstr3b(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromDate, toDate } = defaultMonthRange(req);

    // Outward: from invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        userId,
        isDeleted: false,
        invoiceType: 'INVOICE',
        invoiceDate: { gte: fromDate, lte: toDate },
        status: { in: [...OUTWARD_INVOICE_STATUSES] },
      },
      select: { items: true, vat: true, taxableAmount: true, billToCustomer: { select: { gstin: true, billingAddress: true } } },
    });

    let outwardTaxable = 0, outwardCgst = 0, outwardSgst = 0, outwardIgst = 0, outwardCess = 0;
    let interStateUnregistered = 0;

    for (const inv of invoices) {
      const taxable = Number(inv.taxableAmount ?? 0);
      outwardTaxable += taxable;
      // Same decomposition + vat→IGST fallback as GSTR-1, so the two filings
      // agree on the same period (GSTR-3B previously lacked the fallback).
      const k = decomposeGstKinds(inv.items as unknown as InvoiceItem[] | null, Number(inv.vat ?? 0));
      outwardCgst += k.cgst;
      outwardSgst += k.sgst;
      outwardIgst += k.igst;
      outwardCess += k.cess;

      // Inter-state to unregistered = customer has no GSTIN AND invoice has IGST
      if (!inv.billToCustomer?.gstin?.trim() && k.igst > 0) {
        interStateUnregistered += taxable;
      }
    }

    // Net non-cancelled credit notes (CDNR) out of outward supplies, matching
    // GSTR-1's net-of-CN summary so the two filings reconcile.
    const cn = await creditNoteGstTotals(userId, fromDate, toDate);
    outwardTaxable -= cn.taxableValue;
    outwardCgst -= cn.cgst;
    outwardSgst -= cn.sgst;
    outwardIgst -= cn.igst;
    outwardCess -= cn.cess;

    // Inward (ITC eligible): from purchases
    const purchases = await prisma.purchase.findMany({
      where: { userId, isDeleted: false, purchaseDate: { gte: fromDate, lte: toDate } },
      select: { items: true, taxableAmount: true, totalTax: true },
    });
    let inwardTaxable = 0, inwardCgst = 0, inwardSgst = 0, inwardIgst = 0, inwardCess = 0;
    for (const p of purchases) {
      const items = (p.items as unknown as InvoiceItem[] | null) ?? [];
      inwardTaxable += Number(p.taxableAmount ?? 0);
      for (const item of items) {
        const taxes = item.taxes ?? [];
        for (const t of taxes) {
          const amt = Number(t.amount ?? 0);
          if (t.kind === 'CGST') inwardCgst += amt;
          else if (t.kind === 'SGST' || t.kind === 'UTGST') inwardSgst += amt;
          else if (t.kind === 'IGST') inwardIgst += amt;
          else if (t.kind === 'CESS') inwardCess += amt;
        }
      }
    }

    const taxPayable = {
      cgst: Math.max(0, outwardCgst - inwardCgst),
      sgst: Math.max(0, outwardSgst - inwardSgst),
      igst: Math.max(0, outwardIgst - inwardIgst),
      cess: Math.max(0, outwardCess - inwardCess),
    };

    res.json({
      success: true,
      data: {
        period: { from: fromDate, to: toDate },
        '3.1_outwardSupplies': {
          taxableValue: outwardTaxable,
          cgst: outwardCgst,
          sgst: outwardSgst,
          igst: outwardIgst,
          cess: outwardCess,
        },
        '3.2_interStateUnregistered': {
          taxableValue: interStateUnregistered,
        },
        '4_itcEligible': {
          taxableValue: inwardTaxable,
          cgst: inwardCgst,
          sgst: inwardSgst,
          igst: inwardIgst,
          cess: inwardCess,
        },
        '6.1_taxPayable': taxPayable,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('gstr3b error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute GSTR-3B' });
  }
}

const handlers = { taxSummary, gstr1, gstr3b };
module.exports = handlers;
module.exports.default = handlers;
