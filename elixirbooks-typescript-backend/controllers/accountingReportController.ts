import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import {
  tenantScope,
  requireUserId,
  UnauthorizedError,
} from '../lib/tenantScope';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';

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

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

const formatAmount = (amount: number): number => Number(amount.toFixed(2));

const calculateChange = (
  previous: number,
  current: number,
): { change: string; trend: string } => {
  if (previous === 0 && current === 0) return { change: '0.00', trend: 'equal' };
  if (previous === 0) return { change: '100.00', trend: 'up' };

  const change = (((current - previous) / previous) * 100).toFixed(2);
  let trend: string = 'equal';
  if (Number(change) > 0) trend = 'up';
  else if (Number(change) < 0) trend = 'down';

  return { change, trend };
};

interface InvoiceItem {
  amount?: number | string;
}

function sumInvoiceItems(items: Prisma.JsonValue | null | undefined): number {
  if (!Array.isArray(items)) return 0;
  return (items as InvoiceItem[]).reduce((acc, i) => acc + asNumber(i?.amount, 0), 0);
}

// =============================================================================
// getIncomeStats
// =============================================================================

export async function getIncomeStats(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      startDate,
      endDate,
      search,
    } = req.query as {
      page?: string;
      limit?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const now = new Date();
    // UTC-safe month boundaries (see lib/reports/asOf.ts header): building these from
    // local getFullYear()/getMonth()/setHours() shifts the cutoff by the server's UTC
    // offset on non-UTC hosts, so start/end must both be anchored via Date.UTC().
    const startOfCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfPreviousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const endOfPreviousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999),
    );

    // ===== Filters =====
    // Voided payments never count toward received-income totals or the report list.
    const baseFilter: Prisma.InvoicePaymentWhereInput = { isVoided: false, invoice: { userId } };
    const startD = parseDate(startDate);
    const endD = parseDate(endDate);
    if (startD && endD) {
      baseFilter.received_on = { gte: startD, lte: endD };
    }
    if (search) {
      baseFilter.OR = [
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { invoice: { referenceNo: { contains: search, mode: 'insensitive' } } },
        { invoice: { customer: { name: { contains: search, mode: 'insensitive' } } } },
        // Unified-contact-linked invoices carry the party under `contact`, not the
        // legacy `customer` — search those name parts too.
        { invoice: { contact: { organisation: { contains: search, mode: 'insensitive' } } } },
        { invoice: { contact: { firstName: { contains: search, mode: 'insensitive' } } } },
        { invoice: { contact: { lastName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const invoicePopulate = {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          referenceNo: true,
          items: true,
          customer: {
            select: { id: true, name: true, email: true, phone: true, image: true },
          },
          // Unified Contact links (contactId / billToContactId). Contact-linked
          // invoices leave the legacy `customer` null, so the party must resolve
          // from here first — see the contact-first resolution below.
          contact: {
            select: {
              id: true, firstName: true, lastName: true, organisation: true,
              email: true, mobile: true, telephone: true, image: true,
            },
          },
          billToContact: {
            select: {
              id: true, firstName: true, lastName: true, organisation: true,
              email: true, mobile: true, telephone: true, image: true,
            },
          },
        },
      },
      paymentMode: { select: { id: true, name: true, slug: true, status: true } },
    } as const;

    // ===== Queries =====
    const [currentPayments, previousPayments, allPayments, totalRecords] =
      await Promise.all([
        prisma.invoicePayment.findMany({
          where: { ...baseFilter, received_on: { gte: startOfCurrentMonth } },
          include: invoicePopulate,
        }),
        prisma.invoicePayment.findMany({
          where: {
            ...baseFilter,
            received_on: { gte: startOfPreviousMonth, lte: endOfPreviousMonth },
          },
          include: invoicePopulate,
        }),
        prisma.invoicePayment.findMany({
          where: baseFilter,
          include: invoicePopulate,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitN,
        }),
        prisma.invoicePayment.count({ where: baseFilter }),
      ]);

    // ===== Totals =====
    const currentTotal = currentPayments.reduce((sum, p) => sum + asNumber(p.amount, 0), 0);
    const previousTotal = previousPayments.reduce(
      (sum, p) => sum + asNumber(p.amount, 0),
      0,
    );

    const currentProductSales = currentPayments.reduce((sum, payment) => {
      if (!payment.invoice) return sum;
      return sum + sumInvoiceItems(payment.invoice.items);
    }, 0);

    const previousProductSales = previousPayments.reduce((sum, payment) => {
      if (!payment.invoice) return sum;
      return sum + sumInvoiceItems(payment.invoice.items);
    }, 0);

    const currentServiceRevenue = 0;
    const previousServiceRevenue = 0;
    const currentOtherRevenue = 0;
    const previousOtherRevenue = 0;

    const totalChange = calculateChange(previousTotal, currentTotal);
    const productChange = calculateChange(previousProductSales, currentProductSales);
    const serviceChange = calculateChange(previousServiceRevenue, currentServiceRevenue);
    const otherChange = calculateChange(previousOtherRevenue, currentOtherRevenue);

    // ===== Transactions =====
    const transactions = allPayments.map((payment) => {
      const invoice = payment.invoice;
      // Contact-first party resolution (matches getPurchaseReport): prefer the
      // unified Contact, then the bill-to Contact, then the legacy Customer.
      // Invoices created via the unified-contact flow have contactId set but a
      // null legacy `customer`, so reading only `customer` left the name blank
      // and the UI rendered "Deleted User" (seen on contact-linked data only).
      const party = invoice?.contact ?? invoice?.billToContact ?? null;
      const legacy = invoice?.customer;
      const partyName = (party ? resolveDisplayName(party) : '') || legacy?.name || '';
      const partyImage = party?.image || legacy?.image || '';

      return {
        id: payment.id,
        invoiceNumber: invoice?.invoiceNumber || '',
        customer: {
          name: partyName,
          email: party?.email || legacy?.email || '',
          phone: party?.mobile || party?.telephone || legacy?.phone || '',
          image: partyImage ? `${process.env.BASE_URL ?? ''}/${partyImage}` : '',
        },
        paidDate: payment.received_on,
        amount: formatAmount(asNumber(payment.amount, 0)),
        currencyCode: payment.currencyCode ?? null,
        paymentMode: payment.paymentMode
          ? {
              id: payment.paymentMode.id,
              name: payment.paymentMode.name,
              slug: payment.paymentMode.slug,
              status: payment.paymentMode.status,
            }
          : null,
        referenceNo: invoice?.referenceNo || '',
        createdAt: payment.createdAt,
      };
    });

    // ===== Response =====
    res.status(200).json({
      success: true,
      message: 'Product and Total Income data fetched successfully',
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        search: search || null,
      },
      data: {
        product_sales: {
          previousMonthAmount: formatAmount(previousProductSales),
          currentMonthAmount: formatAmount(currentProductSales),
          percentage: +Number(productChange.change || 0).toFixed(),
          trend: productChange.trend,
        },
        total_income: {
          previousMonthAmount: formatAmount(previousTotal),
          currentMonthAmount: formatAmount(currentTotal),
          percentage: +Number(totalChange.change || 0).toFixed(),
          trend: totalChange.trend,
        },
        service_revenue: {
          previousMonthAmount: formatAmount(previousServiceRevenue),
          currentMonthAmount: formatAmount(currentServiceRevenue),
          percentage: +Number(serviceChange.change || 0).toFixed(),
          trend: serviceChange.trend,
        },
        other_revenue: {
          previousMonthAmount: formatAmount(previousOtherRevenue),
          currentMonthAmount: formatAmount(currentOtherRevenue),
          percentage: +Number(otherChange.change || 0).toFixed(),
          trend: otherChange.trend,
        },
      },
      records: transactions,
      pagination: {
        total: totalRecords,
        page: pageN,
        limit: limitN,
        totalPages: Math.ceil(totalRecords / limitN),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching income stats:', err);
    res.status(500).json({
      message: 'Failed to fetch income statistics',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getPurchaseReport
// =============================================================================

export async function getPurchaseReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      startDate,
      endDate,
      search,
      paymentMode,
      page = '1',
      limit = '10',
    } = req.query as {
      startDate?: string;
      endDate?: string;
      search?: string;
      paymentMode?: string;
      page?: string;
      limit?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const now = new Date();
    // UTC-safe month boundaries (see lib/reports/asOf.ts header): building these from
    // local getFullYear()/getMonth()/setHours() shifts the cutoff by the server's UTC
    // offset on non-UTC hosts, so start/end must both be anchored via Date.UTC().
    const startOfCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfPreviousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const endOfPreviousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999),
    );

    // ---------- Filters ----------
    // NOTE: This expense report reads from supplierPayment (payments made),
    // not the expense table. Whether the /report/expense route should source
    // from the expense table instead is a product decision left unchanged here.
    const filters: Prisma.SupplierPaymentWhereInput = {
      isDeleted: false,
      isVoided: false,
      purchase: { userId },
    };
    const startD = parseDate(startDate);
    const endD = parseDate(endDate);
    // Handle one-sided ranges: gte when only startDate, lte when only endDate.
    if (startD || endD) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startD) dateFilter.gte = startD;
      if (endD) dateFilter.lte = endD;
      filters.paymentDate = dateFilter;
    }
    if (paymentMode) {
      filters.paymentModeId = paymentMode;
    }
    if (search) {
      filters.OR = [
        { paymentId: { contains: search, mode: 'insensitive' } },
        { referenceNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const supplierInclude = {
      purchase: true,
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          organisation: true,
          email: true,
          mobile: true,
          telephone: true,
          image: true,
        },
      },
      supplier: {
        select: {
          supplier_name: true,
          supplier_email: true,
          profileImage: true,
        },
      },
      paymentMode: { select: { id: true, name: true, slug: true, status: true } },
    } as const;

    // ---------- Queries With DESC Sorting ----------
    const [currentPayments, previousPayments, allPayments, totalRecords] =
      await Promise.all([
        prisma.supplierPayment.findMany({
          where: { ...filters, paymentDate: { gte: startOfCurrentMonth } },
          orderBy: { paymentDate: 'desc' },
          include: supplierInclude,
        }),
        prisma.supplierPayment.findMany({
          where: {
            ...filters,
            paymentDate: { gte: startOfPreviousMonth, lte: endOfPreviousMonth },
          },
          orderBy: { paymentDate: 'desc' },
          include: supplierInclude,
        }),
        prisma.supplierPayment.findMany({
          where: filters,
          orderBy: { paymentDate: 'desc' },
          include: supplierInclude,
          skip,
          take: limitN,
        }),
        prisma.supplierPayment.count({ where: filters }),
      ]);

    // ---------- Calculations ----------
    const currentTotal = currentPayments.reduce((sum, p) => sum + asNumber(p.amount, 0), 0);
    const previousTotal = previousPayments.reduce(
      (sum, p) => sum + asNumber(p.amount, 0),
      0,
    );

    const currentPurchaseAmount = currentPayments.reduce((sum, payment) => {
      if (!payment.purchase) return sum;
      return sum + sumInvoiceItems(payment.purchase.items);
    }, 0);

    const previousPurchaseAmount = previousPayments.reduce((sum, payment) => {
      if (!payment.purchase) return sum;
      return sum + sumInvoiceItems(payment.purchase.items);
    }, 0);

    const totalChange = calculateChange(previousTotal, currentTotal);
    const purchaseChange = calculateChange(previousPurchaseAmount, currentPurchaseAmount);

    // ---------- Transactions ----------
    const transactions = allPayments.map((payment) => ({
      Id: payment.id,
      supplier: payment.contact
        ? {
            name: resolveDisplayName(payment.contact) || 'Unknown',
            email: payment.contact.email || null,
            image: payment.contact.image || null,
          }
        : payment.supplier
        ? {
            name: payment.supplier.supplier_name,
            email: payment.supplier.supplier_email || null,
            image: payment.supplier.profileImage || null,
          }
        : { name: 'Unknown', email: null, image: null },
      paymentId: payment.paymentId,
      paidDate: payment.paymentDate,
      amount: formatAmount(asNumber(payment.amount, 0)),
      currencyCode: payment.currencyCode ?? null,
      paymentMode: payment.paymentMode
        ? {
            id: payment.paymentMode.id,
            name: payment.paymentMode.name,
            slug: payment.paymentMode.slug,
            status: payment.paymentMode.status,
          }
        : null,
      referenceNo: payment.referenceNumber || '',
      createdAt: payment.createdAt,
    }));

    // ---------- Response ----------
    res.status(200).json({
      success: true,
      message: 'Purchase and Supplier Payment data fetched successfully',
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        search: search || null,
        paymentMode: paymentMode || null,
      },
      data: {
        product_purchases: {
          previousMonthAmount: formatAmount(previousPurchaseAmount),
          currentMonthAmount: formatAmount(currentPurchaseAmount),
          percentage: Math.round(Number(purchaseChange.change || 0)),
          trend: purchaseChange.trend,
        },
        total_payments: {
          previousMonthAmount: formatAmount(previousTotal),
          currentMonthAmount: formatAmount(currentTotal),
          percentage: Math.round(Number(totalChange.change || 0)),
          trend: totalChange.trend,
        },
      },
      records: transactions,
      pagination: {
        total: totalRecords,
        page: pageN,
        limit: limitN,
        totalPages: Math.ceil(totalRecords / limitN),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching purchase report:', err);
    res.status(500).json({
      message: 'Failed to fetch purchase report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getPaymentSummaryReport
// =============================================================================

export async function getPaymentSummaryReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      startDate,
      endDate,
      search,
      paymentMode,
    } = req.query as {
      page?: string;
      limit?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      paymentMode?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const now = new Date();
    // UTC-safe month boundaries (see lib/reports/asOf.ts header): building these from
    // local getFullYear()/getMonth()/setHours() shifts the cutoff by the server's UTC
    // offset on non-UTC hosts, so start/end must both be anchored via Date.UTC().
    const startOfCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const endOfCurrentMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
    );
    const startOfPreviousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const endOfPreviousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999),
    );

    // ---------- Filters ----------
    // Voided payments never count toward received-payment totals or the report list.
    const filter: Prisma.InvoicePaymentWhereInput = { isVoided: false, invoice: { userId } };
    const startD = parseDate(startDate);
    const endD = parseDate(endDate);
    if (startD && endD) {
      filter.received_on = { gte: startD, lte: endD };
    }
    if (paymentMode) {
      filter.paymentModeId = paymentMode;
    }
    if (search) {
      filter.OR = [
        { invoice: { referenceNo: { contains: search, mode: 'insensitive' } } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }

    interface ModeTotal {
      paymentModeId: string;
      /** null means the payment was recorded in the company's base currency */
      currencyCode: string | null;
      totalAmount: number;
      paymentMode: {
        id: string;
        name: string;
        slug: string;
        status: boolean | null;
      };
    }

    // ---------- Monthly Totals (by payment mode + currency) ----------
    const calculateMonthlyTotal = async (start: Date, end: Date): Promise<ModeTotal[]> => {
      const grouped = await prisma.invoicePayment.groupBy({
        by: ['paymentModeId', 'currencyCode'],
        where: { ...filter, received_on: { gte: start, lte: end } },
        _sum: { amount: true },
      });

      const modeIds = [...new Set(
        grouped
          .map((g) => g.paymentModeId)
          .filter((v): v is string => Boolean(v)),
      )];
      const modes = modeIds.length
        ? await prisma.paymentMode.findMany({
            where: { id: { in: modeIds } },
            select: { id: true, name: true, slug: true, status: true },
          })
        : [];
      const modeMap: Record<string, (typeof modes)[number]> = {};
      modes.forEach((m) => {
        modeMap[m.id] = m;
      });

      const out: ModeTotal[] = [];
      for (const g of grouped) {
        if (!g.paymentModeId) continue;
        const mode = modeMap[g.paymentModeId];
        if (!mode) continue;
        out.push({
          paymentModeId: g.paymentModeId,
          currencyCode: g.currencyCode ?? null,
          totalAmount: asNumber(g._sum.amount, 0),
          paymentMode: mode,
        });
      }
      return out;
    };

    const currentTotals = await calculateMonthlyTotal(startOfCurrentMonth, endOfCurrentMonth);
    const previousTotals = await calculateMonthlyTotal(
      startOfPreviousMonth,
      endOfPreviousMonth,
    );

    let totalCurrent = 0;
    let totalPrevious = 0;
    const summary: Record<string, unknown> = {};

    // Helper: build a per-currency breakdown for a given mode
    const buildByCurrency = (
      modeId: string,
      curRows: ModeTotal[],
      prevRows: ModeTotal[],
    ) => {
      const curForMode = curRows.filter((r) => r.paymentModeId === modeId);
      const prevForMode = prevRows.filter((r) => r.paymentModeId === modeId);
      const allCurrencies = new Set<string | null>([
        ...curForMode.map((r) => r.currencyCode),
        ...prevForMode.map((r) => r.currencyCode),
      ]);
      return Array.from(allCurrencies).map((cc) => {
        const cur = curForMode.find((r) => r.currencyCode === cc)?.totalAmount ?? 0;
        const prev = prevForMode.find((r) => r.currencyCode === cc)?.totalAmount ?? 0;
        const pct =
          prev > 0
            ? Math.round(((cur - prev) / prev) * 100)
            : cur > 0
              ? 100
              : 0;
        return {
          currencyCode: cc,
          previousMonthAmount: prev.toFixed(2),
          currentMonthAmount: cur.toFixed(2),
          changePercentage: pct,
          trend: cur > prev ? 'up' : cur < prev ? 'down' : 'equal',
        };
      });
    };

    // Merge modes
    const allModes = new Map<string, ModeTotal['paymentMode']>();
    [...currentTotals, ...previousTotals].forEach((item) => {
      if (item.paymentMode) {
        allModes.set(item.paymentMode.id, item.paymentMode);
      }
    });

    for (const [modeId, mode] of allModes.entries()) {
      // Sum all currencies for the flat totals (backward-compat)
      const current = currentTotals
        .filter((r) => r.paymentModeId === modeId)
        .reduce((s, r) => s + r.totalAmount, 0);
      const previous = previousTotals
        .filter((r) => r.paymentModeId === modeId)
        .reduce((s, r) => s + r.totalAmount, 0);

      totalCurrent += current;
      totalPrevious += previous;

      const changePercentage =
        previous > 0
          ? Math.round(((current - previous) / previous) * 100)
          : current > 0
            ? 100
            : 0;

      summary[mode.slug] = {
        paymentMode: {
          id: mode.id,
          name: mode.name,
          slug: mode.slug,
          status: mode.status,
        },
        // Flat totals kept for backward compatibility (sum of all currencies)
        previousMonthAmount: previous.toFixed(2),
        currentMonthAmount: current.toFixed(2),
        changePercentage,
        trend: current > previous ? 'up' : current < previous ? 'down' : 'equal',
        // Per-currency breakdown — single-currency tenants see exactly one entry
        byCurrency: buildByCurrency(modeId, currentTotals, previousTotals),
      };
    }

    // Grand total byCurrency — aggregate across all modes per currency
    const allCurrenciesGlobal = new Set<string | null>([
      ...currentTotals.map((r) => r.currencyCode),
      ...previousTotals.map((r) => r.currencyCode),
    ]);
    const grandByCurrency = Array.from(allCurrenciesGlobal).map((cc) => {
      const cur = currentTotals
        .filter((r) => r.currencyCode === cc)
        .reduce((s, r) => s + r.totalAmount, 0);
      const prev = previousTotals
        .filter((r) => r.currencyCode === cc)
        .reduce((s, r) => s + r.totalAmount, 0);
      const pct =
        prev > 0
          ? Math.round(((cur - prev) / prev) * 100)
          : cur > 0
            ? 100
            : 0;
      return {
        currencyCode: cc,
        previousMonthAmount: prev.toFixed(2),
        currentMonthAmount: cur.toFixed(2),
        changePercentage: pct,
        trend: cur > prev ? 'up' : cur < prev ? 'down' : 'equal',
      };
    });

    summary.total = {
      previousMonthAmount: totalPrevious.toFixed(2),
      currentMonthAmount: totalCurrent.toFixed(2),
      changePercentage:
        totalPrevious > 0
          ? Math.round(((totalCurrent - totalPrevious) / totalPrevious) * 100)
          : 0,
      trend:
        totalCurrent > totalPrevious
          ? 'up'
          : totalCurrent < totalPrevious
            ? 'down'
            : 'equal',
      byCurrency: grandByCurrency,
    };

    // ---------- Paginated detailed payments ----------
    const payments = await prisma.invoicePayment.findMany({
      where: filter,
      include: {
        invoice: {
          select: {
            referenceNo: true,
            customer: { select: { name: true, email: true, phone: true } },
            contact: {
              select: { id: true, firstName: true, lastName: true, organisation: true },
            },
          },
        },
        paymentMode: { select: { id: true, name: true, slug: true, status: true } },
      },
      orderBy: { received_on: 'desc' },
      skip,
      take: limitN,
    });

    const data = payments.map((p) => ({
      customer:
        (p.invoice?.contact ? resolveDisplayName(p.invoice.contact) : '') ||
        p.invoice?.customer?.name ||
        'N/A',
      paymentId: p.id.toString(),
      paidDate: p.received_on.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      amount: asNumber(p.amount, 0).toFixed(2),
      /** ISO currency code for this payment; null = company base currency */
      currencyCode: p.currencyCode ?? null,
      paymentMode: p.paymentMode
        ? {
            id: p.paymentMode.id,
            name: p.paymentMode.name,
            slug: p.paymentMode.slug,
            status: p.paymentMode.status,
          }
        : null,
      referenceNo: p.invoice?.referenceNo || '',
      createdAt: p.createdAt.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    }));

    const totalRecords = await prisma.invoicePayment.count({ where: filter });

    res.status(200).json({
      message: 'Payment Summary Report fetched successfully',
      summary,
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        search: search || null,
        paymentMode: paymentMode || null,
      },
      pagination: {
        page: pageN,
        limit: limitN,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limitN),
      },
      data,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching payment summary report:', err);
    res.status(500).json({
      message: 'Internal server error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Silence unused-import warning for tenantScope (kept for parity)
void tenantScope;

// CommonJS interop for legacy JS routes
module.exports = {
  getIncomeStats,
  getPurchaseReport,
  getPaymentSummaryReport,
};
module.exports.getIncomeStats = getIncomeStats;
module.exports.getPurchaseReport = getPurchaseReport;
module.exports.getPaymentSummaryReport = getPaymentSummaryReport;
