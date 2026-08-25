import type {
  Invoice,
  RecurrenceFrequency,
  RecurrenceCustomIntervalType,
  Prisma,
} from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';

import { prisma } from './prisma';
import {
  postInvoiceIssued,
  postSaleCogs,
  type PostingTx,
} from './ledger/ledgerPosting';

export type RecurringInvoiceCadence = Pick<
  Invoice,
  'repeatEvery' | 'customIntervalNumber' | 'customIntervalType'
>;

/**
 * Pure: compute the next recurrence date.
 * Day/week/month/year add the natural unit. Custom uses customIntervalNumber + customIntervalType.
 */
export function getNextRecurringDate(currentDate: Date, cadence: RecurringInvoiceCadence): Date {
  const newDate = new Date(currentDate);
  let interval = 1;
  let type: RecurrenceFrequency | RecurrenceCustomIntervalType = cadence.repeatEvery ?? 'month';

  if (cadence.repeatEvery === 'custom') {
    interval = cadence.customIntervalNumber ?? 1;
    type = cadence.customIntervalType ?? 'month';
  }

  // Use UTC accessors throughout: dates are stored/compared in UTC, and local-time
  // month/year math rolls over a day early on hosts behind UTC (e.g. +6 months of a
  // UTC-midnight date yielded the previous day). UTC math is timezone-independent.
  switch (type) {
    case 'day':
      newDate.setUTCDate(newDate.getUTCDate() + interval);
      break;
    case 'week':
      newDate.setUTCDate(newDate.getUTCDate() + 7 * interval);
      break;
    case 'month':
      newDate.setUTCMonth(newDate.getUTCMonth() + interval);
      break;
    case 'year':
      newDate.setUTCFullYear(newDate.getUTCFullYear() + interval);
      break;
    default:
      newDate.setUTCMonth(newDate.getUTCMonth() + interval);
  }

  return newDate;
}

interface CloneResult {
  source: Invoice;
  newInvoiceId: string;
  newInvoiceNumber: string | null;
}

export async function runRecurringForInvoice(invoiceId: string): Promise<CloneResult> {
  return await prisma.$transaction(async (tx) => {
    const source = await tx.invoice.findFirst({
      where: { id: invoiceId, isRecurring: true, isDeleted: false },
    });
    if (!source) throw new Error('SOURCE_NOT_FOUND');
    if (source.stopped) throw new Error('SOURCE_STOPPED');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const prefixSetting = await tx.generalSetting.findUnique({ where: { key: 'invoicePrefix' } });
    const prefix =
      prefixSetting && typeof prefixSetting.value === 'string' ? prefixSetting.value : 'INV-';
    const lastInvoice = await tx.invoice.findFirst({
      where: { invoiceNumber: { not: null }, invoiceType: 'INVOICE' },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });
    let lastNumber = 0;
    if (lastInvoice?.invoiceNumber) {
      const m = lastInvoice.invoiceNumber.match(/\d+$/);
      if (m) lastNumber = parseInt(m[0], 10);
    }
    const newInvoiceNumber = `${prefix}${String(lastNumber + 1).padStart(6, '0')}`;

    const {
      id: _id,
      createdAt: _ca,
      updatedAt: _ua,
      invoiceNumber: _in,
      parentInvoice: _pi,
      convertedFromId: _cf,
      convertedAt: _cAt,
      lastRecurringDate: _lr,
      nextRecurringDate: _nr,
      ...rest
    } = source;

    const newDue = source.dueDate
      ? getNextRecurringDate(source.dueDate, source)
      : getNextRecurringDate(today, source);

    const created = await tx.invoice.create({
      data: {
        ...rest,
        items: (rest.items ?? null) as Prisma.InputJsonValue,
        paymentOptions: (rest.paymentOptions ?? undefined) as Prisma.InputJsonValue | undefined,
        invoiceNumber: newInvoiceNumber,
        parentInvoice: source.id,
        invoiceDate: today,
        dueDate: newDue,
        status: 'UNPAID',
        isRecurring: false,
        lastRecurringDate: null,
        nextRecurringDate: null,
      },
    });

    await tx.invoice.update({
      where: { id: source.id },
      data: {
        lastRecurringDate: today,
        nextRecurringDate: getNextRecurringDate(today, source),
      },
    });

    // GL posting: the manual create endpoint posts via postInvoiceIssued +
    // postSaleCogs (controllers/Admin/Invoice/invoiceController.postInvoiceLedger).
    // Recurring crons previously skipped this, so auto-generated revenue never hit
    // the ledger and AR-aging↔GL drifted every cycle. Post the same balanced
    // entries here. gatedPost is a no-op until the ledger is live and is
    // idempotent per (Invoice, created.id, 'issued'/'cogs'), so a re-run cannot
    // double-post. PROFORMA never posts AR (mirrors postInvoiceLedger).
    if (created.invoiceType !== 'PROFORMA') {
      await postInvoiceIssued(tx as unknown as PostingTx, {
        userId: created.userId,
        invoiceId: created.id,
        date: created.invoiceDate ?? today,
        total: String(created.TotalAmount),
        tax: String(created.vat ?? 0),
        ...(created.currencyCode ? { currencyCode: created.currencyCode } : {}),
        ...(created.exchangeRate != null ? { exchangeRate: created.exchangeRate } : {}),
        ...(created.costCenterId !== undefined ? { costCenterId: created.costCenterId } : {}),
        ...(created.projectId !== undefined ? { projectId: created.projectId } : {}),
      });

      // COGS: Dr COGS / Cr INVENTORY at current avgCost for stocked items
      // (Service products and items with no inventory are skipped). Mirrors the
      // recompute-from-items branch of postInvoiceLedger. Always functional currency.
      let totalCogs = new PrismaNS.Decimal(0);
      const items = Array.isArray(created.items)
        ? (created.items as Array<{ productId?: string; id?: string; qty?: number | string }>)
        : [];
      for (const item of items) {
        const productId = item.productId ?? item.id;
        const qty = item.qty != null ? Number(item.qty) : 0;
        if (!productId || !qty) continue;
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { item_type: true },
        });
        if (product?.item_type === 'Service') continue;
        const inv = await tx.inventory.findFirst({
          where: { productId, userId: created.userId, isDeleted: false },
        });
        if (!inv) continue;
        totalCogs = totalCogs.plus(inv.avgCost.times(new PrismaNS.Decimal(qty)));
      }
      await postSaleCogs(tx as unknown as PostingTx, {
        userId: created.userId,
        invoiceId: created.id,
        date: created.invoiceDate ?? today,
        cost: totalCogs.toString(),
      });
    }

    return { source, newInvoiceId: created.id, newInvoiceNumber: created.invoiceNumber };
  });
}

export async function runDueRecurringInvoices(): Promise<{
  processed: number;
  successes: string[];
  failures: Array<{ id: string; error: string }>;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = await prisma.invoice.findMany({
    where: {
      isRecurring: true,
      isDeleted: false,
      stopped: false,
      parentInvoice: null,
      nextRecurringDate: { lte: today },
      OR: [{ neverExpire: true }, { endsOn: null }, { endsOn: { gte: today } }],
    },
    select: { id: true, invoiceNumber: true },
  });

  const successes: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  for (const inv of due) {
    try {
      const out = await runRecurringForInvoice(inv.id);
      successes.push(`${inv.invoiceNumber ?? inv.id} → ${out.newInvoiceNumber}`);
    } catch (err) {
      failures.push({ id: inv.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { processed: due.length, successes, failures };
}
