import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { CreditNoteStatus, CreditNoteRefundMethod, CreditNoteReason } from '@prisma/client';
import { validationResult } from 'express-validator';
import { resolveDisplayName } from '../../../lib/contacts/contactIdentity';

import { prisma } from '../../../lib/prisma';
import { tenantScope, requireUserId, UnauthorizedError } from '../../../lib/tenantScope';
import {
  nextDocumentNumber,
  withDocumentNumberRetry,
  handleNumberConflict,
  type NumberingModel,
} from '../../../lib/documentNumbering';
import { applyDocumentTreatment } from '../../../lib/tax/applyTreatment';
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
  postCreditNoteIssued,
  postReturnCogs,
  reverseDocument,
  voidDocument,
  type PostingTx,
} from '../../../lib/ledger/ledgerPosting';
import { ZERO } from '../../../lib/ledger/money';
import { recomputeInvoiceStatus } from '../../../lib/invoiceOutstanding';
import { applyStockAdjustment, resolveRestockUnitCost } from '../../../lib/inventory/stockAdjust';
import {
  computeDocumentTotals,
  resolveItemTaxRates,
  warnOnTotalsDivergence,
  type TotalsItem,
  type TaxGroupLookupDb,
} from '../../../lib/documentTotals';
import { sanitizeLineCustomFields } from '../../../lib/lineCustomFields';

// utils/mailer is still JS; static require is fine here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailerModule: { sendMail: (opts: Record<string, unknown>) => Promise<void> } = require('../../../utils/mailer');

type Tx = Prisma.TransactionClient;

const VALID_STATUSES = new Set<CreditNoteStatus>(['PENDING', 'PAID', 'CANCELLED']);

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

function buildBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}/`;
}

function formatDateShort(d: Date | null | undefined): string | null {
  if (!d) return null;
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleString('default', { month: 'short' });
  return `${day}, ${month} ${d.getFullYear()}`;
}

interface IncomingItem {
  id?: string;
  name?: string;
  unit?: string;
  qty?: number;
  rate?: number;
  discount?: number;
  tax?: number;
  tax_group_id?: string;
  amount?: number;
  discount_type?: string;
  discount_value?: number;
  customFields?: unknown;
}

function normaliseItems(raw: unknown): IncomingItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as IncomingItem[]).map((item) => ({
    id: item.id,
    name: item.name ?? '',
    unit: item.unit ?? '',
    qty: asNumber(item.qty, 0),
    rate: asNumber(item.rate, 0),
    discount: asNumber(item.discount, 0),
    tax: asNumber(item.tax, 0),
    tax_group_id: item.tax_group_id,
    amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
    discount_type: item.discount_type,
    discount_value: asNumber(item.discount_value, 0),
    customFields: sanitizeLineCustomFields(item.customFields),
  }));
}

function generateNextCreditNoteNumber(tx: Tx, userId: string): Promise<string> {
  return nextDocumentNumber({
    model: tx.creditNote as unknown as NumberingModel,
    field: 'creditNoteNumber',
    prefix: 'CN-',
    tenantWhere: { userId },
  });
}

// =============================================================================
// createCreditNote
// =============================================================================

export async function createCreditNote(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const userId = requireUserId(req);
    const body = req.body as Record<string, unknown>;
    const items = normaliseItems(body.items);

    const invoiceId = body.invoiceId as string;
    const billFromId = body.billFrom as string;

    // Contact-aware party resolution:
    // - New path: body.contactId provided → tenant-scoped ownership check, write contactId/billToContactId, null legacy fields
    // - Legacy path: body.billTo/customerId provided → keep them, back-resolve contactId via legacyCustomerId
    // - At least one party is required (400 if neither)
    const incomingContactId = typeof body.contactId === 'string' && body.contactId ? body.contactId : null;
    const legacyBillToId = (body.billTo as string | undefined) ?? null;

    if (!incomingContactId && !legacyBillToId) {
      res.status(400).json({ success: false, message: 'A contact (or billTo for legacy) is required' });
      return;
    }

    const cdb = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;

    let resolvedContactId: string | null = incomingContactId;
    let resolvedBillToContactId: string | null = incomingContactId;
    let resolvedCustomerId: string | null = null;
    let resolvedBillTo: string | null = null;
    let billToCustomer: { id: string; name: string; email: string; phone?: string | null } | null = null;
    // C2: defaultTaxTreatment from the resolved primary contact
    let contactDefaultTaxTreatment: TaxTreatment | null = null;

    if (incomingContactId) {
      // New contact-based path: verify the contact belongs to this tenant
      const ownedContact = (await cdb().contact.findFirst({
        where: { id: incomingContactId, userId, isDeleted: false },
        select: { id: true, defaultTaxTreatment: true },
      } as never)) as { id: string; defaultTaxTreatment: TaxTreatment | null } | null;
      if (!ownedContact) {
        res.status(404).json({ success: false, message: 'Contact not found' });
        return;
      }
      contactDefaultTaxTreatment = ownedContact.defaultTaxTreatment;
      // Leave resolvedCustomerId / resolvedBillTo as null (new path)
    } else if (legacyBillToId) {
      // Legacy path: validate the customer exists and keep legacy ids
      const legacyCustomer = await prisma.customer.findFirst({ where: { id: legacyBillToId, userId } });
      if (!legacyCustomer) {
        res.status(404).json({ message: 'Bill To customer not found' });
        return;
      }
      billToCustomer = { id: legacyCustomer.id, name: legacyCustomer.name, email: legacyCustomer.email, phone: legacyCustomer.phone };
      resolvedCustomerId = legacyBillToId;
      resolvedBillTo = legacyBillToId;
      // Back-resolve contactId from legacyCustomerId
      const contactRow = (await cdb().contact.findFirst({
        where: { legacyCustomerId: legacyBillToId, userId, isDeleted: false },
        select: { id: true, defaultTaxTreatment: true },
      } as never)) as { id: string; defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) {
        resolvedContactId = contactRow.id;
        resolvedBillToContactId = contactRow.id;
        contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
      } else {
        resolvedContactId = null;
        resolvedBillToContactId = null;
      }
    }

    // Tenant scope: findFirst with { id, userId } (findUnique can't carry extra
    // filters). Guard the falsy id explicitly — an undefined id in findFirst
    // would silently drop the filter and match an arbitrary tenant invoice.
    const [invoice, billFromUser] = await Promise.all([
      invoiceId ? prisma.invoice.findFirst({ where: { id: invoiceId, userId } }) : Promise.resolve(null),
      prisma.user.findUnique({ where: { id: billFromId } }),
    ]);

    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    if (!billFromUser) {
      res.status(404).json({ message: 'Bill From user not found' });
      return;
    }

    const signType = (body.sign_type as string) ?? 'none';
    let signatureImage: string | null = null;
    let signatureId: string | null = null;
    if (signType === 'eSignature' && req.file) signatureImage = req.file.path;
    if (signType === 'digitalSignature' && body.signatureId) signatureId = body.signatureId as string;

    const status = ((body.status as string) ?? 'PENDING') as CreditNoteStatus;
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ message: `Invalid status: ${status}` });
      return;
    }

    // C.1: credit note defaults to the related invoice's currency (per spec), then company default.
    const docCurrencyCode =
      (typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null) ??
      invoice.currencyCode ??
      (await resolveDefaultCurrencyCode());

    // C2: per-document tax treatment.
    const docTreatment: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ?? contactDefaultTaxTreatment ?? 'STANDARD';

    // Server-authoritative totals: credit-note lines carry a flat `tax` amount +
    // tax_group_id (same shape as debit notes), so resolve the group's rate then
    // recompute subTotal/discount/tax/grandTotal on the discounted base. Credit
    // notes POST GL (issued + COGS) and REDUCE AR from the persisted totals, so
    // client-sent subTotal/totalTax/grandTotal are ignored (compare + warn only)
    // — a spoofed grandTotal can no longer drive the GL/AR.
    const itemsWithRates = await resolveItemTaxRates(prisma as unknown as TaxGroupLookupDb, items as unknown as TotalsItem[]);
    const serverTotals = computeDocumentTotals(itemsWithRates);
    warnOnTotalsDivergence('creditNote', 'new', asNumber(body.grandTotal, NaN), serverTotals.grandTotal);
    const finalTaxable = serverTotals.subTotal;
    const finalDiscount = serverTotals.totalDiscount;
    const finalVat = serverTotals.totalTax;

    // Apply treatment: STANDARD is a pass-through; suppressing treatments zero out tax + item taxes.
    // IncomingItem has 'tax' but not 'totalTax'/'taxes'; cast satisfies the generic constraint.
    const enforcedCN = applyDocumentTreatment(docTreatment, finalVat, items as { totalTax?: number; taxes?: { amount?: number }[] | null }[]);
    const enforcedVat = enforcedCN.tax;
    const enforcedItems = enforcedCN.items;
    // Grand total is always server-derived (subTotal − discount + enforced tax).
    const enforcedTotal = docTreatment === 'STANDARD' ? serverTotals.grandTotal : finalTaxable + enforcedVat - finalDiscount;

    const creditNote = await withDocumentNumberRetry('creditNoteNumber', () => prisma.$transaction(async (tx) => {
      const creditNoteNumber = await generateNextCreditNoteNumber(tx, userId);
      const created = await tx.creditNote.create({
        data: {
          creditNoteNumber,
          invoiceId,
          customerId: resolvedCustomerId,
          ...(resolvedContactId ? { contactId: resolvedContactId } : {}),
          ...(resolvedBillToContactId ? { billToContactId: resolvedBillToContactId } : {}),
          creditNoteDate: safeDate(body.creditNoteDate) ?? new Date(),
          referenceNo: (body.referenceNo as string) ?? '',
          reason: ((body.reason as string) ?? 'OTHER') as CreditNoteReason,
          description: (body.description as string) ?? '',
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          status,
          refund_method: ((body.refund_method as string) ?? 'CREDIT_TO_ACCOUNT') as CreditNoteRefundMethod,
          taxableAmount: toDecimal(finalTaxable),
          totalAmount: toDecimal(enforcedTotal),
          vat: toDecimal(enforcedVat),
          totalDiscount: toDecimal(finalDiscount),
          roundOff: Boolean(body.roundOff),
          bankId: (body.bank as string) || null,
          notes: (body.notes as string) ?? '',
          termsAndCondition: (body.termsAndCondition as string) ?? '',
          sign_type: signType as 'none' | 'digitalSignature' | 'eSignature',
          signatureName: signType === 'eSignature' ? ((body.signatureName as string) ?? null) : null,
          signatureImage,
          signatureId,
          billFrom: billFromId,
          billTo: resolvedBillTo,
          userId,
          taxTreatment: docTreatment,
          // C.1: persist document currency
          ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
          // Task 2: record which invoice this CN reduces (invoice is required above).
          appliedToInvoice: invoiceId,
          appliedDate: new Date(),
        },
      });

      // B.4: restock inventory (sales return → stock ↑) and accumulate return COGS for GL.
      // Credit note items use item.id as the product identifier.
      let totalReturnCost = ZERO;
      for (const item of items) {
        const productId = item.id;
        if (!productId || !item.qty) continue;
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { item_type: true },
        });
        if (product?.item_type === 'Service') continue;
        // Compute return COGS from pre-adjustment avgCost (GL unchanged). For FIFO
        // products avgCost is not maintained (0), so return COGS stays 0 — matching
        // the documented v1 limitation that FIFO sales book COGS = 0 at the GL.
        const inv = await tx.inventory.findFirst({ where: { productId, userId, isDeleted: false } });
        if (inv) {
          const returnCost = inv.avgCost.times(new Prisma.Decimal(item.qty));
          totalReturnCost = totalReturnCost.plus(returnCost);
        }
        // Bug 3: restock returned units at a valuation-neutral cost.
        //   WAC  → current avgCost (blend no-op, avgCost unchanged).
        //   FIFO → most-recent layer cost — NOT avgCost, which is 0/stale for FIFO
        //          and would create a 0-cost layer the next sale consumes at 0.
        // Delegate all DB writes to helper: updates legacy quantity + quantityOnHand
        // + history. Helper auto-creates the row if absent.
        const restockUnitCost = await resolveRestockUnitCost(
          tx as unknown as Parameters<typeof resolveRestockUnitCost>[0],
          { productId, userId },
        );
        await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
          productId,
          userId: requireUserId(req),
          qtyDelta: item.qty,
          type: 'stock_in',
          referenceType: 'sales_return',
          referenceId: created.id,
          unitCost: restockUnitCost,
        });
      }

      // GL posting (gated — no-op if ledger not initialised or doc is pre-cutover)
      // FX: relieve AR at the rate the linked invoice originally booked it. The
      // credit note defaults to the invoice's currency, so the invoice's document
      // rate is the correct rate to reduce the receivable by (base = amount × rate).
      // Without this the AR credit posts at rate 1 and never clears the FX base.
      const cnExchangeRate =
        docCurrencyCode && invoice.currencyCode && docCurrencyCode === invoice.currencyCode
          ? invoice.exchangeRate ?? undefined
          : undefined;
      await postCreditNoteIssued(tx as unknown as PostingTx, {
        userId,
        creditNoteId: created.id,
        date: created.creditNoteDate ?? new Date(),
        total: String(created.totalAmount),
        tax: String(created.vat ?? 0),
        ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
        ...(cnExchangeRate != null ? { exchangeRate: cnExchangeRate } : {}),
      });
      // B.4: reverse COGS for returned inventory items (Dr INVENTORY / Cr COGS).
      await postReturnCogs(tx as unknown as PostingTx, {
        userId,
        creditNoteId: created.id,
        date: created.creditNoteDate ?? new Date(),
        cost: totalReturnCost.toString(),
      });

      // Task 2: reflect the new credit note in the linked invoice's due/status.
      await recomputeInvoiceStatus(tx, invoiceId, userId);

      return created;
    }));

    res.status(201).json({ message: 'Credit note created successfully', data: creditNote });

    // Optional email (best-effort; billToCustomer is null on the contact path so guard it)
    if (billToCustomer && billToCustomer.email && process.env.SMTP_EMAIL) {
      try {
        await mailerModule.sendMail({
          to: billToCustomer.email,
          subject: `Credit Note Issued (Ref: ${creditNote.creditNoteNumber})`,
          html: `
            <h3>Hello ${billToCustomer.name},</h3>
            <p>A new credit note has been issued.</p>
            <p><strong>Credit Note:</strong> ${creditNote.creditNoteNumber}</p>
            <p><strong>Total Amount:</strong> ${creditNote.totalAmount}</p>
            <p><strong>Reason:</strong> ${creditNote.reason}</p>
            <p><strong>Status:</strong> ${creditNote.status}</p>
          `,
        });
      } catch (emailErr) {
        console.error('Credit note email send failed:', emailErr);
      }
    }
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    if (handleNumberConflict(res, err, 'creditNoteNumber')) return;
    console.error('Create credit note error:', err);
    res.status(500).json({ message: 'Error creating credit note', error: err instanceof Error ? err.message : String(err) });
  }
}

// =============================================================================
// getAllCreditNotes
// =============================================================================

interface ListQuery {
  page?: string;
  limit?: string;
  status?: string;
  search?: string;
  customerId?: string;
  invoiceId?: string;
  startDate?: string;
  endDate?: string;
  refund_method?: string;
}

export async function getAllCreditNotes(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { page = '1', limit = '10', status, search = '', customerId, invoiceId, startDate, endDate, refund_method } =
      req.query as ListQuery;
    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.CreditNoteWhereInput = { userId, isDeleted: false };
    if (status && VALID_STATUSES.has(status as CreditNoteStatus)) where.status = status as CreditNoteStatus;
    if (customerId) where.customerId = customerId;
    if (invoiceId) where.invoiceId = invoiceId;
    if (refund_method) where.refund_method = refund_method as CreditNoteRefundMethod;
    if (startDate || endDate) {
      where.creditNoteDate = {};
      if (startDate) (where.creditNoteDate as Prisma.DateTimeFilter).gte = new Date(startDate);
      if (endDate) (where.creditNoteDate as Prisma.DateTimeFilter).lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { creditNoteNumber: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const baseUrl = buildBaseUrl(req);

    const [total, rows] = await Promise.all([
      prisma.creditNote.count({ where }),
      prisma.creditNote.findMany({
        where,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true, TotalAmount: true, status: true } },
          customer: { select: { id: true, name: true, email: true, phone: true, image: true, billingAddress: true } },
          billFromUser: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, profileImage: true, address: true } },
          billToCustomer: { select: { id: true, name: true, email: true, phone: true, billingAddress: true, shippingAddress: true, image: true } },
          contact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
          billToContact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
          appliedToInvoiceRel: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
          bank: { select: { id: true, accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    // Next credit note number (tenant-scoped — numbering must not leak across tenants)
    const last = await prisma.creditNote.findFirst({
      where: { creditNoteNumber: { not: null }, userId },
      orderBy: { creditNoteNumber: 'desc' },
      select: { creditNoteNumber: true },
    });
    let nextCreditNoteNumber = 'CN-000001';
    if (last?.creditNoteNumber) {
      const m = last.creditNoteNumber.match(/(\D*)(\d+)$/);
      if (m) nextCreditNoteNumber = `${m[1]}${String(parseInt(m[2], 10) + 1).padStart(6, '0')}`;
    }

    const formatted = rows.map((note) => {
      // Prefer contact for customer display; fallback to legacy customer when no contact
      const customer = note.contact
        ? {
            id: note.contact.id,
            name: resolveDisplayName(note.contact),
            email: note.contact.email ?? null,
            phone: note.contact.mobile ?? null,
            billingAddress: null,
            image: '',
          }
        : note.customer
        ? {
            id: note.customer.id,
            name: note.customer.name || '',
            email: note.customer.email || null,
            phone: note.customer.phone || null,
            billingAddress: note.customer.billingAddress || null,
            image: note.customer.image ? `${baseUrl}${note.customer.image.replace(/\\/g, '/')}` : '',
          }
        : null;
      const billFrom = note.billFromUser
        ? {
            id: note.billFromUser.id,
            name: `${note.billFromUser.firstName || ''} ${note.billFromUser.lastName || ''}`.trim(),
            email: note.billFromUser.email || null,
            phone: note.billFromUser.phone || null,
            address: note.billFromUser.address || null,
            image: note.billFromUser.profileImage ? `${baseUrl}${note.billFromUser.profileImage.replace(/\\/g, '/')}` : '',
          }
        : null;
      const billTo = note.billToContact
        ? {
            id: note.billToContact.id,
            name: resolveDisplayName(note.billToContact),
            email: note.billToContact.email ?? null,
            phone: note.billToContact.mobile ?? null,
            billingAddress: null,
            shippingAddress: null,
            image: '',
          }
        : note.billToCustomer
        ? {
            id: note.billToCustomer.id,
            name: note.billToCustomer.name || '',
            email: note.billToCustomer.email || null,
            phone: note.billToCustomer.phone || null,
            billingAddress: note.billToCustomer.billingAddress || null,
            shippingAddress: note.billToCustomer.shippingAddress || null,
            image: note.billToCustomer.image ? `${baseUrl}${note.billToCustomer.image.replace(/\\/g, '/')}` : '',
          }
        : null;
      const invoice = note.invoice
        ? {
            id: note.invoice.id,
            invoiceNumber: note.invoice.invoiceNumber,
            invoiceDate: formatDateShort(note.invoice.invoiceDate),
            totalAmount: note.invoice.TotalAmount,
            status: note.invoice.status,
          }
        : null;
      const appliedToInvoice = note.appliedToInvoiceRel
        ? {
            id: note.appliedToInvoiceRel.id,
            invoiceNumber: note.appliedToInvoiceRel.invoiceNumber,
            invoiceDate: formatDateShort(note.appliedToInvoiceRel.invoiceDate),
          }
        : null;
      const bank = note.bank
        ? {
            accountHoldername: note.bank.accountHoldername || '',
            bankName: note.bank.bankName || '',
            branchName: note.bank.branchName || '',
            accountNumber: note.bank.accountNumber || '',
            IFSCCode: note.bank.IFSCCode || '',
          }
        : null;
      let signature: Record<string, unknown> | null = null;
      if (note.sign_type === 'eSignature') {
        signature = {
          name: note.signatureName || null,
          image: note.signatureImage ? `${baseUrl}${note.signatureImage.replace(/\\/g, '/')}` : null,
        };
      } else if (note.sign_type === 'digitalSignature') {
        signature = { signatureId: note.signatureId || null };
      }
      const itemsCount = Array.isArray(note.items) ? note.items.length : 0;
      return {
        id: note.id,
        creditNoteNumber: note.creditNoteNumber,
        referenceNo: note.referenceNo,
        reason: note.reason,
        description: note.description,
        creditNoteDate: formatDateShort(note.creditNoteDate),
        status: note.status,
        refund_method: note.refund_method,
        taxableAmount: note.taxableAmount,
        totalDiscount: note.totalDiscount,
        vat: note.vat,
        totalAmount: note.totalAmount,
        roundOff: note.roundOff,
        items: note.items,
        itemsCount,
        customer,
        contactId: note.contactId ?? null,
        billToContactId: note.billToContactId ?? null,
        invoice,
        billFrom,
        billTo,
        appliedToInvoice,
        appliedDate: formatDateShort(note.appliedDate),
        bank,
        notes: note.notes,
        termsAndCondition: note.termsAndCondition,
        sign_type: note.sign_type,
        signature,
        currencyCode: note.currencyCode ?? null, // C.1
        taxTreatment: note.taxTreatment ?? null, // C.2
        createdAt: formatDateShort(note.createdAt),
        updatedAt: formatDateShort(note.updatedAt),
      };
    });

    res.status(200).json({
      success: true,
      message: 'Credit notes retrieved successfully',
      data: {
        creditNotes: formatted,
        nextCreditNoteNumber,
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
    console.error('List credit notes error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching credit notes',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getCreditNoteById
// =============================================================================

export async function getCreditNoteById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const baseUrl = buildBaseUrl(req);

    const note = await prisma.creditNote.findFirst({
      where: { id, userId },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            dueDate: true,
            TotalAmount: true,
            taxableAmount: true,
            vat: true,
            totalDiscount: true,
            items: true,
            status: true,
          },
        },
        customer: { select: { id: true, name: true, email: true, phone: true, billingAddress: true, shippingAddress: true, image: true } },
        billFromUser: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, profileImage: true, address: true } },
        billToCustomer: { select: { id: true, name: true, email: true, phone: true, billingAddress: true, shippingAddress: true, image: true } },
        contact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true, vatRegNumber: true, gstin: true } },
        billToContact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true, vatRegNumber: true, gstin: true } },
        appliedToInvoiceRel: { select: { id: true, invoiceNumber: true, invoiceDate: true, TotalAmount: true } },
        bank: { select: { id: true, accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true } },
        signature: { select: { id: true, signatureName: true, signatureImage: true, createdAt: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!note || note.isDeleted) {
      res.status(404).json({ success: false, message: 'Credit note not found' });
      return;
    }

    let signature: Record<string, unknown> | null = null;
    if (note.sign_type === 'eSignature') {
      signature = {
        name: note.signatureName || null,
        image: note.signatureImage ? `${baseUrl}${note.signatureImage.replace(/\\/g, '/')}` : null,
      };
    } else if (note.sign_type === 'digitalSignature' && note.signature) {
      signature = {
        id: note.signature.id,
        name: note.signature.signatureName || null,
        image: note.signature.signatureImage ? `${baseUrl}${note.signature.signatureImage.replace(/\\/g, '/')}` : null,
        createdAt: formatDateShort(note.signature.createdAt),
      };
    }

    const response = {
      id: note.id,
      creditNoteNumber: note.creditNoteNumber,
      referenceNo: note.referenceNo,
      reason: note.reason,
      description: note.description,
      creditNoteDate: note.creditNoteDate,
      status: note.status,
      refund_method: note.refund_method,
      taxableAmount: note.taxableAmount,
      totalDiscount: note.totalDiscount,
      vat: note.vat,
      totalAmount: note.totalAmount,
      roundOff: note.roundOff,
      items: note.items,
      itemsCount: Array.isArray(note.items) ? note.items.length : 0,
      // Prefer contact for customer field; fallback to legacy customer
      customer: note.contact
        ? {
            id: note.contact.id,
            name: resolveDisplayName(note.contact),
            email: note.contact.email ?? null,
            phone: note.contact.mobile ?? null,
            image: '',
            billingAddress: null,
            vatRegNumber: note.contact.vatRegNumber ?? null,
            gstin: note.contact.gstin ?? null,
          }
        : note.customer,
      contactId: note.contactId ?? null,
      invoice: note.invoice,
      billFrom: note.billFromUser,
      billTo: note.billToContact
        ? {
            id: note.billToContact.id,
            name: resolveDisplayName(note.billToContact),
            email: note.billToContact.email ?? null,
            phone: note.billToContact.mobile ?? null,
            image: '',
            billingAddress: null,
            vatRegNumber: note.billToContact.vatRegNumber ?? null,
            gstin: note.billToContact.gstin ?? null,
          }
        : note.billToCustomer,
      billToContactId: note.billToContactId ?? null,
      appliedToInvoice: note.appliedToInvoiceRel,
      appliedDate: note.appliedDate,
      bank: note.bank,
      notes: note.notes,
      termsAndCondition: note.termsAndCondition,
      sign_type: note.sign_type,
      signature,
      currencyCode: note.currencyCode ?? null, // C.1
      taxTreatment: note.taxTreatment ?? null, // C.2
      createdBy: note.user,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };

    res.status(200).json({ success: true, message: 'Credit note retrieved successfully', data: response });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get credit note by ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching credit note details',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateCreditNote
// =============================================================================

export async function updateCreditNote(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.creditNote.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ message: 'Credit Note not found' });
      return;
    }

    // C3: resolve contact's defaultTaxTreatment (tenant-scoped) if available.
    const cdbCN = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
    const cnContactId = existing.contactId;
    let cnContactDefaultTreatment: TaxTreatment | null = null;
    if (cnContactId) {
      const contactRow = (await cdbCN().contact.findFirst({
        where: { id: cnContactId, userId, isDeleted: false },
        select: { defaultTaxTreatment: true },
      } as never)) as { defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) cnContactDefaultTreatment = contactRow.defaultTaxTreatment;
    }
    const docTreatment: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ??
      (existing.taxTreatment as TaxTreatment | null) ??
      cnContactDefaultTreatment ??
      'STANDARD';

    if (body.billFrom) {
      const billFromUser = await prisma.user.findUnique({ where: { id: body.billFrom as string } });
      if (!billFromUser) {
        res.status(404).json({ message: 'Bill From user not found' });
        return;
      }
    }
    // Contact-first party resolution (mirrors invoiceController.updateInvoice).
    // The contact-first picker sends a Contact id in body.billTo; writing that
    // into the Customer FK columns (customerId/billTo) violates the Customer FK
    // -> P2003 500. Resolve to the CORRECT scalar columns instead. Scalar FKs are
    // collected in partyUpdate and spread into the update call.
    const partyUpdate: {
      contactId?: string | null;
      billToContactId?: string | null;
      customerId?: string | null;
      billTo?: string | null;
    } = {};
    {
      const incomingContactId =
        typeof body.contactId === 'string' && body.contactId ? body.contactId : null;
      const incomingBillToContactId =
        typeof body.billToContactId === 'string' && body.billToContactId ? body.billToContactId : null;
      const incomingLegacyCustomerId =
        (typeof body.billTo === 'string' && body.billTo ? body.billTo : null) ??
        (typeof body.customerId === 'string' && body.customerId ? body.customerId : null);

      if (incomingContactId) {
        const ownedContact = (await cdbCN().contact.findFirst({
          where: { id: incomingContactId, userId, isDeleted: false },
          select: { id: true },
        } as never)) as { id: string } | null;
        if (!ownedContact) {
          res.status(404).json({ success: false, message: 'Contact not found' });
          return;
        }
        const billToContactId = incomingBillToContactId ?? incomingContactId;
        if (incomingBillToContactId && incomingBillToContactId !== incomingContactId) {
          const ownedBillTo = (await cdbCN().contact.findFirst({
            where: { id: incomingBillToContactId, userId, isDeleted: false },
            select: { id: true },
          } as never)) as { id: string } | null;
          if (!ownedBillTo) {
            res.status(404).json({ success: false, message: 'Contact not found' });
            return;
          }
        }
        partyUpdate.contactId = incomingContactId;
        partyUpdate.billToContactId = billToContactId;
        partyUpdate.customerId = null;
        partyUpdate.billTo = null;
      } else if (incomingLegacyCustomerId) {
        const contactRow = (await cdbCN().contact.findFirst({
          where: {
            userId,
            isDeleted: false,
            OR: [
              { legacyCustomerId: incomingLegacyCustomerId },
              { id: incomingLegacyCustomerId },
            ],
          },
          select: { id: true },
        } as never)) as { id: string } | null;
        if (contactRow) {
          partyUpdate.contactId = contactRow.id;
          partyUpdate.billToContactId = contactRow.id;
          partyUpdate.customerId = null;
          partyUpdate.billTo = null;
        } else {
          const ownedCustomer = (await cdbCN().customer.findFirst({
            where: { id: incomingLegacyCustomerId, userId },
            select: { id: true },
          } as never)) as { id: string } | null;
          if (!ownedCustomer) {
            res.status(400).json({ success: false, message: 'Customer or contact not found for the selected party.' });
            return;
          }
          partyUpdate.customerId = incomingLegacyCustomerId;
          partyUpdate.billTo = incomingLegacyCustomerId;
          partyUpdate.contactId = null;
          partyUpdate.billToContactId = null;
        }
      }
    }

    const data: Prisma.CreditNoteUpdateInput = { user: { connect: { id: userId } } };

    if (body.creditNoteDate !== undefined) data.creditNoteDate = safeDate(body.creditNoteDate) ?? existing.creditNoteDate;
    if (body.referenceNo !== undefined) data.referenceNo = (body.referenceNo as string) ?? existing.referenceNo;
    if (body.reason !== undefined) data.reason = body.reason as CreditNoteReason;
    if (body.description !== undefined) data.description = (body.description as string) ?? existing.description;
    // Server-authoritative totals: updateCreditNote void+re-posts a LIVE GL/AR
    // entry, so the persisted subTotal/discount/tax/grandTotal MUST be recomputed
    // from the line items — never trusted from the client body. Recompute from the
    // incoming items (or the stored items when the edit omits them), resolving the
    // tax-group rate on the discounted base exactly like createCreditNote.
    {
      const haveItems = body.items !== undefined;
      const items = haveItems ? normaliseItems(body.items) : normaliseItems(existing.items);
      const itemsWithRates = await resolveItemTaxRates(prisma as unknown as TaxGroupLookupDb, items as unknown as TotalsItem[]);
      const serverTotals = computeDocumentTotals(itemsWithRates);
      warnOnTotalsDivergence('creditNote', id, asNumber(body.grandTotal, NaN), serverTotals.grandTotal);

      const suppliedTaxable = serverTotals.subTotal;
      const suppliedDiscount = serverTotals.totalDiscount;
      const suppliedVat = serverTotals.totalTax;

      const enforcedCN = applyDocumentTreatment(docTreatment, suppliedVat, items as { totalTax?: number; taxes?: { amount?: number }[] | null }[]);
      const enforcedVat = enforcedCN.tax;
      const enforcedTotal = docTreatment === 'STANDARD' ? serverTotals.grandTotal : suppliedTaxable + enforcedVat - suppliedDiscount;

      data.items = enforcedCN.items as unknown as Prisma.InputJsonValue;
      data.taxableAmount = toDecimal(suppliedTaxable);
      data.totalDiscount = toDecimal(suppliedDiscount);
      data.vat = toDecimal(enforcedVat);
      data.totalAmount = toDecimal(enforcedTotal);
    }
    if (body.refund_method !== undefined) data.refund_method = body.refund_method as CreditNoteRefundMethod;
    if (body.roundOff !== undefined) data.roundOff = Boolean(body.roundOff);
    if (body.bank !== undefined) {
      if (body.bank) data.bank = { connect: { id: body.bank as string } };
      else data.bank = { disconnect: true };
    }
    if (body.notes !== undefined) data.notes = (body.notes as string) ?? '';
    if (body.termsAndCondition !== undefined) data.termsAndCondition = (body.termsAndCondition as string) ?? '';
    if (body.sign_type !== undefined) data.sign_type = body.sign_type as 'none' | 'digitalSignature' | 'eSignature';
    if (body.billFrom !== undefined) data.billFromUser = { connect: { id: body.billFrom as string } };
    // Party (contact-first) FKs resolved above into partyUpdate; spread at update().
    if (body.status !== undefined) {
      const next = body.status as CreditNoteStatus;
      if (VALID_STATUSES.has(next)) data.status = next;
    }

    if (body.sign_type === 'eSignature' && req.file) {
      data.signatureImage = req.file.path;
      data.signatureName = (body.signatureName as string) ?? null;
      data.signature = { disconnect: true };
    } else if (body.sign_type === 'digitalSignature' && body.signatureId) {
      data.signature = { connect: { id: body.signatureId as string } };
      data.signatureImage = null;
      data.signatureName = null;
    }

    // C3: persist taxTreatment on every update.
    data.taxTreatment = docTreatment;

    // C.1: update currencyCode if provided (freely editable on credit notes)
    if (body.currencyCode !== undefined) {
      data.currencyCode = typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null;
    }

    // Task 2: keep the applied-invoice linkage set (invoiceId is immutable on edit).
    data.appliedToInvoiceRel = { connect: { id: existing.invoiceId } };
    data.appliedDate = existing.appliedDate ?? new Date();

    // `data` is a CHECKED CreditNoteUpdateInput (relation connects for user/bank/
    // signature), so the resolved party must be written as RELATIONS, not scalar
    // FKs — spreading scalar contactId/customerId mixes shapes and Prisma rejects
    // it ("Unknown argument contactId"). Translate partyUpdate -> relations.
    if (partyUpdate.contactId !== undefined)
      data.contact = partyUpdate.contactId ? { connect: { id: partyUpdate.contactId } } : { disconnect: true };
    if (partyUpdate.billToContactId !== undefined)
      data.billToContact = partyUpdate.billToContactId ? { connect: { id: partyUpdate.billToContactId } } : { disconnect: true };
    if (partyUpdate.customerId !== undefined)
      data.customer = partyUpdate.customerId ? { connect: { id: partyUpdate.customerId } } : { disconnect: true };
    if (partyUpdate.billTo !== undefined)
      data.billToCustomer = partyUpdate.billTo ? { connect: { id: partyUpdate.billTo } } : { disconnect: true };

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.creditNote.update({
        where: { id },
        data,
      });

      // GL: void the prior issued entry then re-post with updated amounts
      await voidDocument(tx as unknown as PostingTx, {
        userId,
        sourceType: 'CreditNote',
        sourceId: id,
        event: 'issued',
      });
      // FX: re-post AR relief at the linked invoice's document rate (mirrors create).
      const linkedInvoice = await tx.invoice.findFirst({
        where: { id: existing.invoiceId, userId },
        select: { currencyCode: true, exchangeRate: true },
      });
      const updExchangeRate =
        upd.currencyCode && linkedInvoice?.currencyCode && upd.currencyCode === linkedInvoice.currencyCode
          ? linkedInvoice.exchangeRate ?? undefined
          : undefined;
      await postCreditNoteIssued(tx as unknown as PostingTx, {
        userId,
        creditNoteId: id,
        date: upd.creditNoteDate ?? new Date(),
        total: String(upd.totalAmount),
        tax: String(upd.vat ?? 0),
        ...(upd.currencyCode ? { currencyCode: upd.currencyCode } : {}),
        ...(updExchangeRate != null ? { exchangeRate: updExchangeRate } : {}),
      });
      // B.4: void the prior COGS entry alongside the issued void.
      await voidDocument(tx as unknown as PostingTx, {
        userId,
        sourceType: 'CreditNote',
        sourceId: id,
        event: 'cogs',
      });
      // B.4: re-post return COGS at current average cost (best-effort; qty not re-adjusted on edit).
      {
        const updatedItems = normaliseItems(upd.items);
        let returnCost = new Prisma.Decimal(0);
        for (const item of updatedItems) {
          const productId = item.id;
          if (!productId || !item.qty) continue;
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          const inv = await tx.inventory.findFirst({ where: { productId, userId, isDeleted: false } });
          if (!inv) continue;
          returnCost = returnCost.plus(inv.avgCost.times(new Prisma.Decimal(item.qty)));
        }
        await postReturnCogs(tx as unknown as PostingTx, {
          userId,
          creditNoteId: id,
          date: upd.creditNoteDate ?? new Date(),
          cost: returnCost.toString(),
        });
      }

      // Task 2: the edit may change the CN total (or status) → re-derive invoice due.
      await recomputeInvoiceStatus(tx, existing.invoiceId, userId);

      return upd;
    });
    res.status(200).json({ message: 'Credit note updated successfully', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Update credit note error:', err);
    res.status(500).json({
      message: 'Error updating credit note',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteCreditNote (HARD delete — matches the JS original)
// =============================================================================

export async function deleteCreditNote(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.creditNote.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ message: 'Credit Note not found' });
      return;
    }
    await prisma.$transaction(async (tx) => {
      // GL: reverse the posted issued entry before hard-deleting
      await reverseDocument(tx as unknown as PostingTx, {
        userId,
        sourceType: 'CreditNote',
        sourceId: id,
        event: 'issued',
      });
      // B.4: reverse the COGS entry alongside the issued reversal.
      await reverseDocument(tx as unknown as PostingTx, {
        userId,
        sourceType: 'CreditNote',
        sourceId: id,
        event: 'cogs',
      });

      // Reverse the restock createCreditNote performed. A credit note is a sales
      // return, so create booked a stock_in of the returned qty; the GL reversals
      // above leave inventory permanently overstated (and re-deletable) unless we
      // stock_out the same qty here. Mirror create exactly: only stockable items
      // (a productId + qty, item_type !== 'Service'), at the current avgCost.
      const items = normaliseItems(existing.items);
      for (const item of items) {
        const productId = item.id;
        if (!productId || !item.qty) continue;
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { item_type: true },
        });
        if (product?.item_type === 'Service') continue;
        const inv = await tx.inventory.findFirst({
          where: { productId, userId, isDeleted: false },
        });
        await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
          productId,
          userId,
          qtyDelta: -item.qty,
          type: 'stock_out',
          referenceType: 'sales_return',
          referenceId: id,
          unitCost: inv ? inv.avgCost.toNumber() : 0,
        });
      }

      await tx.creditNote.delete({ where: { id } });

      // Task 2: the CN no longer reduces AR → recompute the linked invoice's due.
      // The row is hard-deleted, so getInvoiceSettlement naturally stops netting it.
      await recomputeInvoiceStatus(tx, existing.invoiceId, userId);
    });
    res.status(200).json({ message: 'Credit note deleted successfully', id });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Delete credit note error:', err);
    res.status(500).json({
      message: 'Error deleting credit note',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

void tenantScope; // not used directly in this controller; suppresses unused-import warning if any

// CommonJS interop for legacy JS routes
module.exports = {
  createCreditNote,
  getAllCreditNotes,
  getCreditNoteById,
  updateCreditNote,
  deleteCreditNote,
};
module.exports.createCreditNote = createCreditNote;
module.exports.getAllCreditNotes = getAllCreditNotes;
module.exports.getCreditNoteById = getCreditNoteById;
module.exports.updateCreditNote = updateCreditNote;
module.exports.deleteCreditNote = deleteCreditNote;
