import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

import { mockEInvoiceProvider } from '../lib/einvoiceProviders/mockProvider';
import type { EInvoiceProvider } from '../lib/einvoiceProvider';

function getProvider(_providerName?: string | null): EInvoiceProvider {
  // v1: only mock provider. Future: select by name (cleartax / masters-india / iris).
  return mockEInvoiceProvider;
}

interface InvoiceItem {
  name?: string;
  qty?: number;
  rate?: number;
  amount?: number;
  totalTax?: number;
}

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)));
    const where: Prisma.EInvoiceRecordWhereInput = { userId };
    const status = req.query.status as string | undefined;
    if (status) where.status = status as Prisma.EInvoiceRecordWhereInput['status'];

    const [rows, total] = await Promise.all([
      prisma.eInvoiceRecord.findMany({
        where,
        include: { invoice: { select: { id: true, invoiceNumber: true, TotalAmount: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.eInvoiceRecord.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        eInvoices: rows.map((r) => ({
          id: r.id,
          irn: r.irn,
          ackNo: r.ackNo,
          ackDate: r.ackDate,
          status: r.status,
          provider: r.provider,
          errorMessage: r.errorMessage,
          invoice: r.invoice ? { id: r.invoice.id, invoiceNumber: r.invoice.invoiceNumber, totalAmount: r.invoice.TotalAmount } : null,
          createdAt: r.createdAt,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('eInvoice list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list e-invoices' });
  }
}

export async function getByInvoice(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { invoiceId } = req.params as { invoiceId: string };

    const row = await prisma.eInvoiceRecord.findFirst({
      where: { invoiceId, userId },
      orderBy: { createdAt: 'desc' },
      include: { invoice: { select: { id: true, invoiceNumber: true } } },
    });
    // Absence of an e-invoice record is a normal state (IRN not generated yet),
    // not an error. Return 200 with a null record so clients don't log a 404.
    if (!row) {
      res.json({ success: true, data: { eInvoice: null } });
      return;
    }
    res.json({ success: true, data: { eInvoice: { ...row } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('eInvoice getByInvoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch e-invoice' });
  }
}

export async function generate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { invoiceId } = req.params as { invoiceId: string };

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, userId, isDeleted: false },
      include: { billToCustomer: { select: { name: true, gstin: true } } },
    });
    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    // Idempotency: if already generated, return existing record
    const existing = await prisma.eInvoiceRecord.findFirst({
      where: { invoiceId, status: 'GENERATED' },
    });
    if (existing) {
      res.json({ success: true, message: 'IRN already generated', data: { eInvoice: { ...existing } } });
      return;
    }

    // CompanySettings has no gstNumber field in current schema — pass empty
    // string. Mock provider doesn't validate. Real provider integration will
    // need a dedicated GSTIN field on CompanySettings or a per-user config.
    const sellerGstin = '';

    const items = (invoice.items as unknown as InvoiceItem[] | null) ?? [];
    const payload = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber ?? invoice.id.slice(0, 8),
      invoiceDate: invoice.invoiceDate,
      sellerGstin,
      buyerGstin: invoice.billToCustomer?.gstin ?? null,
      totalAmount: Number(invoice.TotalAmount ?? 0),
      taxableAmount: Number(invoice.taxableAmount ?? 0),
      totalTax: Number(invoice.vat ?? 0),
      items: items.map((i) => ({
        name: i.name ?? '',
        qty: Number(i.qty ?? 0),
        rate: Number(i.rate ?? 0),
        amount: Number(i.amount ?? 0),
        tax: Number(i.totalTax ?? 0),
      })),
    };

    const provider = getProvider('mock');
    let result;
    try {
      result = await provider.generate(payload, {});
    } catch (e) {
      const record = await prisma.eInvoiceRecord.create({
        data: {
          userId,
          invoiceId: invoice.id,
          provider: provider.name,
          status: 'FAILED',
          errorMessage: e instanceof Error ? e.message : String(e),
        },
      });
      res.status(500).json({ success: false, message: 'IRN generation failed', data: { eInvoice: record } });
      return;
    }

    const created = await prisma.eInvoiceRecord.create({
      data: {
        userId,
        invoiceId: invoice.id,
        provider: provider.name,
        status: 'GENERATED',
        irn: result.irn,
        ackNo: result.ackNo,
        ackDate: result.ackDate,
        signedInvoice: result.signedInvoice,
        signedQRCode: result.signedQRCode,
        metadata: (result.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    res.status(201).json({ success: true, message: 'IRN generated', data: { eInvoice: { ...created } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('eInvoice generate error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate IRN' });
  }
}

export async function cancel(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as { reason?: string };

    const record = await prisma.eInvoiceRecord.findFirst({ where: { id, userId } });
    if (!record) {
      res.status(404).json({ success: false, message: 'E-invoice record not found' });
      return;
    }
    if (record.status === 'CANCELLED') {
      res.status(400).json({ success: false, message: 'Already cancelled' });
      return;
    }
    if (record.status !== 'GENERATED' || !record.irn) {
      res.status(400).json({ success: false, message: 'Only GENERATED records can be cancelled' });
      return;
    }

    const provider = getProvider(record.provider);
    const result = await provider.cancel(record.irn, body.reason ?? 'No reason given', {});

    const updated = await prisma.eInvoiceRecord.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: result.cancelledAt,
        cancelReason: body.reason ?? null,
      },
    });

    res.json({ success: true, message: 'IRN cancelled', data: { eInvoice: { ...updated } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('eInvoice cancel error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel IRN' });
  }
}

const handlers = { list, getByInvoice, generate, cancel };
module.exports = handlers;
module.exports.default = handlers;
