// controllers/Admin/Purchases/debitNoteController.ts
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { DebitNoteStatus, SignType } from '@prisma/client';
import { validationResult } from 'express-validator';

import { prisma } from '../../../lib/prisma';
import { tenantScope, requireUserId, UnauthorizedError } from '../../../lib/tenantScope';
import {
  nextDocumentNumber,
  withDocumentNumberRetry,
  handleNumberConflict,
  type NumberingModel,
} from '../../../lib/documentNumbering';
import { resolveDisplayName } from '../../../lib/contacts/contactIdentity';
import { applyDocumentTreatment } from '../../../lib/tax/applyTreatment';
import {
  computeDocumentTotals,
  resolveItemTaxRates,
  warnOnTotalsDivergence,
  type TotalsItem,
  type TaxGroupLookupDb,
} from '../../../lib/documentTotals';
import { sanitizeLineCustomFields } from '../../../lib/lineCustomFields';
import { parseTaxTreatment } from '../../../lib/tax/taxTreatment';
import type { TaxTreatment } from '../../../lib/tax/taxTreatment';

// C.1: resolve the company default currency code (ISO string).
async function resolveDefaultCurrencyCode(): Promise<string | null> {
  const defaultCurrency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return defaultCurrency?.code ?? null;
}
import { handleLedgerError } from '../../../lib/httpErrors';
import {
  postDebitNoteIssued,
  reverseDocument,
  voidDocument,
  type PostingTx,
} from '../../../lib/ledger/ledgerPosting';
import { applyStockAdjustment, resolveRestockUnitCost } from '../../../lib/inventory/stockAdjust';

// utils/mailer is still JS; static require is fine here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailerModule: { sendMail: (opts: Record<string, unknown>) => Promise<void> } = require('../../../utils/mailer');

type Tx = Prisma.TransactionClient;

const VALID_STATUSES = new Set<DebitNoteStatus>([
  'new',
  'pending',
  'completed',
  'cancelled',
  'partially_paid',
  'paid',
]);

const VALID_SIGN_TYPES = new Set<SignType>(['none', 'digitalSignature', 'eSignature']);

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDecimal(value: unknown, fallback = 0): Prisma.Decimal {
  return new Prisma.Decimal(typeof value === 'number' || typeof value === 'string' ? value : fallback);
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatDateShort(d: Date | null | undefined): string | null {
  if (!d) return null;
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleString('default', { month: 'short' });
  return `${day}, ${month} ${d.getFullYear()}`;
}

interface IncomingItem {
  id?: string;
  productId?: string;
  name?: string;
  unit?: string;
  qty?: number;
  quantity?: number;
  rate?: number;
  discount?: number;
  tax?: number;
  tax_group_id?: string;
  amount?: number;
  discount_type?: string;
  discount_value?: number;
  reason?: string;
  customFields?: unknown;
}

interface StoredItem {
  productId?: string;
  name: string;
  unit: string;
  quantity: number;
  rate: number;
  discount: number;
  tax: number;
  tax_group_id?: string;
  discount_type?: string;
  discount_value: number;
  amount: number;
  reason?: string;
  customFields?: Record<string, string | number | boolean | string[]>;
}

function normaliseItems(raw: unknown): StoredItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as IncomingItem[]).map((item) => {
    const quantity = asNumber(item.qty ?? item.quantity, 0);
    const rate = asNumber(item.rate, 0);
    return {
      productId: item.id ?? item.productId,
      name: item.name ?? '',
      unit: item.unit ?? '',
      quantity,
      rate,
      discount: asNumber(item.discount, 0),
      tax: asNumber(item.tax, 0),
      tax_group_id: item.tax_group_id,
      discount_type: item.discount_type,
      discount_value: asNumber(item.discount_value, 0),
      amount: asNumber(item.amount, rate * quantity),
      reason: item.reason,
      customFields: sanitizeLineCustomFields(item.customFields),
    };
  });
}

/**
 * Bug 2b: validate that no return line exceeds what was purchased on the source
 * purchase. Pure + exported so it is unit-testable independent of the controller.
 *
 * @param items                  normalised debit-note lines (return quantities)
 * @param purchasedQtyByProduct  productId → total purchased qty on the source purchase
 * @returns { ok: true } or { ok: false, message } describing the first violation
 */
export function validateReturnQuantities(
  items: { productId?: string; name?: string; quantity: number }[],
  purchasedQtyByProduct: Map<string, number>,
): { ok: true } | { ok: false; message: string } {
  for (const item of items) {
    const pid = item.productId;
    if (!pid || !item.quantity) continue;
    const purchasedQty = purchasedQtyByProduct.get(pid);
    if (purchasedQty === undefined) {
      return { ok: false, message: `Item ${item.name || pid} is not part of the source purchase` };
    }
    if (item.quantity > purchasedQty) {
      return {
        ok: false,
        message: `Returned quantity (${item.quantity}) exceeds purchased quantity (${purchasedQty}) for item ${item.name || pid}`,
      };
    }
  }
  return { ok: true };
}

function generateNextDebitNoteNumber(tx: Tx, userId: string): Promise<string> {
  return nextDocumentNumber({
    model: tx.debitNote as unknown as NumberingModel,
    field: 'debitNoteId',
    prefix: 'DN-',
    tenantWhere: { userId },
  });
}

// =============================================================================
// createDebitNote
// =============================================================================

export async function createDebitNote(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const userId = requireUserId(req);
    const body = req.body as Record<string, unknown>;

    const purchaseId = body.purchaseId as string;
    const billFromId = body.billFrom as string;
    // billTo can be a contactId (new path) or a supplierId (legacy path)
    const billToId = body.billTo as string | undefined;
    const incomingBillToContactId = typeof body.billToContactId === 'string' && body.billToContactId ? body.billToContactId : null;
    const createdById = (body.createdBy as string) || userId;

    // Validate purchase exists and is tenant-owned (include contact + supplier for vendor resolution)
    const purchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, userId },
      select: { id: true, supplierId: true, contactId: true, items: true },
    });
    if (!purchase) {
      res.status(404).json({ message: 'Purchase not found' });
      return;
    }

    // Bug 2b: a purchase-return line can never exceed what was purchased. Build a
    // productId → purchased-qty map from the source purchase and validate below,
    // once the incoming items are normalised.
    const purchasedQtyByProduct = new Map<string, number>();
    {
      const purchaseItems = Array.isArray(purchase.items)
        ? (purchase.items as unknown as { productId?: string; id?: string; qty?: number; quantity?: number }[])
        : [];
      for (const pItem of purchaseItems) {
        const pid = pItem.productId ?? pItem.id;
        if (!pid) continue;
        const pQty = asNumber(pItem.qty ?? pItem.quantity, 0);
        purchasedQtyByProduct.set(pid, (purchasedQtyByProduct.get(pid) ?? 0) + pQty);
      }
    }

    // Vendor party: resolve from purchase's contactId (new path) or supplierId (legacy path).
    let resolvedVendorContactId: string | null = null;
    let supplierConnect: { connect: { id: string } } | undefined;
    // C2: defaultTaxTreatment from the resolved primary contact
    let contactDefaultTaxTreatment: TaxTreatment | null = null;

    if (purchase.contactId) {
      // New path: purchase is contact-based; resolve vendor contact and its defaultTaxTreatment.
      resolvedVendorContactId = purchase.contactId;
      const contactRow = await (prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>).contact.findFirst({
        where: { id: purchase.contactId, userId, isDeleted: false },
        select: { defaultTaxTreatment: true },
      } as never) as { defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) {
        contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
      }
    } else if (purchase.supplierId) {
      // Legacy path: use supplierId; also try to back-resolve contactId.
      const supplier = await prisma.supplier.findFirst({
        where: { id: purchase.supplierId, isDeleted: false },
      });
      if (!supplier) {
        res.status(422).json({ message: 'Invalid supplier ID from purchase' });
        return;
      }
      supplierConnect = { connect: { id: purchase.supplierId } };
      const contactRow = await (prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>).contact.findFirst({
        where: { legacySupplierId: purchase.supplierId, userId, isDeleted: false },
        select: { id: true, defaultTaxTreatment: true },
      } as never) as { id: string; defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) {
        resolvedVendorContactId = contactRow.id;
        contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
      }
    } else {
      res.status(422).json({ message: 'No vendor party found on purchase' });
      return;
    }

    // Bill-from is your company (a User).
    const billFromUser = await prisma.user.findUnique({ where: { id: billFromId } });
    if (!billFromUser) {
      res.status(422).json({ message: 'Invalid bill from user ID' });
      return;
    }

    // Bill-to party: new path = body.billToContactId; legacy path = body.billTo as supplierId.
    let resolvedBillToContactId: string | null = incomingBillToContactId;
    let resolvedBillToSupplierId: string | null = null;
    let billToSupplier: { supplier_name: string; supplier_email: string } | null = null;

    if (incomingBillToContactId) {
      // New contact-based bill-to: verify ownership.
      const ownedContact = await (prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>).contact.findFirst({
        where: { id: incomingBillToContactId, userId, isDeleted: false },
        select: { id: true },
      } as never) as { id: string } | null;
      if (!ownedContact) {
        res.status(404).json({ success: false, message: 'Bill-to contact not found' });
        return;
      }
    } else if (billToId) {
      // Legacy supplierId bill-to path.
      resolvedBillToSupplierId = billToId;
      billToSupplier = await prisma.supplier.findFirst({
        where: { id: billToId, isDeleted: false },
      }) as { supplier_name: string; supplier_email: string } | null;
      if (!billToSupplier) {
        res.status(422).json({ message: 'Invalid bill to supplier ID' });
        return;
      }
      // Back-resolve contactId for billTo
      const contactRow = await (prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>).contact.findFirst({
        where: { legacySupplierId: billToId, userId, isDeleted: false },
        select: { id: true },
      } as never) as { id: string } | null;
      if (contactRow) {
        resolvedBillToContactId = contactRow.id;
      }
    }

    // Validate signature type
    const signType = ((body.sign_type as string) ?? 'none') as SignType;
    if (!VALID_SIGN_TYPES.has(signType)) {
      res.status(400).json({ message: 'Invalid signature type' });
      return;
    }
    if (signType === 'eSignature') {
      if (!req.file) {
        res.status(400).json({ message: 'Signature image is required for eSignature' });
        return;
      }
      if (!body.signatureName) {
        res.status(400).json({ message: 'Signature name is required for eSignature' });
        return;
      }
    }

    // Status
    const status = ((body.status as string) ?? 'new') as DebitNoteStatus;
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }

    // Items + amounts
    const items = normaliseItems(body.items);

    // Bug 2b: reject any return line whose quantity exceeds the purchased quantity
    // for that product on the source purchase. Prevents over-returning stock/GL.
    const qtyCheck = validateReturnQuantities(items, purchasedQtyByProduct);
    if (!qtyCheck.ok) {
      res.status(422).json({ message: qtyCheck.message });
      return;
    }
    // Server-authoritative totals: debit-note lines carry a flat `tax` amount +
    // tax_group_id (no per-line percent), so resolve the group's rate then
    // recompute tax on the discounted base. Debit notes post to the GL from the
    // persisted totalAmount/totalTax, so client-sent totals are ignored here.
    const itemsWithRates = await resolveItemTaxRates(prisma as unknown as TaxGroupLookupDb, items as unknown as TotalsItem[]);
    const serverTotals = computeDocumentTotals(itemsWithRates);
    const paidAmount = asNumber(body.paidAmount, 0);

    warnOnTotalsDivergence('debitNote', 'new', asNumber(body.grandTotal, NaN), serverTotals.grandTotal);
    const finalTaxable = serverTotals.subTotal;
    const finalDiscount = serverTotals.totalDiscount;
    const finalTax = serverTotals.totalTax;
    const finalTotal = serverTotals.grandTotal;

    // C.1: per-document currency — use caller-supplied code or fall back to company default.
    const docCurrencyCode =
      (typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null) ??
      (await resolveDefaultCurrencyCode());

    // C2: per-document tax treatment.
    const docTreatment: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ?? contactDefaultTaxTreatment ?? 'STANDARD';

    // Apply treatment: STANDARD is a pass-through; suppressing treatments zero out tax + item taxes.
    // StoredItem uses 'tax' (not 'totalTax'/'taxes'); cast satisfies the generic constraint.
    const enforcedDN = applyDocumentTreatment(docTreatment, finalTax, items as { totalTax?: number; taxes?: { amount?: number }[] | null }[]);
    const enforcedTax = enforcedDN.tax;
    const enforcedItems = enforcedDN.items;
    // Recompute totalAmount when tax was suppressed.
    const enforcedTotal = docTreatment === 'STANDARD' ? finalTotal : finalTaxable + enforcedTax - finalDiscount;

    // Signature image / id
    const signatureImage = signType === 'eSignature' && req.file ? req.file.path : null;
    const signatureName = signType === 'eSignature' ? ((body.signatureName as string) ?? null) : null;
    const signatureId = (body.signatureId as string) || null;

    const debitNote = await withDocumentNumberRetry('debitNoteId', () => prisma.$transaction(async (tx) => {
      const debitNoteNumber = await generateNextDebitNoteNumber(tx, userId);
      const debitNoteDate = safeDate(body.debitNoteDate) ?? new Date();
      const created = await tx.debitNote.create({
        data: {
          debitNoteId: debitNoteNumber,
          purchase: { connect: { id: purchaseId } },
          ...(supplierConnect ? { supplier: supplierConnect } : {}),
          ...(resolvedVendorContactId ? { contact: { connect: { id: resolvedVendorContactId } } } : {}),
          debitNoteDate,
          dueDate: debitNoteDate,
          referenceNo: (body.referenceNo as string) ?? '',
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          status,
          paymentMode: body.paymentMode
            ? { connect: { id: body.paymentMode as string } }
            : undefined,
          taxableAmount: toDecimal(finalTaxable),
          totalDiscount: toDecimal(finalDiscount),
          totalTax: toDecimal(enforcedTax),
          totalAmount: toDecimal(enforcedTotal),
          paidAmount: toDecimal(paidAmount),
          balanceAmount: toDecimal(0),
          bank: body.bank ? { connect: { id: body.bank as string } } : undefined,
          notes: (body.notes as string) ?? '',
          termsAndCondition: (body.termsAndCondition as string) ?? '',
          sign_type: signType,
          signature: signatureId ? { connect: { id: signatureId } } : undefined,
          signatureImage,
          signatureName,
          checkNumber: (body.checkNumber as string) || null,
          user: { connect: { id: userId } },
          createdByUser: { connect: { id: createdById } },
          billFromUser: { connect: { id: billFromId } },
          ...(resolvedBillToSupplierId ? { billToSupplier: { connect: { id: resolvedBillToSupplierId } } } : {}),
          ...(resolvedBillToContactId ? { billToContact: { connect: { id: resolvedBillToContactId } } } : {}),
          taxTreatment: docTreatment,
          // C.1: persist document currency
          ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
        },
      });

      // Bug 2a: a debit note only moves stock / posts to the GL once the return is
      // actually effective. A `new` (draft) or `cancelled` note must NOT decrement
      // inventory or post GL — mirrors the purchase controller's status gate.
      const stockAndGlActive = status !== 'new' && status !== 'cancelled';

      // Stock adjustment: purchase return → stock decrements for non-Service items.
      if (stockAndGlActive) {
        for (const item of items) {
          const productId = item.productId;
          if (!productId || !item.quantity) continue;
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            userId: requireUserId(req),
            qtyDelta: -item.quantity,
            type: 'stock_out',
            referenceType: 'purchase_return',
            referenceId: created.id,
          });
        }
      }

      // GL posting: compute inventory/expense split from items.
      // Strategy matches purchase controller: inventory-tracked (item_type !== 'Service')
      // → inventoryNet; derive expenseNet = total - tax - inventoryNet as residual so
      // the assertSplit in postDebitNoteIssued always reconciles.
      if (stockAndGlActive) {
        const total = String(created.totalAmount);
        const tax = String(created.totalTax ?? 0);
        let inventoryNet = new Prisma.Decimal(0);
        for (const item of items) {
          const productId = item.productId;
          if (!productId) continue;
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { item_type: true },
          });
          if (product && product.item_type !== 'Service') {
            inventoryNet = inventoryNet.plus(new Prisma.Decimal(asNumber(item.amount, 0)));
          }
        }
        const totalDec = new Prisma.Decimal(String(created.totalAmount ?? 0));
        const taxDec = new Prisma.Decimal(String(created.totalTax ?? 0));
        const maxNet = totalDec.minus(taxDec);
        const clampedInv = inventoryNet.greaterThan(maxNet) ? maxNet : inventoryNet;
        const expenseNet = maxNet.minus(clampedInv);
        await postDebitNoteIssued(tx as unknown as PostingTx, {
          userId,
          debitNoteId: created.id,
          date: created.debitNoteDate ?? new Date(),
          total,
          tax,
          inventoryNet: clampedInv.toString(),
          expenseNet: expenseNet.toString(),
        });
      }

      return created;
    }));

    res.status(201).json({
      message: 'Debit note created successfully',
      data: { debitNote },
    });

    // Optional email (best-effort)
    if (billToSupplier?.supplier_email && process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
      try {
        const toName = billToSupplier?.supplier_name ?? '';
        await mailerModule.sendMail({
          to: billToSupplier.supplier_email,
          subject: 'New Debit Note Created',
          html: `
            <h3>Hello ${toName},</h3>
            <p>A new debit note has been created for you.</p>
            <p><strong>Reference No:</strong> ${debitNote.referenceNo ?? ''}</p>
            <p><strong>Total Amount:</strong> ${debitNote.totalAmount}</p>
            <p>Debit Note Date: ${new Date(debitNote.debitNoteDate).toLocaleDateString()}</p>
            <br>
            <p>Best Regards,<br>Your Company</p>
          `,
        });
      } catch (emailErr) {
        console.error('Failed to send debit note email:', emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    if (handleNumberConflict(res, err, 'debitNoteId')) return;
    console.error('Create debit note error:', err);
    res.status(500).json({
      message: 'Error creating debit note',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getAllDebitNotes
// =============================================================================

interface ListQuery {
  page?: string;
  limit?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function getAllDebitNotes(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      status,
      startDate,
      endDate,
      search = '',
    } = req.query as ListQuery;

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.DebitNoteWhereInput = { userId, isDeleted: false };
    if (status && VALID_STATUSES.has(status as DebitNoteStatus)) {
      where.status = status as DebitNoteStatus;
    }
    if (startDate || endDate) {
      where.debitNoteDate = {};
      if (startDate) (where.debitNoteDate as Prisma.DateTimeFilter).gte = new Date(startDate);
      if (endDate) (where.debitNoteDate as Prisma.DateTimeFilter).lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { debitNoteId: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { signatureName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.debitNote.count({ where }),
      prisma.debitNote.findMany({
        where,
        include: {
          supplier: {
            select: {
              id: true,
              supplier_name: true,
              supplier_email: true,
              supplier_phone: true,
              profileImage: true,
            },
          },
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              organisation: true,
              email: true,
              mobile: true,
            },
          },
          purchase: { select: { id: true, purchaseId: true, purchaseDate: true, totalAmount: true } },
          createdByUser: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
          approvedByUser: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
          paymentMode: { select: { id: true, name: true, slug: true, status: true } },
        },
        orderBy: { debitNoteDate: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    const baseUrl = process.env.BASE_URL || '';

    const formattedDebitNotes = rows.map((note) => {
      // Contact-aware: prefer contact (new path) over legacy supplier.
      const vendor = note.contact
        ? {
            id: note.contact.id,
            name: resolveDisplayName(note.contact),
            email: note.contact.email ?? null,
            phone: note.contact.mobile ?? null,
            profileImage: '',
          }
        : note.supplier
          ? {
              id: note.supplier.id,
              name: note.supplier.supplier_name,
              email: note.supplier.supplier_email || null,
              phone: note.supplier.supplier_phone || null,
              profileImage: note.supplier.profileImage ? `${baseUrl}/${note.supplier.profileImage}` : '',
            }
          : null;

      const purchase = note.purchase
        ? {
            id: note.purchase.id,
            purchaseId: note.purchase.purchaseId || null,
            purchaseDate: formatDateShort(note.purchase.purchaseDate),
            totalAmount: Number(note.purchase.totalAmount) || 0,
          }
        : null;

      const createdBy = note.createdByUser
        ? {
            id: note.createdByUser.id,
            name: `${note.createdByUser.firstName || ''} ${note.createdByUser.lastName || ''}`.trim(),
            profileImage: note.createdByUser.profileImage ? `${baseUrl}${note.createdByUser.profileImage}` : null,
          }
        : null;

      const approvedBy = note.approvedByUser
        ? {
            id: note.approvedByUser.id,
            name: `${note.approvedByUser.firstName || ''} ${note.approvedByUser.lastName || ''}`.trim(),
            profileImage: note.approvedByUser.profileImage ? `${baseUrl}${note.approvedByUser.profileImage}` : null,
          }
        : null;

      const paymentMode = note.paymentMode
        ? {
            id: note.paymentMode.id,
            name: note.paymentMode.name,
            slug: note.paymentMode.slug,
            status: note.paymentMode.status,
          }
        : null;

      return {
        id: note.id,
        debitNoteId: note.debitNoteId,
        referenceNo: note.referenceNo || null,
        vendor,
        purchase,
        debitNoteDate: formatDateShort(note.debitNoteDate),
        status: note.status,
        totalAmount: Number(note.totalAmount),
        paidAmount: Number(note.paidAmount ?? 0),
        balanceAmount: Number(note.balanceAmount ?? 0),
        paymentMode,
        sign_type: note.sign_type || 'none',
        signatureName: note.signatureName || null,
        signatureImage: note.signatureImage ? `${baseUrl}${note.signatureImage}` : null,
        notes: note.notes || null,
        currencyCode: note.currencyCode ?? null, // C.1
        taxTreatment: note.taxTreatment ?? null, // C.2
        createdBy,
        approvedBy,
        createdAt: formatDateShort(note.createdAt),
        updatedAt: formatDateShort(note.updatedAt),
      };
    });

    res.status(200).json({
      success: true,
      message: 'Debit notes retrieved successfully',
      data: {
        debitNotes: formattedDebitNotes,
        pagination: {
          total,
          page: pageN,
          limit: limitN,
          totalPages: Math.ceil(total / limitN),
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get all debit notes error:', err);
    res.status(500).json({
      success: false,
      message: 'Error retrieving debit notes',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getDebitNoteById
// =============================================================================

export async function getDebitNoteById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const debitNote = await prisma.debitNote.findFirst({
      where: { id, userId },
      include: {
        supplier: {
          select: {
            id: true,
            supplier_name: true,
            supplier_email: true,
            supplier_phone: true,
          },
        },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            vatRegNumber: true,
            gstin: true,
          },
        },
        purchase: { select: { id: true, purchaseId: true, purchaseDate: true, totalAmount: true } },
        createdByUser: { select: { id: true, firstName: true, lastName: true } },
        approvedByUser: { select: { id: true, firstName: true, lastName: true } },
        bank: { select: { id: true, bankName: true, accountNumber: true, branchName: true } },
        paymentMode: { select: { id: true, name: true, slug: true, status: true } },
      },
    });

    if (!debitNote || debitNote.isDeleted) {
      res.status(404).json({ success: false, message: 'Debit note not found' });
      return;
    }

    const baseUrl = process.env.BASE_URL || '';

    // Contact-aware: prefer contact (new path) over legacy supplier.
    const vendor = debitNote.contact
      ? {
          id: debitNote.contact.id,
          name: resolveDisplayName(debitNote.contact),
          email: debitNote.contact.email ?? null,
          phone: debitNote.contact.mobile ?? null,
          address: null,
          vatRegNumber: debitNote.contact.vatRegNumber ?? null,
          gstin: debitNote.contact.gstin ?? null,
        }
      : debitNote.supplier
        ? {
            id: debitNote.supplier.id,
            name: debitNote.supplier.supplier_name,
            email: debitNote.supplier.supplier_email || null,
            phone: debitNote.supplier.supplier_phone || null,
            address: null,
          }
        : null;

    const purchase = debitNote.purchase
      ? {
          id: debitNote.purchase.id,
          purchaseId: debitNote.purchase.purchaseId || null,
          purchaseDate: formatDateShort(debitNote.purchase.purchaseDate),
          totalAmount: Number(debitNote.purchase.totalAmount) || 0,
        }
      : null;

    const bank = debitNote.bank
      ? {
          id: debitNote.bank.id,
          bankName: debitNote.bank.bankName || null,
          accountNumber: debitNote.bank.accountNumber || null,
          branch: debitNote.bank.branchName || null,
        }
      : null;

    const paymentMode = debitNote.paymentMode
      ? {
          id: debitNote.paymentMode.id,
          name: debitNote.paymentMode.name,
          slug: debitNote.paymentMode.slug,
          status: debitNote.paymentMode.status,
        }
      : null;

    const createdBy = debitNote.createdByUser
      ? {
          id: debitNote.createdByUser.id,
          name: `${debitNote.createdByUser.firstName || ''} ${debitNote.createdByUser.lastName || ''}`.trim(),
        }
      : null;

    const approvedBy = debitNote.approvedByUser
      ? {
          id: debitNote.approvedByUser.id,
          name: `${debitNote.approvedByUser.firstName || ''} ${debitNote.approvedByUser.lastName || ''}`.trim(),
        }
      : null;

    const rawItems = Array.isArray(debitNote.items) ? (debitNote.items as unknown as StoredItem[]) : [];
    const items = rawItems.map((item) => ({
      product: item.productId
        ? {
            id: item.productId,
            name: item.name || null,
            sku: null,
            barcode: null,
          }
        : null,
      quantity: item.quantity || 0,
      rate: item.rate || 0,
      discount: item.discount || 0,
      discount_type: item.discount_type || 'Fixed',
      discount_value: item.discount_value || 0,
      tax: item.tax || 0,
      amount: item.amount || 0,
      reason: item.reason || null,
      taxGroup: item.tax_group_id
        ? {
            id: item.tax_group_id,
            name: null,
            rate: 0,
          }
        : null,
    }));

    const formattedDebitNote = {
      id: debitNote.id,
      debitNoteId: debitNote.debitNoteId,
      referenceNo: debitNote.referenceNo || null,
      vendor,
      purchase,
      debitNoteDate: formatDateShort(debitNote.debitNoteDate),
      dueDate: formatDateShort(debitNote.dueDate),
      status: debitNote.status || null,
      taxableAmount: Number(debitNote.taxableAmount) || 0,
      totalDiscount: Number(debitNote.totalDiscount ?? 0),
      totalTax: Number(debitNote.totalTax ?? 0),
      totalAmount: Number(debitNote.totalAmount) || 0,
      paidAmount: Number(debitNote.paidAmount ?? 0),
      balanceAmount: Number(debitNote.balanceAmount ?? 0),
      paymentMode,
      bank,
      notes: debitNote.notes || null,
      termsAndCondition: debitNote.termsAndCondition || null,
      sign_type: debitNote.sign_type || 'none',
      signatureId: debitNote.signatureId || null,
      signatureImage: debitNote.signatureImage ? `${baseUrl}${debitNote.signatureImage}` : null,
      signatureName: debitNote.signatureName || null,
      checkNumber: debitNote.checkNumber || null,
      currencyCode: debitNote.currencyCode ?? null, // C.1
      taxTreatment: debitNote.taxTreatment ?? null, // C.2
      items,
      createdBy,
      approvedBy,
      createdAt: formatDateShort(debitNote.createdAt),
      updatedAt: formatDateShort(debitNote.updatedAt),
    };

    res.status(200).json({
      success: true,
      message: 'Debit note retrieved successfully',
      data: formattedDebitNote,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get debit note by ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Error retrieving debit note',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateDebitNoteStatus
// =============================================================================

export async function updateDebitNoteStatus(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.debitNote.findFirst({ where: { id, userId } });
    if (!existing || existing.isDeleted) {
      res.status(404).json({ success: false, message: 'Debit note not found' });
      return;
    }

    const status = body.status as DebitNoteStatus;
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ success: false, message: 'Invalid status' });
      return;
    }

    const signType = body.sign_type as SignType | undefined;
    if (signType && !VALID_SIGN_TYPES.has(signType)) {
      res.status(400).json({ success: false, message: 'Invalid signature type' });
      return;
    }

    if (signType === 'eSignature') {
      if (!req.file && !existing.signatureImage) {
        res.status(400).json({ success: false, message: 'Signature image is required for eSignature' });
        return;
      }
      if (!body.signatureName) {
        res.status(400).json({ success: false, message: 'Signature name is required for eSignature' });
        return;
      }
    }

    // Validate approver if requested
    let approvedByConnect: string | undefined;
    if (body.approvedBy || status === ('approved' as unknown as DebitNoteStatus)) {
      const approverId = (body.approvedBy as string) || userId;
      const approver = await prisma.user.findUnique({ where: { id: approverId } });
      if (!approver) {
        res.status(422).json({ success: false, message: 'Invalid approved by user ID' });
        return;
      }
      approvedByConnect = approverId;
    }

    const data: Prisma.DebitNoteUpdateInput = { status };

    if (signType) data.sign_type = signType;
    if (body.signatureName) data.signatureName = body.signatureName as string;
    if (body.signatureId) data.signature = { connect: { id: body.signatureId as string } };
    if (req.file) data.signatureImage = req.file.path;
    if (approvedByConnect) data.approvedByUser = { connect: { id: approvedByConnect } };

    const paidAmount = asNumber(body.paidAmount, 0);
    if (status === 'partially_paid' || status === 'paid') {
      data.paidAmount = toDecimal(paidAmount);
      // C3: use existing taxTreatment-enforced totalAmount as the basis for balance calculation.
      const cdbDN = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
      const dnContactId = existing.contactId;
      let dnContactDefaultTreatment: TaxTreatment | null = null;
      if (dnContactId) {
        const contactRow = (await cdbDN().contact.findFirst({
          where: { id: dnContactId, userId, isDeleted: false },
          select: { defaultTaxTreatment: true },
        } as never)) as { defaultTaxTreatment: TaxTreatment | null } | null;
        if (contactRow) dnContactDefaultTreatment = contactRow.defaultTaxTreatment;
      }
      const docTreatment: TaxTreatment =
        parseTaxTreatment(body.taxTreatment) ??
        (existing.taxTreatment as TaxTreatment | null) ??
        dnContactDefaultTreatment ??
        'STANDARD';
      data.taxTreatment = docTreatment;
      const total = Number(existing.totalAmount);
      data.balanceAmount = toDecimal(total - paidAmount);
    } else if (body.taxTreatment !== undefined) {
      // Persist taxTreatment if explicitly provided even for non-payment status changes.
      const cdbDN = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
      const dnContactId = existing.contactId;
      let dnContactDefaultTreatment: TaxTreatment | null = null;
      if (dnContactId) {
        const contactRow = (await cdbDN().contact.findFirst({
          where: { id: dnContactId, userId, isDeleted: false },
          select: { defaultTaxTreatment: true },
        } as never)) as { defaultTaxTreatment: TaxTreatment | null } | null;
        if (contactRow) dnContactDefaultTreatment = contactRow.defaultTaxTreatment;
      }
      const docTreatment: TaxTreatment =
        parseTaxTreatment(body.taxTreatment) ??
        (existing.taxTreatment as TaxTreatment | null) ??
        dnContactDefaultTreatment ??
        'STANDARD';
      data.taxTreatment = docTreatment;
    }

    // C.1: update currencyCode if provided (freely editable on debit notes)
    if (body.currencyCode !== undefined) {
      data.currencyCode = typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.debitNote.update({
        where: { id },
        data,
        include: {
          approvedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      // P1-4 fix round 1 (Important): a status transition must apply the SAME
      // stock/GL effects createDebitNote's status gate applies at create time —
      // mirrors updatePurchaseStatus's new->stocked / stocked->cancelled handling
      // (Task 6 / P0-4). DebitNote defaults to `new` (schema @default(new)), and
      // this endpoint previously wrote ONLY status/payment/signature fields, so a
      // DN created `new` (no stock/GL — see create's status gate) that was later
      // moved to `completed`/`paid` never decremented inventory or posted GL.
      // DebitNote has no `approvalStatus` field (unlike Purchase), so there is no
      // PENDING maker-checker gate to respect here.
      const prevStatus: DebitNoteStatus = (existing.status as DebitNoteStatus | null) ?? 'new';
      const wasStocked = prevStatus !== 'new' && prevStatus !== 'cancelled';
      const willBeStocked = status !== 'new' && status !== 'cancelled';
      const dnItems = Array.isArray(existing.items) ? (existing.items as unknown as StoredItem[]) : [];

      if (prevStatus !== status && !wasStocked && willBeStocked) {
        // Unstocked (new/cancelled) -> stocked: apply stock_out + post GL, exactly
        // as createDebitNote does when created directly in a stocked status.
        for (const item of dnItems) {
          const productId = item.productId;
          if (!productId || !item.quantity) continue;
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            userId,
            qtyDelta: -item.quantity,
            type: 'stock_out',
            referenceType: 'purchase_return',
            referenceId: id,
          });
        }

        // GL posting: same inventory/expense split strategy as createDebitNote.
        const totalDec = new Prisma.Decimal(String(existing.totalAmount ?? 0));
        const taxDec = new Prisma.Decimal(String(existing.totalTax ?? 0));
        let inventoryNet = new Prisma.Decimal(0);
        for (const item of dnItems) {
          const productId = item.productId;
          if (!productId) continue;
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { item_type: true },
          });
          if (product && product.item_type !== 'Service') {
            inventoryNet = inventoryNet.plus(new Prisma.Decimal(asNumber(item.amount, 0)));
          }
        }
        const maxNet = totalDec.minus(taxDec);
        const clampedInv = inventoryNet.greaterThan(maxNet) ? maxNet : inventoryNet;
        const expenseNet = maxNet.minus(clampedInv);
        // postDebitNoteIssued/gatedPost is idempotent per (userId, sourceType,
        // sourceId, event) — a harmless no-op if a live JE already exists, and a
        // fresh post on a cancelled-origin reactivation after voidDocument freed
        // the slot.
        await postDebitNoteIssued(tx as unknown as PostingTx, {
          userId,
          debitNoteId: id,
          date: existing.debitNoteDate ?? new Date(),
          total: String(existing.totalAmount ?? 0),
          tax: String(existing.totalTax ?? 0),
          inventoryNet: clampedInv.toString(),
          expenseNet: expenseNet.toString(),
        });
      } else if (prevStatus !== status && wasStocked && status === 'cancelled') {
        // Stocked -> cancelled: reverse stock at a valuation-neutral restock cost
        // and void the posted GL entry (mirrors updatePurchaseStatus's cancel
        // branch; voidDocument, not reverseDocument, per the P0-1/P1 pattern).
        for (const item of dnItems) {
          const productId = item.productId;
          const qty = Number(item.quantity ?? 0);
          if (!productId || !qty) continue;
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          const restockUnitCost = await resolveRestockUnitCost(
            tx as unknown as Parameters<typeof resolveRestockUnitCost>[0],
            { productId, userId },
          );
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            userId,
            qtyDelta: qty,
            type: 'stock_in',
            referenceType: 'purchase_return',
            referenceId: id,
            unitCost: restockUnitCost,
          });
        }
        await voidDocument(tx as unknown as PostingTx, {
          userId,
          sourceType: 'DebitNote',
          sourceId: id,
          event: 'issued',
        });
      }
      // Same-status calls and stocked<->stocked transitions (e.g. completed ->
      // paid) are no-ops here — stock/GL were already applied by the prior
      // stocking transition and must not be re-applied.

      return upd;
    });

    const responseData = {
      id: updated.id,
      debitNoteId: updated.debitNoteId,
      status: updated.status,
      approvedBy: updated.approvedByUser
        ? {
            id: updated.approvedByUser.id,
            name: `${updated.approvedByUser.firstName || ''} ${updated.approvedByUser.lastName || ''}`.trim(),
          }
        : null,
      sign_type: updated.sign_type,
      signatureName: updated.signatureName,
      signatureImage: updated.signatureImage
        ? `${process.env.BASE_URL || 'http://127.0.0.1:5000'}/${updated.signatureImage.replace(/\\/g, '/')}`
        : null,
      updatedAt: updated.updatedAt,
    };

    res.status(200).json({
      success: true,
      message: 'Debit note status updated successfully',
      data: responseData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Error updating debit note status:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating debit note status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteDebitNote (soft delete)
// =============================================================================

export async function deleteDebitNote(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.debitNote.findFirst({
      where: { id, userId, isDeleted: false },
    });

    if (!existing) {
      res.status(404).json({ message: 'Debit note not found' });
      return;
    }

    const debitNote = await prisma.$transaction(async (tx) => {
      // Revert inventory: a debit note (purchase return) decremented stock on
      // create, so deleting it must put that stock back (stock_in) for
      // non-Service items — mirror of the create stock_out.
      //
      // Bug 2a/2c: only restore stock that was actually removed. A `new`/`cancelled`
      // note never decremented inventory (see create's status gate), so restoring it
      // would inject phantom stock. And the restock must use a valuation-neutral unit
      // cost (Bug 2c) — the old code passed NO unitCost, so applyStockAdjustment
      // blended the returned qty in at 0.00, diluting WAC and understating future COGS.
      const stockWasApplied = existing.status !== 'new' && existing.status !== 'cancelled';
      if (stockWasApplied) {
        const existingItems = Array.isArray(existing.items)
          ? (existing.items as unknown as { productId?: string; quantity?: number }[])
          : [];
        for (const item of existingItems) {
          const productId = item.productId;
          const qty = Number(item.quantity ?? 0);
          if (!productId || !qty) continue;
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          const restockUnitCost = await resolveRestockUnitCost(
            tx as unknown as Parameters<typeof resolveRestockUnitCost>[0],
            { productId, userId },
          );
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            userId,
            qtyDelta: qty,
            type: 'stock_in',
            referenceType: 'purchase_return',
            referenceId: id,
            unitCost: restockUnitCost,
          });
        }
      }

      // GL: reverse the posted issued entry before soft-deleting
      await reverseDocument(tx as unknown as PostingTx, {
        userId,
        sourceType: 'DebitNote',
        sourceId: id,
        event: 'issued',
      });
      return tx.debitNote.update({
        where: { id },
        data: { isDeleted: true },
      });
    });

    res.status(200).json({
      message: 'Debit note deleted successfully',
      data: debitNote,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Delete debit note error:', err);
    res.status(500).json({
      message: 'Error deleting debit note',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

void tenantScope; // not used directly in this controller; suppresses unused-import warning if any

// CommonJS interop for legacy JS routes
module.exports = {
  createDebitNote,
  getAllDebitNotes,
  getDebitNoteById,
  updateDebitNoteStatus,
  deleteDebitNote,
};
module.exports.createDebitNote = createDebitNote;
module.exports.getAllDebitNotes = getAllDebitNotes;
module.exports.getDebitNoteById = getDebitNoteById;
module.exports.updateDebitNoteStatus = updateDebitNoteStatus;
module.exports.deleteDebitNote = deleteDebitNote;
