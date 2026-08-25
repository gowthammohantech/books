import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { DeliveryChallanStatus } from '@prisma/client';
import { validationResult } from 'express-validator';

import { prisma } from '../../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../../lib/tenantScope';
import { resolveDisplayName } from '../../../lib/contacts/contactIdentity';
import { applyDocumentTreatment } from '../../../lib/tax/applyTreatment';
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

type Tx = Prisma.TransactionClient;

const VALID_STATUSES = new Set<DeliveryChallanStatus>(['PENDING', 'DELIVERED', 'CANCELLED', 'DRAFT']);

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
    tax_group_id: item.tax_group_id ?? undefined,
    amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
    discount_type: item.discount_type ?? 'Fixed',
    discount_value: asNumber(item.discount_value, 0),
    customFields: sanitizeLineCustomFields(item.customFields),
  }));
}

async function generateNextChallanNumber(tx: Tx): Promise<string> {
  const last = await tx.deliveryChallan.findFirst({
    where: { challanNumber: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { challanNumber: true },
  });
  let lastNumber = 0;
  if (last?.challanNumber) {
    const match = last.challanNumber.match(/\d+$/);
    if (match) lastNumber = parseInt(match[0], 10);
  }
  return `DC-${String(lastNumber + 1).padStart(6, '0')}`;
}

// =============================================================================
// createDeliveryChallan
// =============================================================================

export async function createDeliveryChallan(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const userId = requireUserId(req);
    const body = req.body as Record<string, unknown>;
    const items = normaliseItems(body.items);

    const billFromId = body.billFrom as string;

    // Contact-aware party resolution:
    // - New path: body.contactId provided → tenant-scoped ownership check, write contactId/billToContactId, null the legacy fields
    // - Legacy path: body.billTo/customerId provided → keep them, back-resolve contactId via legacyCustomerId
    // - At least one of contactId or billTo/customerId is required (400 if neither).
    const incomingContactId = typeof body.contactId === 'string' && body.contactId ? body.contactId : null;
    const legacyCustomerId = (body.billTo as string | undefined) ?? (body.customerId as string | undefined) ?? null;

    if (!incomingContactId && !legacyCustomerId) {
      res.status(400).json({ success: false, message: 'A contactId or a customer (billTo/customerId) is required.' });
      return;
    }

    let resolvedContactId: string | null = incomingContactId;
    let resolvedBillToContactId: string | null = incomingContactId;
    let resolvedCustomerId: string | null = null;
    let resolvedBillTo: string | null = null;
    // C2: defaultTaxTreatment from the resolved primary contact
    let contactDefaultTaxTreatment: TaxTreatment | null = null;

    const cdb = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;

    if (incomingContactId) {
      const ownedContact = await cdb().contact.findFirst({
        where: { id: incomingContactId, userId, isDeleted: false },
        select: { id: true, defaultTaxTreatment: true },
      } as never) as { id: string; defaultTaxTreatment: TaxTreatment | null } | null;
      if (!ownedContact) {
        res.status(404).json({ success: false, message: 'Contact not found' });
        return;
      }
      contactDefaultTaxTreatment = ownedContact.defaultTaxTreatment;
    } else if (legacyCustomerId) {
      resolvedCustomerId = legacyCustomerId;
      resolvedBillTo = legacyCustomerId;
      const contactRow = await cdb().contact.findFirst({
        where: { legacyCustomerId, userId, isDeleted: false },
        select: { id: true, defaultTaxTreatment: true },
      } as never) as { id: string; defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) {
        resolvedContactId = contactRow.id;
        resolvedBillToContactId = contactRow.id;
        contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
      }
    }

    // billFrom is a User FK — validate it
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const signType = (body.sign_type as string) ?? 'none';
    let signatureImage: string | null = null;
    let signatureId: string | null = null;
    if (signType === 'eSignature' && req.file) signatureImage = req.file.path;
    if (signType === 'digitalSignature' && body.signatureId) signatureId = body.signatureId as string;

    const status = ((body.status as string) ?? 'PENDING') as DeliveryChallanStatus;
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ message: `Invalid status: ${status}` });
      return;
    }

    // C.1: per-document currency — use caller-supplied code or fall back to company default.
    const docCurrencyCode =
      (typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null) ??
      (await resolveDefaultCurrencyCode());

    // C2: per-document tax treatment.
    const docTreatment: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ?? contactDefaultTaxTreatment ?? 'STANDARD';

    // Compute supplied totals before enforcement.
    const finalTaxable = asNumber(body.subTotal, asNumber(body.taxableAmount, 0));
    const finalDiscount = asNumber(body.totalDiscount, 0);
    const finalVat = asNumber(body.totalTax, asNumber(body.vat, 0));
    const finalTotal = asNumber(body.grandTotal, asNumber(body.totalAmount, 0));

    // Apply treatment: STANDARD is a pass-through; suppressing treatments zero out tax + item taxes.
    // IncomingItem has 'tax' but not 'totalTax'/'taxes'; cast satisfies the generic constraint.
    const enforcedChallan = applyDocumentTreatment(docTreatment, finalVat, items as { totalTax?: number; taxes?: { amount?: number }[] | null }[]);
    const enforcedVat = enforcedChallan.tax;
    const enforcedItems = enforcedChallan.items;
    // Recompute totalAmount when tax was suppressed.
    const enforcedTotal = docTreatment === 'STANDARD' ? finalTotal : finalTaxable + enforcedVat - finalDiscount;

    const challan = await prisma.$transaction(async (tx) => {
      const challanNumber = await generateNextChallanNumber(tx);
      return tx.deliveryChallan.create({
        data: {
          challanNumber,
          invoiceId: (body.invoiceId as string) || null,
          customerId: resolvedCustomerId,
          ...(resolvedContactId ? { contactId: resolvedContactId } : {}),
          ...(resolvedBillToContactId ? { billToContactId: resolvedBillToContactId } : {}),
          challanDate: safeDate(body.challanDate) ?? new Date(),
          referenceNo: (body.referenceNo as string) ?? '',
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          status,
          bankId: (body.bank as string) || null,
          taxableAmount: toDecimal(finalTaxable),
          totalAmount: toDecimal(enforcedTotal),
          vat: toDecimal(enforcedVat),
          totalDiscount: toDecimal(finalDiscount),
          roundOff: Boolean(body.roundOff),
          notes: (body.notes as string) ?? '',
          termsAndCondition: (body.termsAndCondition as string) ?? '',
          sign_type: signType as 'none' | 'digitalSignature' | 'eSignature',
          signatureName: signType === 'eSignature' ? ((body.signatureName as string) ?? null) : null,
          signatureImage,
          signatureId,
          receivedBy: (body.receivedBy as string) ?? '',
          userId,
          billFrom: billFromId,
          billTo: resolvedBillTo,
          taxTreatment: docTreatment,
          // C.1: persist document currency
          ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
        },
      });
    });

    res.status(201).json({ message: 'Delivery challan created successfully', data: challan });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Create delivery challan error:', err);
    res.status(500).json({
      message: 'Error creating delivery challan',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateDeliveryStatus
// =============================================================================

export async function updateDeliveryStatus(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const { id } = req.params as { id: string };
    const { status, receivedBy, receivedDate } = req.body as {
      status?: string;
      receivedBy?: string;
      receivedDate?: string;
    };

    const existing = await prisma.deliveryChallan.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Delivery challan not found' });
      return;
    }

    const next = (status ?? '').toUpperCase() as DeliveryChallanStatus;
    if (!VALID_STATUSES.has(next)) {
      res.status(400).json({ message: `Invalid status: ${status}` });
      return;
    }

    const data: Prisma.DeliveryChallanUpdateInput = { status: next };
    if (next === 'DELIVERED') {
      data.receivedBy = receivedBy ?? '';
      data.receivedDate = safeDate(receivedDate) ?? new Date();
    } else if (next === 'CANCELLED') {
      data.receivedBy = '';
      data.receivedDate = null;
    }

    const updated = await prisma.deliveryChallan.update({ where: { id }, data });
    res.status(200).json({ message: 'Delivery status updated successfully', data: updated });
  } catch (err) {
    console.error('Update delivery status error:', err);
    res.status(500).json({
      message: 'Error updating delivery status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateDeliveryChallan
// =============================================================================

export async function updateDeliveryChallan(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.deliveryChallan.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Delivery challan not found' });
      return;
    }

    // C3: resolve contact's defaultTaxTreatment (tenant-scoped) if available.
    const cdbDC = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
    const dcContactId = existing.contactId;
    let dcContactDefaultTreatment: TaxTreatment | null = null;
    if (dcContactId) {
      const contactRow = (await cdbDC().contact.findFirst({
        where: { id: dcContactId, userId, isDeleted: false },
        select: { defaultTaxTreatment: true },
      } as never)) as { defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) dcContactDefaultTreatment = contactRow.defaultTaxTreatment;
    }
    const docTreatment: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ??
      (existing.taxTreatment as TaxTreatment | null) ??
      dcContactDefaultTreatment ??
      'STANDARD';

    let signatureImage = existing.signatureImage;
    let signatureId = existing.signatureId;
    if (body.sign_type === 'eSignature' && req.file) {
      signatureImage = req.file.path;
      signatureId = null;
    } else if (body.sign_type === 'digitalSignature' && body.signatureId) {
      signatureId = body.signatureId as string;
      signatureImage = null;
    }

    const data: Prisma.DeliveryChallanUpdateInput = {};
    if (body.invoiceId !== undefined) {
      if (body.invoiceId) data.invoice = { connect: { id: body.invoiceId as string } };
      else data.invoice = { disconnect: true };
    }
    // Contact-first party resolution (mirrors invoiceController.updateInvoice).
    // The contact-first picker sends a Contact id in body.billTo; writing that
    // into the Customer FK columns (customerId/billTo) violates the Customer FK
    // -> P2003 500. Resolve to the CORRECT scalar columns instead. Scalar FKs are
    // collected in partyUpdate and spread into the update call (the surrounding
    // `data` uses relation-style writes for other fields).
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
        const ownedContact = (await cdbDC().contact.findFirst({
          where: { id: incomingContactId, userId, isDeleted: false },
          select: { id: true },
        } as never)) as { id: string } | null;
        if (!ownedContact) {
          res.status(404).json({ success: false, message: 'Contact not found' });
          return;
        }
        const billToContactId = incomingBillToContactId ?? incomingContactId;
        if (incomingBillToContactId && incomingBillToContactId !== incomingContactId) {
          const ownedBillTo = (await cdbDC().contact.findFirst({
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
        const contactRow = (await cdbDC().contact.findFirst({
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
          const ownedCustomer = (await cdbDC().customer.findFirst({
            where: { id: incomingLegacyCustomerId },
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
    if (body.billFrom !== undefined) data.billFromUser = { connect: { id: body.billFrom as string } };
    if (body.challanDate !== undefined) data.challanDate = safeDate(body.challanDate) ?? existing.challanDate;
    if (body.referenceNo !== undefined) data.referenceNo = (body.referenceNo as string) ?? '';
    // C3: collect items + totals, apply treatment enforcement together.
    {
      const haveItems = body.items !== undefined;
      const haveVat = body.totalTax !== undefined || body.vat !== undefined;
      const haveTotal = body.grandTotal !== undefined || body.totalAmount !== undefined;
      const haveTaxable = body.subTotal !== undefined || body.taxableAmount !== undefined;

      const items = haveItems ? normaliseItems(body.items) : null;
      const suppliedVat = haveVat
        ? asNumber(body.totalTax, asNumber(body.vat, Number(existing.vat ?? 0)))
        : Number(existing.vat ?? 0);
      const suppliedTotal = haveTotal
        ? asNumber(body.grandTotal, asNumber(body.totalAmount, Number(existing.totalAmount ?? 0)))
        : Number(existing.totalAmount ?? 0);
      const suppliedTaxable = haveTaxable
        ? asNumber(body.subTotal, asNumber(body.taxableAmount, Number(existing.taxableAmount ?? 0)))
        : Number(existing.taxableAmount ?? 0);
      const suppliedDiscount = body.totalDiscount !== undefined
        ? asNumber(body.totalDiscount, Number(existing.totalDiscount ?? 0))
        : Number(existing.totalDiscount ?? 0);

      const effectiveItems = items ?? (existing.items as unknown as { totalTax?: number; taxes?: { amount?: number }[] | null }[]) ?? [];
      const enforcedDC = applyDocumentTreatment(docTreatment, suppliedVat, effectiveItems as { totalTax?: number; taxes?: { amount?: number }[] | null }[]);
      const enforcedVat = enforcedDC.tax;
      const enforcedTotal = docTreatment === 'STANDARD' ? suppliedTotal : suppliedTaxable + enforcedVat - suppliedDiscount;

      if (haveItems) data.items = enforcedDC.items as unknown as Prisma.InputJsonValue;
      if (haveTaxable) data.taxableAmount = toDecimal(suppliedTaxable);
      if (haveVat || docTreatment !== 'STANDARD') data.vat = toDecimal(enforcedVat);
      if (haveTotal || docTreatment !== 'STANDARD') data.totalAmount = toDecimal(enforcedTotal);
      if (body.totalDiscount !== undefined) data.totalDiscount = toDecimal(suppliedDiscount);
    }
    if (body.status !== undefined) {
      const next = body.status as DeliveryChallanStatus;
      if (VALID_STATUSES.has(next)) data.status = next;
    }
    if (body.bank !== undefined) {
      if (body.bank) data.bank = { connect: { id: body.bank as string } };
      else data.bank = { disconnect: true };
    }
    if (body.roundOff !== undefined) data.roundOff = Boolean(body.roundOff);
    if (body.notes !== undefined) data.notes = (body.notes as string) ?? '';
    if (body.termsAndCondition !== undefined) data.termsAndCondition = (body.termsAndCondition as string) ?? '';
    if (body.sign_type !== undefined) data.sign_type = body.sign_type as 'none' | 'digitalSignature' | 'eSignature';
    data.signatureName = body.sign_type === 'eSignature' ? ((body.signatureName as string) ?? null) : null;
    data.signatureImage = signatureImage;
    if (signatureId) data.signature = { connect: { id: signatureId } };
    else if (body.sign_type === 'eSignature') data.signature = { disconnect: true };
    if (body.receivedBy !== undefined) data.receivedBy = (body.receivedBy as string) ?? '';
    // C3: persist taxTreatment on every update.
    data.taxTreatment = docTreatment;
    // C.1: update currencyCode if provided (freely editable on delivery challans)
    if (body.currencyCode !== undefined) {
      data.currencyCode = typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null;
    }

    // `data` is a CHECKED update input (relation connects for billFromUser/bank/
    // signature), so the resolved party must be written as RELATIONS — mixing
    // scalar FKs with relation writes makes Prisma reject the call.
    if (partyUpdate.contactId !== undefined)
      data.contact = partyUpdate.contactId ? { connect: { id: partyUpdate.contactId } } : { disconnect: true };
    if (partyUpdate.billToContactId !== undefined)
      data.billToContact = partyUpdate.billToContactId ? { connect: { id: partyUpdate.billToContactId } } : { disconnect: true };
    if (partyUpdate.customerId !== undefined)
      data.customer = partyUpdate.customerId ? { connect: { id: partyUpdate.customerId } } : { disconnect: true };
    if (partyUpdate.billTo !== undefined)
      data.billToCustomer = partyUpdate.billTo ? { connect: { id: partyUpdate.billTo } } : { disconnect: true };

    const updated = await prisma.deliveryChallan.update({
      where: { id },
      data,
    });
    res.status(200).json({ message: 'Delivery challan updated successfully', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Update delivery challan error:', err);
    res.status(500).json({
      message: 'Error updating delivery challan',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getDeliveryChallans
// =============================================================================

interface ListQuery {
  page?: string;
  limit?: string;
  status?: string;
  search?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
}

export async function getDeliveryChallans(req: Request, res: Response): Promise<void> {
  try {
    const { page = '1', limit = '10', status, search = '', customerId, startDate, endDate } = req.query as ListQuery;
    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.DeliveryChallanWhereInput = { isDeleted: false };
    if (status && VALID_STATUSES.has(status as DeliveryChallanStatus)) where.status = status as DeliveryChallanStatus;
    if (customerId) where.customerId = customerId;
    if (startDate || endDate) {
      where.challanDate = {};
      if (startDate) (where.challanDate as Prisma.DateTimeFilter).gte = new Date(startDate);
      if (endDate) (where.challanDate as Prisma.DateTimeFilter).lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { challanNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const baseUrl = buildBaseUrl(req);

    const contactSelect = { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } };

    const [total, rows] = await Promise.all([
      prisma.deliveryChallan.count({ where }),
      prisma.deliveryChallan.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true, image: true, billingAddress: true } },
          billFromUser: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, profileImage: true, address: true } },
          billToCustomer: { select: { id: true, name: true, email: true, phone: true, billingAddress: true, shippingAddress: true, image: true } },
          contact: contactSelect,
          billToContact: contactSelect,
          invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true, TotalAmount: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    const formatted = rows.map((challan) => {
      // Prefer contact for customer display; fall back to legacy customer
      const contactForDisplay = challan.contact
        ? {
            id: challan.contact.id,
            name: resolveDisplayName(challan.contact),
            email: challan.contact.email ?? null,
            phone: challan.contact.mobile ?? null,
            image: '',
            billingAddress: null,
          }
        : null;
      const customer = contactForDisplay ?? (challan.customer
        ? {
            id: challan.customer.id,
            name: challan.customer.name || '',
            email: challan.customer.email || null,
            phone: challan.customer.phone || null,
            billingAddress: challan.customer.billingAddress || null,
            image: challan.customer.image ? `${baseUrl}${challan.customer.image.replace(/\\/g, '/')}` : '',
          }
        : null);
      const billFrom = challan.billFromUser
        ? {
            id: challan.billFromUser.id,
            name: `${challan.billFromUser.firstName || ''} ${challan.billFromUser.lastName || ''}`.trim(),
            email: challan.billFromUser.email || null,
            phone: challan.billFromUser.phone || null,
            address: challan.billFromUser.address || null,
            image: challan.billFromUser.profileImage ? `${baseUrl}${challan.billFromUser.profileImage.replace(/\\/g, '/')}` : '',
          }
        : null;
      // Prefer billToContact for billTo display; fall back to legacy billToCustomer
      const billToContactForDisplay = challan.billToContact
        ? {
            id: challan.billToContact.id,
            name: resolveDisplayName(challan.billToContact),
            email: challan.billToContact.email ?? null,
            phone: challan.billToContact.mobile ?? null,
            image: '',
            billingAddress: null,
          }
        : null;
      const billTo = billToContactForDisplay ?? (challan.billToCustomer
        ? {
            id: challan.billToCustomer.id,
            name: challan.billToCustomer.name || '',
            email: challan.billToCustomer.email || null,
            phone: challan.billToCustomer.phone || null,
            billingAddress: challan.billToCustomer.billingAddress || null,
            shippingAddress: challan.billToCustomer.shippingAddress || null,
            image: challan.billToCustomer.image ? `${baseUrl}${challan.billToCustomer.image.replace(/\\/g, '/')}` : '',
          }
        : null);
      const invoice = challan.invoice
        ? {
            id: challan.invoice.id,
            invoiceNumber: challan.invoice.invoiceNumber,
            invoiceDate: formatDateShort(challan.invoice.invoiceDate),
            totalAmount: challan.invoice.TotalAmount,
            status: challan.invoice.status,
          }
        : null;
      const itemsCount = Array.isArray(challan.items) ? challan.items.length : 0;
      return {
        id: challan.id,
        challanNumber: challan.challanNumber,
        referenceNo: challan.referenceNo,
        challanDate: challan.challanDate,
        status: challan.status,
        notes: challan.notes,
        taxableAmount: challan.taxableAmount,
        totalDiscount: challan.totalDiscount,
        vat: challan.vat,
        totalAmount: challan.totalAmount,
        items: challan.items,
        itemsCount,
        contactId: challan.contactId ?? null,
        customer,
        billFrom,
        billTo,
        invoice,
        currencyCode: challan.currencyCode ?? null, // C.1
        taxTreatment: challan.taxTreatment ?? null, // C.2
        createdAt: challan.createdAt,
        updatedAt: challan.updatedAt,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Delivery challans retrieved successfully',
      data: {
        deliveryChallans: formatted,
        pagination: {
          total,
          page: pageN,
          limit: limitN,
          totalPages: Math.ceil(total / limitN),
        },
      },
    });
  } catch (err) {
    console.error('Get delivery challans error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching delivery challans',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getDeliveryChallanById
// =============================================================================

export async function getDeliveryChallanById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const baseUrl = buildBaseUrl(req);

    const contactSelectById = { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } };

    const challan = await prisma.deliveryChallan.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, billingAddress: true, shippingAddress: true, image: true } },
        billFromUser: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, profileImage: true, address: true } },
        billToCustomer: { select: { id: true, name: true, email: true, phone: true, billingAddress: true, shippingAddress: true, image: true } },
        contact: contactSelectById,
        billToContact: contactSelectById,
        invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true, TotalAmount: true, status: true } },
        bank: { select: { id: true, accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true } },
        signature: { select: { id: true, signatureName: true, signatureImage: true, createdAt: true } },
      },
    });

    if (!challan || challan.isDeleted) {
      res.status(404).json({ success: false, message: 'Delivery challan not found' });
      return;
    }

    // Prefer contact for display; fall back to legacy customer
    const customerForDisplay = challan.contact
      ? {
          id: challan.contact.id,
          name: resolveDisplayName(challan.contact),
          email: challan.contact.email ?? null,
          phone: challan.contact.mobile ?? null,
          image: '',
          billingAddress: null,
          shippingAddress: null,
        }
      : challan.customer ?? null;

    // Prefer billToContact for display; fall back to legacy billToCustomer
    const billToForDisplay = challan.billToContact
      ? {
          id: challan.billToContact.id,
          name: resolveDisplayName(challan.billToContact),
          email: challan.billToContact.email ?? null,
          phone: challan.billToContact.mobile ?? null,
          image: '',
          billingAddress: null,
          shippingAddress: null,
        }
      : challan.billToCustomer ?? null;

    let signature: Record<string, unknown> | null = null;
    if (challan.sign_type === 'eSignature') {
      signature = {
        name: challan.signatureName || null,
        image: challan.signatureImage ? `${baseUrl}${challan.signatureImage.replace(/\\/g, '/')}` : null,
      };
    } else if (challan.sign_type === 'digitalSignature' && challan.signature) {
      signature = {
        id: challan.signature.id,
        name: challan.signature.signatureName || null,
        image: challan.signature.signatureImage ? `${baseUrl}${challan.signature.signatureImage.replace(/\\/g, '/')}` : null,
        createdAt: formatDateShort(challan.signature.createdAt),
      };
    }

    res.status(200).json({
      success: true,
      message: 'Delivery challan retrieved successfully',
      data: {
        id: challan.id,
        challanNumber: challan.challanNumber,
        referenceNo: challan.referenceNo,
        challanDate: formatDateShort(challan.challanDate),
        status: challan.status,
        notes: challan.notes || '',
        termsAndCondition: challan.termsAndCondition || '',
        items: challan.items || [],
        itemsCount: Array.isArray(challan.items) ? challan.items.length : 0,
        contactId: challan.contactId ?? null,
        customer: customerForDisplay,
        billFrom: challan.billFromUser,
        billTo: billToForDisplay,
        invoice: challan.invoice,
        bank: challan.bank,
        sign_type: challan.sign_type,
        signature,
        taxableAmount: challan.taxableAmount,
        totalAmount: challan.totalAmount,
        totalDiscount: challan.totalDiscount,
        vat: challan.vat || '',
        currencyCode: challan.currencyCode ?? null, // C.1
        taxTreatment: challan.taxTreatment ?? null, // C.2
        createdAt: challan.createdAt,
        updatedAt: challan.updatedAt,
      },
    });
  } catch (err) {
    console.error('Get delivery challan error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching delivery challan details',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteDeliveryChallan (soft)
// =============================================================================

export async function deleteDeliveryChallan(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.deliveryChallan.findUnique({ where: { id } });
    if (!existing || existing.isDeleted) {
      res.status(404).json({ message: 'Delivery challan not found' });
      return;
    }
    await prisma.deliveryChallan.update({ where: { id }, data: { isDeleted: true } });
    res.status(200).json({ message: 'Delivery challan deleted successfully' });
  } catch (err) {
    console.error('Delete delivery challan error:', err);
    res.status(500).json({
      message: 'Error deleting delivery challan',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes
module.exports = {
  createDeliveryChallan,
  updateDeliveryStatus,
  updateDeliveryChallan,
  getDeliveryChallans,
  getDeliveryChallanById,
  deleteDeliveryChallan,
};
module.exports.createDeliveryChallan = createDeliveryChallan;
module.exports.updateDeliveryStatus = updateDeliveryStatus;
module.exports.updateDeliveryChallan = updateDeliveryChallan;
module.exports.getDeliveryChallans = getDeliveryChallans;
module.exports.getDeliveryChallanById = getDeliveryChallanById;
module.exports.deleteDeliveryChallan = deleteDeliveryChallan;
