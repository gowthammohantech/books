// controllers/taxReturnController.ts
//
// Country tax-return SUMMARY endpoints (Task 2): UK VAT 9-box, AU BAS (GST
// portion) and NZ GST. These are on-screen + CSV-exportable summaries of the
// official box/label values — NO live government e-filing.
//
// All figures are GL-derived via lib/reports/taxReturns.ts#loadTaxFigures, so a
// return reconciles to the Trial Balance movement on the tenant's tax accounts
// for the period. Money stays in Prisma.Decimal end-to-end (no float drift);
// each authority's rounding convention is applied at the very end.
//
// Period is `?from=&to=` (UTC date-only, inclusive). Every endpoint is gated by
// protect + requirePermission('accounting-reports','view') (wired in the route)
// and tenant-scoped via requireUserId (ownerId ?? id).

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import {
  loadTaxFigures,
  type TaxFigures,
  loadOssThreshold,
  resolveOssSupplierCountry,
  resolveOssDestination,
  isOssQualifyingSale,
  loadIso2ById,
  type OssInvoice,
} from '../lib/reports/taxReturns';
import { euStandardRate } from '../lib/euVat';
import { toCsv, type CsvColumn } from '../lib/export/csv';
import { prisma } from '../lib/prisma';

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

interface Period {
  from: Date;
  to: Date;
}

/** Thrown for a missing/invalid `from`/`to` so the handler can map it to 400. */
class BadPeriodError extends Error {}

/**
 * Parse a `YYYY-MM-DD` query param as a UTC date-only instant.
 *
 * - `from` anchors to 00:00:00.000Z of that day.
 * - `to`   anchors to 23:59:59.999Z of that day so the range is INCLUSIVE of the
 *   whole end day (loadTaxFigures filters entryDate with lte:to).
 *
 * Rejects anything that is not a strict `YYYY-MM-DD` calendar date.
 */
function parseDateParam(value: unknown, kind: 'from' | 'to'): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadPeriodError(`Query param "${kind}" is required as YYYY-MM-DD`);
  }
  const [y, m, d] = value.split('-').map(Number);
  // Build the UTC instant and verify the calendar round-trips (rejects 2026-02-30 etc).
  const ms =
    kind === 'from'
      ? Date.UTC(y, m - 1, d, 0, 0, 0, 0)
      : Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const date = new Date(ms);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new BadPeriodError(`Query param "${kind}" is not a valid YYYY-MM-DD date`);
  }
  return date;
}

/** Parse + validate the `?from=&to=` period; throws BadPeriodError on failure. */
function parsePeriod(req: Request): Period {
  const from = parseDateParam(req.query.from, 'from');
  const to = parseDateParam(req.query.to, 'to');
  if (from.getTime() > to.getTime()) {
    throw new BadPeriodError('Query param "from" must not be after "to"');
  }
  return { from, to };
}

/** The period echoed back in every response, as the UTC date-only strings. */
function periodPayload(p: Period): { from: string; to: string } {
  return {
    from: p.from.toISOString().slice(0, 10),
    to: p.to.toISOString().slice(0, 10),
  };
}

/** Round DOWN to a whole unit (HMRC boxes 6/7: report whole pounds, round down). */
function floorWhole(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR);
}

/** Round to 2dp (pence/cents) — HMRC box 5 + AU/NZ money values. */
function toMoney(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Send a CSV attachment built from `rows` (CSV-injection-safe via toCsv).
 * Mirrors exportController#sendCsv.
 */
function sendCsv(res: Response, filename: string, rows: Record<string, unknown>[], columns?: CsvColumn[]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows, columns));
}

/** Did the caller ask for CSV (via `?format=csv` or a `.csv` path)? */
function wantsCsv(req: Request): boolean {
  return req.query.format === 'csv' || req.path.endsWith('.csv');
}

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof BadPeriodError) {
    res.status(400).json({ success: false, message: err.message });
    return;
  }
  if (handleUnauthorized(res, err)) return;
  console.error(`Error building ${what}:`, err);
  res.status(500).json({
    success: false,
    message: `Failed to build ${what}`,
    error: err instanceof Error ? err.message : String(err),
  });
}

// =============================================================================
// Box builders — pure mapping from GL figures to each authority's labels.
// Exported so unit tests can assert the box mapping + rounding directly.
// =============================================================================

/**
 * UK VAT return — 9 boxes (HMRC).
 *  box1 = VAT due on sales (output tax)
 *  box2 = VAT due on EU acquisitions (0 — not tracked)
 *  box3 = total VAT due = box1 + box2
 *  box4 = VAT reclaimed on purchases (input tax)
 *  box5 = net VAT to pay/reclaim = |box3 − box4| (pence)
 *  box6 = total sales ex-VAT (whole £, round DOWN)
 *  box7 = total purchases ex-VAT (whole £, round DOWN)
 *  box8 = EU goods supplied (0)
 *  box9 = EU goods acquired (0)
 */
export function buildUkVatBoxes(f: TaxFigures): Record<string, string> {
  const box1 = toMoney(f.outputTax);
  const box2 = new Prisma.Decimal(0);
  const box3 = box1.plus(box2);
  const box4 = toMoney(f.inputTax);
  const box5 = box3.minus(box4).abs();
  const box6 = floorWhole(f.salesExTax);
  const box7 = floorWhole(f.purchasesExTax);
  const box8 = new Prisma.Decimal(0);
  const box9 = new Prisma.Decimal(0);
  return {
    box1: box1.toFixed(2),
    box2: box2.toFixed(2),
    box3: box3.toFixed(2),
    box4: box4.toFixed(2),
    box5: box5.toFixed(2),
    box6: box6.toFixed(0),
    box7: box7.toFixed(0),
    box8: box8.toFixed(0),
    box9: box9.toFixed(0),
  };
}

/**
 * AU BAS — GST portion.
 *  G1  = total sales (incl. GST)
 *  1A  = GST on sales (output tax)
 *  1B  = GST on purchases (input tax credits)
 *  netGst = 1A − 1B (positive = payable, negative = refund)
 */
export function buildAuBasBoxes(f: TaxFigures): Record<string, string> {
  const oneA = toMoney(f.outputTax);
  const oneB = toMoney(f.inputTax);
  return {
    G1: toMoney(f.salesInclTax).toFixed(2),
    '1A': oneA.toFixed(2),
    '1B': oneB.toFixed(2),
    netGst: oneA.minus(oneB).toFixed(2),
  };
}

/**
 * NZ GST return.
 *  totalSales     = sales incl. GST
 *  outputGst      = GST on sales (output tax)
 *  totalPurchases = purchases incl. GST
 *  inputGst       = GST on purchases (input tax credits)
 *  netGst         = outputGst − inputGst
 */
export function buildNzGstBoxes(f: TaxFigures): Record<string, string> {
  const outputGst = toMoney(f.outputTax);
  const inputGst = toMoney(f.inputTax);
  return {
    totalSales: toMoney(f.salesInclTax).toFixed(2),
    outputGst: outputGst.toFixed(2),
    totalPurchases: toMoney(f.purchasesInclTax).toFixed(2),
    inputGst: inputGst.toFixed(2),
    netGst: outputGst.minus(inputGst).toFixed(2),
  };
}

/**
 * EU VAT summary — member-state VAT return totals, GL-derived.
 *  outputVat      = VAT charged on sales (output tax)
 *  inputVat       = VAT reclaimable on purchases (input tax)
 *  netVat         = outputVat − inputVat (positive = payable, negative = refund)
 *  salesExTax     = total sales ex-VAT
 *  purchasesExTax = total purchases ex-VAT
 * All money to 2dp (cents) — Decimal throughout, no float drift.
 */
export function buildEuVatSummary(f: TaxFigures): Record<string, string> {
  const outputVat = toMoney(f.outputTax);
  const inputVat = toMoney(f.inputTax);
  return {
    outputVat: outputVat.toFixed(2),
    inputVat: inputVat.toFixed(2),
    netVat: outputVat.minus(inputVat).toFixed(2),
    salesExTax: toMoney(f.salesExTax).toFixed(2),
    purchasesExTax: toMoney(f.purchasesExTax).toFixed(2),
  };
}

/** Flatten a {label: value} box map to CSV rows of [{ box, value }]. */
function boxesToCsvRows(boxes: Record<string, string>): Record<string, unknown>[] {
  return Object.entries(boxes).map(([box, value]) => ({ box, value }));
}

const BOX_CSV_COLUMNS: CsvColumn[] = [
  { key: 'box', header: 'Box' },
  { key: 'value', header: 'Value' },
];

// =============================================================================
// Handlers
// =============================================================================

// GET /tax-returns/uk-vat[.csv]?from=&to=
export async function ukVatReturn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const period = parsePeriod(req);
    const figures = await loadTaxFigures(userId, period.from, period.to);
    const boxes = buildUkVatBoxes(figures);

    if (wantsCsv(req)) {
      sendCsv(res, 'uk-vat-return.csv', boxesToCsvRows(boxes), BOX_CSV_COLUMNS);
      return;
    }
    res.json({ success: true, data: { ...boxes, period: periodPayload(period) } });
  } catch (err) {
    handleError(res, err, 'UK VAT return');
  }
}

// GET /tax-returns/au-bas[.csv]?from=&to=
export async function auBasReturn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const period = parsePeriod(req);
    const figures = await loadTaxFigures(userId, period.from, period.to);
    const boxes = buildAuBasBoxes(figures);

    if (wantsCsv(req)) {
      sendCsv(res, 'au-bas-return.csv', boxesToCsvRows(boxes), BOX_CSV_COLUMNS);
      return;
    }
    res.json({ success: true, data: { ...boxes, period: periodPayload(period) } });
  } catch (err) {
    handleError(res, err, 'AU BAS return');
  }
}

// GET /tax-returns/nz-gst[.csv]?from=&to=
export async function nzGstReturn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const period = parsePeriod(req);
    const figures = await loadTaxFigures(userId, period.from, period.to);
    const boxes = buildNzGstBoxes(figures);

    if (wantsCsv(req)) {
      sendCsv(res, 'nz-gst-return.csv', boxesToCsvRows(boxes), BOX_CSV_COLUMNS);
      return;
    }
    res.json({ success: true, data: { ...boxes, period: periodPayload(period) } });
  } catch (err) {
    handleError(res, err, 'NZ GST return');
  }
}

// GET /tax-returns/eu-vat[.csv]?from=&to=
export async function euVatReturn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const period = parsePeriod(req);
    const figures = await loadTaxFigures(userId, period.from, period.to);
    const summary = buildEuVatSummary(figures);

    if (wantsCsv(req)) {
      sendCsv(res, 'eu-vat-return.csv', boxesToCsvRows(summary), BOX_CSV_COLUMNS);
      return;
    }
    res.json({ success: true, data: { ...summary, period: periodPayload(period) } });
  } catch (err) {
    handleError(res, err, 'EU VAT return');
  }
}

// =============================================================================
// EC Sales List — cross-border B2B reverse-charge SALES in the period.
// =============================================================================
//
// This is the ONE invoice-sourced piece of the tax-return suite (documented in
// the plan's Self-Review): the EC Sales List must report each EU customer's VAT
// number, which the GL does not carry, so it is built from the invoices flagged
// reverseCharge=true rather than from GL movements. Net value per row is the
// sum of each invoice's net (ex-tax) base — Invoice.taxableAmount.
//
// Customer VAT number + country are resolved from the invoice's BILLING contact
// when present and it carries a VAT number, otherwise from the primary linked
// Contact. For whichever contact is chosen we prefer the modern fields
// (Contact.vatNumber / Contact.country = ISO2) and fall back to the legacy fields
// (Contact.vatRegNumber / Contact.countryId → the Country.iso2 of that id).
// Invoices whose customer has no resolvable VAT number are still listed (with a
// blank VAT number) so the figure is never silently dropped — but they are
// grouped together by (vat, country).

/** The narrow Contact shape the EC list builder reads VAT#/country from. */
export interface EcSalesContact {
  vatNumber: string | null;
  vatRegNumber: string | null;
  country: string | null;
  countryId: string | null;
}

/** The narrow Invoice/Contact shape the EC list builder consumes. */
export interface EcSalesInvoice {
  taxableAmount: Prisma.Decimal;
  contact: EcSalesContact | null;
  billToContact?: EcSalesContact | null;
}

export interface EcSalesRow {
  customerVatNumber: string;
  country: string;
  netValue: string; // 2dp
  indicator: string;
}

export interface EcSalesList {
  rows: EcSalesRow[];
  total: string; // 2dp
}

/**
 * Goods vs services is not distinguishable from the current invoice model (no
 * supply-type flag per line/invoice), so every cross-border reverse-charge sale
 * is reported as a SERVICE supply by default. This is the safest constant for a
 * SaaS/services tenant; goods-trading tenants would refine it once a supply-type
 * field exists. Documented in the report + the plan's Self-Review.
 */
const EC_DEFAULT_INDICATOR = 'services';

/**
 * Build the EC Sales List from reverse-charge invoices, grouping by
 * (customerVatNumber, country). `iso2ById` maps a legacy Contact.countryId to a
 * Country.iso2 for the fallback path. Pure + Decimal-safe so it is unit-tested
 * directly. Rows are returned sorted by (country, VAT number) for stable CSV.
 */
export function buildEcSalesList(
  invoices: EcSalesInvoice[],
  iso2ById: Map<string, string>,
): EcSalesList {
  const groups = new Map<string, { vat: string; country: string; net: Prisma.Decimal }>();
  let total = new Prisma.Decimal(0);

  for (const inv of invoices) {
    // Prefer the billing contact when it carries a VAT number, else the primary.
    const billTo = inv.billToContact;
    const billToVat = (billTo?.vatNumber || billTo?.vatRegNumber || '').trim();
    const c = billToVat ? billTo : inv.contact;
    const vat = (c?.vatNumber || c?.vatRegNumber || '').trim();
    const country = (
      c?.country ||
      (c?.countryId ? iso2ById.get(c.countryId) : '') ||
      ''
    ).trim().toUpperCase();
    const net = new Prisma.Decimal(inv.taxableAmount ?? 0);

    const key = `${vat} ${country}`;
    const existing = groups.get(key);
    if (existing) {
      existing.net = existing.net.plus(net);
    } else {
      groups.set(key, { vat, country, net });
    }
    total = total.plus(net);
  }

  const rows: EcSalesRow[] = [...groups.values()]
    .sort((a, b) => a.country.localeCompare(b.country) || a.vat.localeCompare(b.vat))
    .map((g) => ({
      customerVatNumber: g.vat,
      country: g.country,
      netValue: g.net.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      indicator: EC_DEFAULT_INDICATOR,
    }));

  return { rows, total: total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) };
}

const EC_SALES_CSV_COLUMNS: CsvColumn[] = [
  { key: 'country', header: 'Country' },
  { key: 'customerVatNumber', header: 'Customer VAT Number' },
  { key: 'netValue', header: 'Net Value' },
  { key: 'indicator', header: 'Indicator' },
];

/**
 * Load the tenant's reverse-charge sales invoices in [from, to] (inclusive on
 * invoiceDate), tenant-scoped, with the contact fields needed to resolve the
 * customer VAT number + country. Then batch-resolve any legacy countryIds to
 * ISO2 and delegate to the pure builder.
 */
export async function loadEcSalesList(
  userId: string,
  from: Date,
  to: Date,
): Promise<EcSalesList> {
  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      isDeleted: false,
      reverseCharge: true,
      invoiceDate: { gte: from, lte: to },
    },
    select: {
      taxableAmount: true,
      contact: {
        select: {
          vatNumber: true,
          vatRegNumber: true,
          country: true,
          countryId: true,
        },
      },
      billToContact: {
        select: {
          vatNumber: true,
          vatRegNumber: true,
          country: true,
          countryId: true,
        },
      },
    },
  });

  // Batch-resolve the legacy countryId fallback path (only for contacts missing
  // the modern ISO2 `country` field), tenant-agnostic (Country is a shared ref
  // table). One query, deduped ids. Covers both the primary and billing contact
  // since either may be the chosen contact in the builder.
  const countryIds = [
    ...new Set(
      invoices
        .flatMap((i) => [i.contact, i.billToContact])
        .filter((c): c is NonNullable<typeof c> => !!c && !c.country && !!c.countryId)
        .map((c) => c.countryId as string),
    ),
  ];
  const iso2ById = new Map<string, string>();
  if (countryIds.length > 0) {
    const countries = await prisma.country.findMany({
      where: { id: { in: countryIds } },
      select: { id: true, iso2: true },
    });
    for (const co of countries) {
      if (co.iso2) iso2ById.set(co.id, co.iso2);
    }
  }

  return buildEcSalesList(invoices as EcSalesInvoice[], iso2ById);
}

// GET /tax-returns/eu-ec-sales-list[.csv]?from=&to=
export async function euEcSalesList(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const period = parsePeriod(req);
    const list = await loadEcSalesList(userId, period.from, period.to);

    if (wantsCsv(req)) {
      sendCsv(res, 'eu-ec-sales-list.csv', list.rows as unknown as Record<string, unknown>[], EC_SALES_CSV_COLUMNS);
      return;
    }
    res.json({
      success: true,
      data: { rows: list.rows, total: list.total, period: periodPayload(period) },
    });
  } catch (err) {
    handleError(res, err, 'EC Sales List');
  }
}

// =============================================================================
// EU OSS (One-Stop-Shop) return — B2C cross-border EU SALES per destination.
// =============================================================================
//
// The OSS return reports, per destination member state, the net value of B2C
// cross-border EU supplies in the period and the VAT due on them at that
// DESTINATION country's standard rate (the whole point of OSS: charge the
// customer's country rate, remit it via a single return).
//
// A sale qualifies (lib/reports/taxReturns#isOssQualifyingSale) when the tenant
// is an EU member, the customer is a DIFFERENT EU member, and it is B2C — NOT
// reverse-charge AND no valid customer VAT number. B2B reverse-charge supplies,
// domestic supplies, and non-EU customers are excluded. Like the EC Sales List,
// this is invoice-sourced (the GL does not carry per-destination splits).

export interface OssRow {
  country: string;
  rate: string; // destination standard rate, percent (e.g. "20")
  netValue: string; // 2dp
  vatDue: string; // 2dp = net × destRate
}

export interface OssReturn {
  rows: OssRow[];
  totals: { netValue: string; vatDue: string };
}

/**
 * Build the OSS return from the tenant's sales invoices: keep only qualifying
 * B2C cross-border EU supplies, group by destination country, and apply that
 * country's `euStandardRate` to the grouped net to get the VAT due. Pure +
 * Decimal-safe so it is unit-tested directly. Rows sorted by country for stable CSV.
 */
export function buildOssReturn(
  invoices: OssInvoice[],
  supplierCountry: string,
  iso2ById: Map<string, string>,
): OssReturn {
  const groups = new Map<string, { country: string; rate: number; net: Prisma.Decimal }>();

  for (const inv of invoices) {
    const dest = resolveOssDestination(inv, iso2ById);
    const qualifies = isOssQualifyingSale({
      supplierCountry,
      customerCountry: dest.customerCountry,
      reverseCharge: inv.reverseCharge === true,
      customerVatValid: dest.customerVatValid,
    });
    if (!qualifies) continue;

    const country = dest.customerCountry;
    const rate = euStandardRate(country) ?? 0; // qualifying ⇒ EU member ⇒ non-null
    const net = new Prisma.Decimal(inv.taxableAmount ?? 0);

    const existing = groups.get(country);
    if (existing) {
      existing.net = existing.net.plus(net);
    } else {
      groups.set(country, { country, rate, net });
    }
  }

  let totalNet = new Prisma.Decimal(0);
  let totalVat = new Prisma.Decimal(0);
  const rows: OssRow[] = [...groups.values()]
    .sort((a, b) => a.country.localeCompare(b.country))
    .map((g) => {
      const net = g.net.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const vat = g.net
        .times(g.rate)
        .dividedBy(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      totalNet = totalNet.plus(net);
      totalVat = totalVat.plus(vat);
      return {
        country: g.country,
        rate: new Prisma.Decimal(g.rate).toString(),
        netValue: net.toFixed(2),
        vatDue: vat.toFixed(2),
      };
    });

  return {
    rows,
    totals: { netValue: totalNet.toFixed(2), vatDue: totalVat.toFixed(2) },
  };
}

const OSS_CSV_COLUMNS: CsvColumn[] = [
  { key: 'country', header: 'Country' },
  { key: 'rate', header: 'Rate' },
  { key: 'netValue', header: 'Net Value' },
  { key: 'vatDue', header: 'VAT Due' },
];

/**
 * Load the tenant's sales invoices in [from, to] (inclusive on invoiceDate),
 * resolve the supplier (tenant) ISO-2 + each invoice's destination, then delegate
 * to the pure builder. Tenant-scoped.
 */
export async function loadOssReturn(userId: string, from: Date, to: Date): Promise<OssReturn> {
  const settings = await prisma.companySettings.findUnique({
    where: { userId },
    select: { countryCode: true, countryId: true, country: true },
  });
  const supplierCountry = await resolveOssSupplierCountry(prisma, settings);

  const invoices = (await prisma.invoice.findMany({
    where: { userId, isDeleted: false, invoiceDate: { gte: from, lte: to } },
    select: {
      taxableAmount: true,
      reverseCharge: true,
      contact: { select: { vatNumber: true, vatRegNumber: true, country: true, countryId: true } },
      billToContact: { select: { vatNumber: true, vatRegNumber: true, country: true, countryId: true } },
    },
  })) as OssInvoice[];

  const iso2ById = await loadIso2ById(prisma, invoices);
  return buildOssReturn(invoices, supplierCountry, iso2ById);
}

// GET /tax-returns/eu-oss[.csv]?from=&to=
export async function euOssReturn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const period = parsePeriod(req);
    const oss = await loadOssReturn(userId, period.from, period.to);

    if (wantsCsv(req)) {
      sendCsv(res, 'eu-oss-return.csv', oss.rows as unknown as Record<string, unknown>[], OSS_CSV_COLUMNS);
      return;
    }
    res.json({
      success: true,
      data: { rows: oss.rows, totals: oss.totals, period: periodPayload(period) },
    });
  } catch (err) {
    handleError(res, err, 'EU OSS return');
  }
}

/** Parse the `?year=` query param as a 4-digit calendar year; defaults to none. */
function parseYearParam(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) {
    throw new BadPeriodError('Query param "year" is required as YYYY');
  }
  return Number(value);
}

// GET /tax-returns/eu-oss/threshold?year=
export async function euOssThreshold(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const year = parseYearParam(req.query.year);
    const t = await loadOssThreshold(userId, year);
    res.json({
      success: true,
      data: {
        ytdB2cCrossBorder: t.ytdB2cCrossBorder.toFixed(2),
        threshold: t.threshold,
        exceeded: t.exceeded,
        year: t.year,
      },
    });
  } catch (err) {
    handleError(res, err, 'EU OSS threshold');
  }
}
