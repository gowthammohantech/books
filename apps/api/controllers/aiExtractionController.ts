import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireActingUserId, requireTenantId, UnauthorizedError } from '../lib/tenantScope';
import { matchSupplier } from '../lib/aiSupplierMatcher';
import { normalizeBillExtraction, type BillExtractionResult } from '../lib/aiPrompts/billExtraction';
import { getProviderForUser } from '../lib/aiProviders/registry';
import { logAiUsage } from '../lib/aiUsage';
import { tenantOwnerUserId } from '../lib/actor';
import { deleteObject } from '../lib/blobStorage';

/**
 * AI bill extraction controller (Cluster H, slice H.2).
 *
 * Each method is intentionally narrow — the heavy lifting (provider
 * invocation, supplier matching, purchase creation) lives in the lib
 * layer so the routes file stays thin.
 */

type Tx = Prisma.TransactionClient;

function toDecimal(n: number): Prisma.Decimal {
  // Prisma Decimal accepts string or number; using number directly keeps
  // call sites readable and matches the existing Purchase controller.
  return n as unknown as Prisma.Decimal;
}

async function generateNextPurchaseId(tx: Tx): Promise<string> {
  const last = await tx.purchase.findFirst({
    where: { purchaseId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { purchaseId: true },
  });
  let n = 0;
  if (last?.purchaseId) {
    const m = last.purchaseId.match(/\d+$/);
    if (m) n = parseInt(m[0], 10);
  }
  return `PUR-${String(n + 1).padStart(6, '0')}`;
}

export async function extractBill(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded (expected field name "bill")' });
      return;
    }

    // The blob key persistUploads stamped on the file. Kept so the extraction
    // history page can re-view the bill.
    const sourceFilePath = req.file.path;

    // Create PENDING row first so we have an id to write back to even if
    // the provider blows up. Errors get persisted into the same row.
    const job = await prisma.aiExtractionJob.create({
      data: {
        tenantId,
        sourceFilePath,
        mimeType: req.file.mimetype,
        status: 'PENDING',
      },
    });

    let extracted: BillExtractionResult;
    let rawResponse = '';
    let costUsd = 0;
    try {
      const provider = req.aiProvider ?? (await getProviderForUser(tenantId, { requireEnabled: true }));
      const result = await provider.extractDocument(req.file.buffer, req.file.mimetype);
      extracted = normalizeBillExtraction(result.fields);
      rawResponse = result.rawResponse;
      costUsd = result.costUsd ?? 0;
    } catch (extractErr) {
      const message =
        extractErr instanceof Error ? extractErr.message : 'Extraction failed';
      console.error('aiExtraction.extract error:', extractErr);
      await prisma.aiExtractionJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: message,
        },
      });
      res.status(502).json({
        success: false,
        message: 'AI extraction failed',
        data: { jobId: job.id, error: message },
      });
      return;
    }

    const supplierMatch = await matchSupplier(
      { vendorName: extracted.vendorName, vendorGstin: extracted.vendorGstin },
      tenantId,
    );

    const updated = await prisma.aiExtractionJob.update({
      where: { id: job.id },
      data: {
        status: 'EXTRACTED',
        extractedData: extracted as unknown as Prisma.InputJsonValue,
        rawResponse,
        confidence: toDecimal(extracted._confidence),
        costUsd: toDecimal(costUsd),
      },
    });

    // Best-effort usage log (Cluster H, slice H.4). Never fails the request.
    await logAiUsage({
      tenantId,
      feature: 'extraction',
      provider: req.aiConfig?.provider ?? 'MOCK',
      model: req.aiConfig?.extractionModel ?? null,
      costUsd,
    });

    res.json({
      success: true,
      message: 'Bill extracted',
      data: {
        jobId: updated.id,
        status: updated.status,
        extractedData: extracted,
        supplierMatch,
        confidence: extracted._confidence,
        costUsd,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiExtraction.extractBill error:', err);
    res.status(500).json({ success: false, message: 'Failed to process bill upload' });
  }
}

export async function listJobs(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const status = req.query.status as string | undefined;

    const where: Prisma.AiExtractionJobWhereInput = { tenantId };
    if (status && ['PENDING', 'EXTRACTED', 'CONFIRMED', 'FAILED', 'DISCARDED'].includes(status)) {
      where.status = status as Prisma.AiExtractionJobWhereInput['status'];
    }

    const [total, rows] = await Promise.all([
      prisma.aiExtractionJob.count({ where }),
      prisma.aiExtractionJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          sourceFilePath: true,
          mimeType: true,
          extractedData: true,
          confidence: true,
          costUsd: true,
          errorMessage: true,
          resultingPurchaseId: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        jobs: rows.map((r) => ({
          ...r,
          confidence: r.confidence ? Number(r.confidence) : null,
          costUsd: r.costUsd ? Number(r.costUsd) : null,
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiExtraction.listJobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to list extraction jobs' });
  }
}

export async function getJob(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const job = await prisma.aiExtractionJob.findFirst({
      where: { id, tenantId },
    });
    if (!job) {
      res.status(404).json({ success: false, message: 'Extraction job not found' });
      return;
    }
    res.json({
      success: true,
      data: {
        job: {
          ...job,
          confidence: job.confidence ? Number(job.confidence) : null,
          costUsd: job.costUsd ? Number(job.costUsd) : null,
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiExtraction.getJob error:', err);
    res.status(500).json({ success: false, message: 'Failed to load extraction job' });
  }
}

interface ConfirmBody {
  supplierId?: string | null;
  createSupplier?: {
    name: string;
    gstin?: string;
    email?: string;
    phone?: string;
  };
  extractedData?: Partial<BillExtractionResult>;
  purchaseDate?: string;
  dueDate?: string;
  paymentModeId?: string | null;
  bankId?: string | null;
  status?: string;
  referenceNo?: string;
  notes?: string;
}

export async function confirmJob(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as ConfirmBody;

    const job = await prisma.aiExtractionJob.findFirst({ where: { id, tenantId } });
    if (!job) {
      res.status(404).json({ success: false, message: 'Extraction job not found' });
      return;
    }
    if (job.status === 'CONFIRMED') {
      res.status(409).json({ success: false, message: 'Job already confirmed' });
      return;
    }
    if (job.status === 'DISCARDED') {
      res.status(409).json({ success: false, message: 'Job already discarded' });
      return;
    }

    // Allow caller to override individual fields from the extraction.
    const baseExtracted =
      (job.extractedData as unknown as BillExtractionResult | null) ?? null;
    const extracted = normalizeBillExtraction({
      ...(baseExtracted ?? {}),
      ...(body.extractedData ?? {}),
    });

    if (!extracted.lineItems.length) {
      res.status(400).json({
        success: false,
        message: 'Cannot create a purchase with zero line items',
      });
      return;
    }

    // Resolve supplier name + optional Supplier row creation. The Purchase
    // model takes `billFrom`/`billTo` as User.id refs (legacy schema), so
    // we store the AI-confirmed supplier as a `Supplier` row for the
    // supplier list, and seed billFrom=billTo=tenantId on the Purchase
    // itself — matching the existing demo seed pattern.
    let supplierRowId: string | null = body.supplierId ?? null;
    let supplierName = extracted.vendorName ?? '';
    if (!supplierRowId && body.createSupplier && body.createSupplier.name) {
      const created = await prisma.supplier.create({
        data: {
          tenantId: tenantId,
          supplier_name: body.createSupplier.name,
          supplier_email:
            body.createSupplier.email && body.createSupplier.email.trim()
              ? body.createSupplier.email
              : `ai-${Date.now()}@elixirbooks.local`,
          supplier_phone: body.createSupplier.phone ?? '',
          balance: 0,
          status: true,
        },
      });
      supplierRowId = created.id;
      supplierName = created.supplier_name;
    } else if (supplierRowId) {
      const existing = await prisma.supplier.findFirst({
        where: { id: supplierRowId, tenantId: tenantId },
      });
      if (existing) supplierName = existing.supplier_name;
    }

    const subtotal = extracted.subtotal || extracted.lineItems.reduce((sum, li) => sum + (li.amount ?? 0), 0);
    const totalTax = extracted.taxBreakdown.reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const grandTotal = extracted.total || subtotal + totalTax;

    const items = extracted.lineItems.map((li) => ({
      productName: li.description,
      description: li.description,
      qty: li.quantity,
      rate: li.unitPrice,
      discount: 0,
      taxableAmount: li.amount,
      taxes: extracted.taxBreakdown.map((t) => ({
        name: t.label,
        kind: t.label.toUpperCase().includes('IGST') ? 'IGST' : t.label.toUpperCase().includes('CGST') ? 'CGST' : t.label.toUpperCase().includes('SGST') ? 'SGST' : 'OTHER',
        percent: t.rate,
        amount: t.amount,
      })),
      totalTax,
      lineTotal: li.amount,
    }));

    const purchaseDate = body.purchaseDate
      ? new Date(body.purchaseDate)
      : extracted.invoiceDate
        ? new Date(extracted.invoiceDate)
        : new Date();
    const dueDate = body.dueDate
      ? new Date(body.dueDate)
      : extracted.dueDate
        ? new Date(extracted.dueDate)
        : purchaseDate;

    // Resolved once, outside the transaction: `billFrom` is NOT NULL, and a
    // workspace always has an owner membership (provisionTenant creates it in
    // the same transaction as the tenant).
    const purchaseBillParty = (await tenantOwnerUserId(tenantId)) ?? requireActingUserId(req);

    const purchase = await prisma.$transaction(async (tx) => {
      const purchaseIdString = await generateNextPurchaseId(tx);
      const created = await tx.purchase.create({
        data: {
          purchaseId: purchaseIdString,
          purchaseOrderId: null,
          purchaseDate,
          dueDate,
          referenceNo: body.referenceNo ?? extracted.invoiceNumber ?? '',
          items: items as unknown as Prisma.InputJsonValue,
          status: 'pending',
          paymentModeId: body.paymentModeId ?? null,
          taxableAmount: toDecimal(subtotal),
          totalDiscount: toDecimal(0),
          totalTax: toDecimal(totalTax),
          roundOff: false,
          totalAmount: toDecimal(grandTotal),
          paidAmount: toDecimal(0),
          balanceAmount: toDecimal(grandTotal),
          bankId: body.bankId ?? null,
          notes:
            body.notes
            ?? `Created from AI extraction (job ${job.id}). Supplier: ${supplierName || 'unknown'}.`,
          termsAndCondition: null,
          sign_type: 'none',
          tenantId,
          // Both are User FKs meaning "this company" — see lib/actor.ts. They
          // held the tenant id, which was the owner's User.id until workspaces
          // got their own uuids; resolving the owner keeps the same value and
          // stops the insert failing the foreign key.
          billFrom: purchaseBillParty,
          billTo: purchaseBillParty,
        },
      });

      await tx.aiExtractionJob.update({
        where: { id: job.id },
        data: {
          status: 'CONFIRMED',
          resultingPurchaseId: created.id,
        },
      });

      return created;
    });

    res.json({
      success: true,
      message: 'Purchase created from extracted bill',
      data: {
        purchaseId: purchase.id,
        purchaseNumber: purchase.purchaseId,
        supplierId: supplierRowId,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiExtraction.confirmJob error:', err);
    res.status(500).json({ success: false, message: 'Failed to confirm extraction job' });
  }
}

export async function discardJob(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const job = await prisma.aiExtractionJob.findFirst({ where: { id, tenantId } });
    if (!job) {
      res.status(404).json({ success: false, message: 'Extraction job not found' });
      return;
    }
    if (job.status === 'CONFIRMED') {
      res.status(409).json({ success: false, message: 'Cannot discard a confirmed job' });
      return;
    }

    // Best-effort source cleanup: a discarded job's bill has no reader left.
    await deleteObject(job.sourceFilePath);

    const updated = await prisma.aiExtractionJob.update({
      where: { id: job.id },
      data: { status: 'DISCARDED' },
    });

    res.json({
      success: true,
      message: 'Extraction job discarded',
      data: { jobId: updated.id, status: updated.status },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiExtraction.discardJob error:', err);
    res.status(500).json({ success: false, message: 'Failed to discard extraction job' });
  }
}

const handlers = { extractBill, listJobs, getJob, confirmJob, discardJob };
