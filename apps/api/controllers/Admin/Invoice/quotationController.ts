import { randomBytes } from 'crypto';

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { Quotation, QuotationStatus, Customer } from '@prisma/client';

import { prisma } from '../../../lib/prisma';
import { resolveDefaultCurrencyCode } from '../../../lib/defaultCurrency';
import { tenantScope, requireTenantId, UnauthorizedError } from '../../../lib/tenantScope';
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
import {
  resolveLineCostCenterId,
  collectCostCentreIds,
  assertCostCentresExist,
  UnknownCostCentreError,
} from '../../../lib/lineDimensions';
import { parseTaxTreatment } from '../../../lib/tax/taxTreatment';
import type { TaxTreatment } from '../../../lib/tax/taxTreatment';
import { sendMail, isEmailConfigured } from '../../../utils/mailer';
import { quotationRepository } from '../../../modules/quotation/quotation.repository';
import {
  buildListWhere,
  deriveNextQuotationId,
  presentDetail,
  presentListRow,
  TRANSITIONABLE_STATUSES,
} from '../../../modules/quotation/quotation.service';

type Tx = Prisma.TransactionClient;

const VALID_STATUSES = new Set<QuotationStatus>(['draft', 'sent', 'accepted', 'declined']);

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

interface IncomingItem {
  costCenterId?: string | null;
  id?: string;
  name?: string;
  unit?: string;
  qty?: number;
  rate?: number;
  discount?: number;
  tax?: number;
  tax_group_id?: string;
  discount_type?: string;
  discount_value?: number;
  amount?: number;
  customFields?: unknown;
}

function normaliseItems(raw: unknown, headerCostCenterId?: string | null): IncomingItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as IncomingItem[]).map((item) => ({
    // Profit centre inheritance resolved once, at write time, so persisted
    // items are always fully resolved for every later reader.
    costCenterId: resolveLineCostCenterId(item.costCenterId, headerCostCenterId ?? null),
    id: item.id,
    name: item.name ?? '',
    unit: item.unit,
    qty: asNumber(item.qty, 0),
    rate: asNumber(item.rate, 0),
    discount: asNumber(item.discount, 0),
    tax: asNumber(item.tax, 0),
    tax_group_id: item.tax_group_id,
    discount_type: item.discount_type,
    discount_value: asNumber(item.discount_value, 0),
    amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
    customFields: sanitizeLineCustomFields(item.customFields),
  }));
}

async function generateNextQuotationId(
  tx: Tx,
  tenantId: string,
  prefix = 'QT-',
): Promise<string> {
  // This tenant's series. It read the INSTALL-WIDE last quotation, so a
  // second company's first quotation would have continued the first
  // company's numbering.
  const last = await tx.quotation.findFirst({
    where: { tenantId, quotationId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { quotationId: true },
  });
  let lastNumber = 0;
  if (last?.quotationId) {
    const match = last.quotationId.match(/\d+$/);
    if (match) lastNumber = parseInt(match[0], 10);
  }
  return `${prefix}${String(lastNumber + 1).padStart(6, '0')}`;
}

// =============================================================================
// createQuotation
// =============================================================================

export async function createQuotation(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const body = req.body as Record<string, unknown>;
    // Resolved before the items so each line can inherit the document centre.
    const docCostCenterId = typeof body.costCenterId === 'string' && body.costCenterId ? body.costCenterId : null;
    const items = normaliseItems(body.items, docCostCenterId);

    // The items JSON carries no foreign key, so a typo'd or cross-tenant centre
    // id on a line would reach the ledger unnoticed. One query covers the
    // header and every line.
    try {
      await assertCostCentresExist(prisma, tenantId, collectCostCentreIds(docCostCenterId, items));
    } catch (centreErr) {
      if (centreErr instanceof UnknownCostCentreError) {
        res.status(400).json({ success: false, message: centreErr.message, errors: { costCenterId: centreErr.message } });
        return;
      }
      throw centreErr;
    }

    const billFromId = body.billFrom as string;

    // Contact-aware party resolution (mirrors invoiceController pattern):
    // New path: body.contactId → tenant-scoped ownership check, write contactId/billToContactId, null legacy
    // Legacy path: body.billTo/customerId → keep + back-resolve contactId via legacyCustomerId
    const cdb = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;

    const incomingContactId = typeof body.contactId === 'string' && body.contactId ? body.contactId : null;
    const incomingBillToContactId = typeof body.billToContactId === 'string' && body.billToContactId ? body.billToContactId : null;
    const legacyCustomerId = (body.billTo as string | undefined) ?? (body.customerId as string | undefined) ?? null;

    if (!incomingContactId && !legacyCustomerId) {
      res.status(400).json({ success: false, message: 'A contactId or a customer (billTo/customerId) is required.' });
      return;
    }

    let resolvedContactId: string | null = incomingContactId;
    let resolvedBillToContactId: string | null = incomingBillToContactId ?? incomingContactId;
    let resolvedCustomerId: string | null = null;
    let resolvedBillTo: string | null = null;
    // C2: defaultTaxTreatment from the resolved primary contact
    let contactDefaultTaxTreatment: TaxTreatment | null = null;

    if (incomingContactId) {
      const ownedContact = (await cdb().contact.findFirst({
        where: { id: incomingContactId, tenantId, isDeleted: false },
        select: { id: true, defaultTaxTreatment: true },
      } as never)) as { id: string; defaultTaxTreatment: TaxTreatment | null } | null;
      if (!ownedContact) {
        res.status(404).json({ success: false, message: 'Contact not found' });
        return;
      }
      contactDefaultTaxTreatment = ownedContact.defaultTaxTreatment;
      if (incomingBillToContactId && incomingBillToContactId !== incomingContactId) {
        const ownedBillTo = (await cdb().contact.findFirst({
          where: { id: incomingBillToContactId, tenantId, isDeleted: false },
          select: { id: true },
        } as never)) as { id: string } | null;
        if (!ownedBillTo) {
          res.status(404).json({ success: false, message: 'Contact not found' });
          return;
        }
      }
    } else if (legacyCustomerId) {
      resolvedCustomerId = legacyCustomerId;
      resolvedBillTo = legacyCustomerId;
      const contactRow = (await cdb().contact.findFirst({
        where: { legacyCustomerId, tenantId, isDeleted: false },
        select: { id: true, defaultTaxTreatment: true },
      } as never)) as { id: string; defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) {
        resolvedContactId = contactRow.id;
        resolvedBillToContactId = contactRow.id;
        contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
      }
    }

    // billFrom is a User FK — validate it.
    //
    // PRESERVED, NOT ENDORSED: the first lookup asks for a User whose id is the
    // TENANT id. It only succeeds on installs migrated from the single-tenant
    // schema, where a tenant's id was its owner's user id; on a tenant created
    // by the current signup path no such user exists and every create fails
    // with 'Invalid user ID'. Changing it would change which payloads are
    // accepted, so it is left as found and recorded — see the closing report.
    const [user, billFrom] = await Promise.all([
      quotationRepository.findUserById(tenantId),
      quotationRepository.findUserById(billFromId),
    ]);
    // Also fetch legacy billTo customer for email sending (only on legacy path).
    // Tenant-scoped, where it was a bare findUnique by id.
    const billToCustomer = resolvedCustomerId
      ? await quotationRepository.findCustomerById(resolvedCustomerId, tenantId)
      : null;

    if (!user) throw new Error('Invalid user ID');
    if (!billFrom) throw new Error('Invalid bill from user ID');

    const signType = (body.sign_type as string) ?? 'none';
    if (!['none', 'digitalSignature', 'eSignature'].includes(signType)) {
      throw new Error('Invalid signature type');
    }
    if (signType === 'eSignature') {
      if (!req.file) throw new Error('Signature image is required for eSignature');
      if (!body.signatureName) throw new Error('Signature name is required for eSignature');
    }

    // Server-authoritative totals: quotation lines carry a flat `tax` amount +
    // tax_group_id (no per-line percent), so resolve the group's rate then
    // recompute tax on the discounted base. Also fixes the legacy calcTotals bug
    // where the grand total dropped tax and discount (total = taxable only).
    const itemsWithRates = await resolveItemTaxRates(
      prisma as unknown as TaxGroupLookupDb,
      items as TotalsItem[],
      tenantId,
    );
    const serverTotals = computeDocumentTotals(itemsWithRates);
    warnOnTotalsDivergence(
      'quotation',
      'new',
      asNumber(body.grandTotal, asNumber(body.TotalAmount, NaN)),
      serverTotals.grandTotal,
    );

    const status = ((body.status as string) ?? 'draft') as QuotationStatus;
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    // C.1: per-document currency — use caller-supplied code or fall back to company default.
    const docCurrencyCode =
      (typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null) ??
      (await resolveDefaultCurrencyCode(requireTenantId(req)));

    // C2: per-document tax treatment.
    const docTreatment: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ?? contactDefaultTaxTreatment ?? 'STANDARD';

    // Server-computed totals (client values are ignored; see above).
    const finalTaxable = serverTotals.subTotal;
    const finalDiscount = serverTotals.totalDiscount;
    const finalVat = serverTotals.totalTax;
    const finalTotal = serverTotals.grandTotal;

    // Apply treatment: STANDARD is a pass-through; suppressing treatments zero out tax + item taxes.
    // IncomingItem has 'tax' but not 'totalTax'/'taxes'; cast satisfies the generic constraint.
    const enforcedQuotation = applyDocumentTreatment(docTreatment, finalVat, items as { totalTax?: number; taxes?: { amount?: number }[] | null }[]);
    const enforcedVat = enforcedQuotation.tax;
    const enforcedItems = enforcedQuotation.items;
    // Recompute grandTotal when tax was suppressed (taxable + suppressed_tax - discount).
    const enforcedTotal = docTreatment === 'STANDARD' ? finalTotal : finalTaxable + enforcedVat - finalDiscount;

    const quotation = await prisma.$transaction(async (tx) => {
      const quotationId = await generateNextQuotationId(tx, tenantId);
      return tx.quotation.create({
        data: {
          quotationId,
          // Contact-aware: write contactId (new path) or customerId (legacy).
          customerId: resolvedCustomerId,
          ...(resolvedContactId ? { contactId: resolvedContactId } : {}),
          ...(resolvedBillToContactId ? { billToContactId: resolvedBillToContactId } : {}),
          quotationDate: safeDate(body.quotationDate) ?? new Date(),
          expiryDate: safeDate(body.expiryDate),
          referenceNo: (body.referenceNo as string) ?? '',
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          costCenterId: docCostCenterId,
          status,
          paymentTerms: (body.paymentTerms as string) ?? '',
          taxableAmount: toDecimal(finalTaxable),
          totalDiscount: toDecimal(finalDiscount),
          vat: toDecimal(enforcedVat),
          roundOff: Boolean(body.roundOff),
          TotalAmount: toDecimal(enforcedTotal),
          notes: (body.notes as string) ?? '',
          termsAndCondition: (body.termsAndCondition as string) ?? '',
          sign_type: signType as Quotation['sign_type'],
          signatureId: signType === 'digitalSignature' ? ((body.signatureId as string) || null) : null,
          signatureImage: signType === 'eSignature' && req.file ? req.file.path : null,
          signatureName: signType === 'eSignature' ? ((body.signatureName as string) ?? null) : null,
          tenantId,
          // FK to User — empty string from the form must become null, not '' (FK violation).
          salesPerson: (body.salesPerson as string) || null,
          billFrom: billFromId,
          billTo: resolvedBillTo,
          bankId: (body.bank as string) || null,
          convert_type: ((body.convert_type as string) ?? 'quotation') as Quotation['convert_type'],
          taxTreatment: docTreatment,
          // C.1: persist document currency
          ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
        },
      });
    });

    // Optional email if status is 'sent' — only when legacy billTo customer resolved
    if (quotation.status === 'sent' && billToCustomer?.email && (await isEmailConfigured())) {
      try {
        const fromName = `${billFrom.firstName ?? ''} ${billFrom.lastName ?? ''}`.trim() || 'Your Company';
        await sendMail({
          to: billToCustomer.email,
          subject: 'New Quotation Sent',
          html: `
            <h3>Hello ${billToCustomer.name},</h3>
            <p>A new quotation has been sent to you.</p>
            <p><strong>Reference No:</strong> ${quotation.referenceNo}</p>
            <p><strong>Total Amount:</strong> ${quotation.TotalAmount}</p>
            <p><strong>Status:</strong> ${quotation.status}</p>
            <p><strong>Quotation Date:</strong> ${new Date(quotation.quotationDate).toLocaleDateString()}</p>
            <p><strong>Expiry Date:</strong> ${quotation.expiryDate ? new Date(quotation.expiryDate).toLocaleDateString() : ''}</p>
            <br>
            <p>Best Regards,<br>${fromName}</p>
          `,
        });
      } catch (emailErr) {
        console.error('Failed to send quotation email:', emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Quotation created successfully',
      data: quotation,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Create quotation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating quotation',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getQuotationById
// =============================================================================

export async function getQuotationById(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    // TENANT SCOPE, ADDED. This read was `where: { id, isDeleted: false }` — no
    // tenantId — so any authenticated user with `quotations:view` could fetch
    // any tenant's quotation, complete with its customer and bank details, by
    // id. The 404 message already claimed to cover it ("not found or
    // unauthorized"); only the "not found" half was implemented. Reproduced
    // over HTTP in the golden capture before this line existed.
    const quotation = await quotationRepository.findDetailById(id, tenantId);
    if (!quotation) {
      res.status(404).json({ success: false, message: 'Quotation not found or unauthorized' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Quotation retrieved successfully',
      data: presentDetail(quotation, buildBaseUrl(req)),
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get quotation by ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Error retrieving quotation',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}


// =============================================================================
// updateQuotation
// =============================================================================

export async function updateQuotation(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    // TENANT SCOPE, ADDED. The pre-read named only the id, so an edit could
    // load and then overwrite another tenant's quotation — the capture proved
    // it by rewriting a foreign document's notes over HTTP.
    const existing = await quotationRepository.findById(id, tenantId);
    if (!existing) {
      res.status(404).json({ message: 'Quotation not found' });
      return;
    }

    // C3: resolve contact's defaultTaxTreatment (tenant-scoped) if available.
    const cdb = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
    const effectiveContactId = existing.contactId;
    let contactDefaultTaxTreatment: TaxTreatment | null = null;
    if (effectiveContactId) {
      const contactRow = (await cdb().contact.findFirst({
        where: { id: effectiveContactId, tenantId, isDeleted: false },
        select: { defaultTaxTreatment: true },
      } as never)) as { defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
    }
    const docTreatment: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ??
      (existing.taxTreatment as TaxTreatment | null) ??
      contactDefaultTaxTreatment ??
      'STANDARD';

    const data: Prisma.QuotationUpdateInput = {};

    // Contact-first party resolution (mirrors invoiceController.updateInvoice and
    // createQuotation). The contact-first picker sends a Contact id in body.billTo;
    // writing that into the Customer FK columns (customerId/billTo) violates the
    // Customer FK -> P2003 500. Resolve to the CORRECT scalar columns instead.
    // Scalar FKs are collected in partyUpdate and spread into the update call.
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
        const ownedContact = (await cdb().contact.findFirst({
          where: { id: incomingContactId, tenantId, isDeleted: false },
          select: { id: true },
        } as never)) as { id: string } | null;
        if (!ownedContact) {
          res.status(404).json({ success: false, message: 'Contact not found' });
          return;
        }
        const billToContactId = incomingBillToContactId ?? incomingContactId;
        if (incomingBillToContactId && incomingBillToContactId !== incomingContactId) {
          const ownedBillTo = (await cdb().contact.findFirst({
            where: { id: incomingBillToContactId, tenantId, isDeleted: false },
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
        const contactRow = (await cdb().contact.findFirst({
          where: {
            tenantId,
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
          const ownedCustomer = (await cdb().customer.findFirst({
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

    if (body.quotationDate !== undefined) data.quotationDate = safeDate(body.quotationDate) ?? existing.quotationDate;
    if (body.salesPerson !== undefined) {
      if (body.salesPerson) data.salesPersonUser = { connect: { id: body.salesPerson as string } };
      else data.salesPersonUser = { disconnect: true };
    }
    if (body.expiryDate !== undefined) data.expiryDate = safeDate(body.expiryDate);
    if (body.referenceNo !== undefined) data.referenceNo = (body.referenceNo as string) ?? '';
    if (body.status !== undefined) {
      const next = body.status as QuotationStatus;
      if (!VALID_STATUSES.has(next)) {
        res.status(400).json({ message: `Invalid status: ${next}` });
        return;
      }
      data.status = next;
    }
    if (body.paymentTerms !== undefined) data.paymentTerms = (body.paymentTerms as string) ?? '';
    if (body.notes !== undefined) data.notes = (body.notes as string) ?? '';
    if (body.termsAndCondition !== undefined) data.termsAndCondition = (body.termsAndCondition as string) ?? '';
    if (body.sign_type !== undefined) data.sign_type = (body.sign_type as Quotation['sign_type']) ?? 'none';
    if (body.signatureId !== undefined) {
      if (body.signatureId) data.signature = { connect: { id: body.signatureId as string } };
      else data.signature = { disconnect: true };
    }
    if (body.convert_type !== undefined) data.convert_type = (body.convert_type as Quotation['convert_type']) ?? 'quotation';
    if (body.bank !== undefined) {
      if (body.bank) data.bank = { connect: { id: body.bank as string } };
      else data.bank = { disconnect: true };
    }

    if (body.sign_type === 'eSignature' && req.file) {
      data.signatureImage = req.file.path;
      data.signatureName = (body.signatureName as string) ?? null;
    }

    if (body.items !== undefined) {
      const items = normaliseItems(body.items);
      // Server-authoritative totals (see createQuotation): resolve tax-group
      // rates, recompute on the discounted base, ignore client-sent totals.
      const itemsWithRates = await resolveItemTaxRates(
      prisma as unknown as TaxGroupLookupDb,
      items as TotalsItem[],
      tenantId,
    );
      const serverTotals = computeDocumentTotals(itemsWithRates);
      warnOnTotalsDivergence('quotation', id, asNumber(body.grandTotal, asNumber(body.TotalAmount, NaN)), serverTotals.grandTotal);
      const finalTaxable = serverTotals.subTotal;
      const finalDiscount = serverTotals.totalDiscount;
      const finalVat = serverTotals.totalTax;
      const finalTotal = serverTotals.grandTotal;
      // C3: apply treatment — STANDARD is a pass-through.
      const enforcedQ = applyDocumentTreatment(docTreatment, finalVat, items as { totalTax?: number; taxes?: { amount?: number }[] | null }[]);
      const enforcedVat = enforcedQ.tax;
      const enforcedItems = enforcedQ.items;
      const enforcedTotal = docTreatment === 'STANDARD' ? finalTotal : finalTaxable + enforcedVat - finalDiscount;
      data.items = enforcedItems as unknown as Prisma.InputJsonValue;
      data.taxableAmount = toDecimal(finalTaxable);
      data.totalDiscount = toDecimal(finalDiscount);
      data.vat = toDecimal(enforcedVat);
      data.TotalAmount = toDecimal(enforcedTotal);
    }

    // C3: persist taxTreatment on every update (always).
    data.taxTreatment = docTreatment;

    // C.1: update currencyCode if provided (freely editable on quotations)
    if (body.currencyCode !== undefined) {
      data.currencyCode = typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null;
    }

    // `data` is a CHECKED update input (relation connects for salesPersonUser/bank/
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

    // Scoped write. `existing` was already resolved in-tenant above, so this
    // cannot miss for a legitimate caller; it closes the window between the two.
    const updated = await quotationRepository.update(id, tenantId, data);
    if (!updated) {
      res.status(404).json({ message: 'Quotation not found' });
      return;
    }

    res.status(200).json({ message: 'Quotation updated successfully', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Update quotation error:', err);
    res.status(500).json({ message: 'Error updating quotation', error: err instanceof Error ? err.message : String(err) });
  }
}

// =============================================================================
// deleteQuotation (soft)
// =============================================================================

export async function deleteQuotation(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    // TENANT SCOPE, ADDED. This handler did not even resolve a tenant: it read
    // and soft-deleted by id alone, so a DELETE could remove another tenant's
    // quotation. `softDelete` returns null when no row in this tenant matched.
    const updated = await quotationRepository.softDelete(id, requireTenantId(req));
    if (!updated) {
      res.status(404).json({ message: 'Quotation not found' });
      return;
    }
    res.status(200).json({ message: 'Quotation deleted successfully', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Delete quotation error:', err);
    res.status(500).json({ message: 'Error deleting quotation', error: err instanceof Error ? err.message : String(err) });
  }
}

// =============================================================================
// listQuotations
// =============================================================================

interface ListQuotationsQuery {
  page?: string;
  limit?: string;
  status?: string;
  search?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
}

export async function listQuotations(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const query = req.query as ListQuotationsQuery;
    const pageN = Number(query.page ?? '1');
    const limitN = Number(query.limit ?? '10');

    const where = buildListWhere(scope, query);
    const [total, rows] = await quotationRepository.list(where, (pageN - 1) * limitN, limitN);

    // The preview of the next number in this tenant's series, so the form's
    // placeholder agrees with what the create path will issue.
    const nextQuotationId = deriveNextQuotationId(
      await quotationRepository.findLastNumberByNumber(scope.tenantId),
    );

    const baseUrl = buildBaseUrl(req);
    res.status(200).json({
      success: true,
      message: 'Quotations retrieved successfully',
      data: {
        quotations: rows.map((row) => presentListRow(row, baseUrl)),
        nextQuotationId,
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
    console.error('List quotations error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching quotations',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}


// =============================================================================
// listQuotationsMinimal
// =============================================================================

export async function listQuotationsMinimal(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { search = '' } = req.query as { search?: string };

    const where: Prisma.QuotationWhereInput = { ...scope };
    if (search) {
      where.OR = [
        { quotationId: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        // N1-style: also search contact-based quotations
        { contact: { organisation: { contains: search, mode: 'insensitive' } } },
        { contact: { firstName: { contains: search, mode: 'insensitive' } } },
        { contact: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const quotations = await prisma.quotation.findMany({
      where,
      select: {
        id: true,
        quotationId: true,
        referenceNo: true,
        quotationDate: true,
        status: true,
        TotalAmount: true,
        contactId: true,
        contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
        customer: { select: { id: true, name: true } },
      },
      orderBy: { quotationDate: 'desc' },
      take: search ? undefined : 20,
    });

    const formatted = quotations.map((q) => {
      const partyDisplay = q.contact
        ? { id: q.contact.id, name: resolveDisplayName(q.contact) }
        : q.customer
          ? { id: q.customer.id, name: q.customer.name }
          : null;
      return {
        id: q.id,
        quotationId: q.quotationId,
        referenceNo: q.referenceNo,
        quotationDate: q.quotationDate,
        status: q.status,
        totalAmount: q.TotalAmount,
        contactId: q.contactId ?? null,
        customer: partyDisplay,
      };
    });

    res.status(200).json({
      success: true,
      message: search
        ? 'Search results for quotations retrieved successfully'
        : 'Last 20 quotations retrieved successfully',
      data: formatted,
      meta: { count: quotations.length, isSearchResult: Boolean(search) },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List minimal quotations error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching quotations',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getAllCustomers (mounted at /customers-all and /quotations-minimal)
// =============================================================================

interface AllCustomersQuery {
  search?: string;
  status?: string;
}

function formatCustomerSummary(customer: Customer, baseUrl: string) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    status: customer.status,
    image: customer.image ? `${baseUrl}${customer.image.replace(/\\/g, '/')}` : null,
    billingAddress: customer.billingAddress,
    shippingAddress: customer.shippingAddress,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export async function getAllCustomers(req: Request, res: Response): Promise<void> {
  try {
    const { search = '', status } = req.query as AllCustomersQuery;
    const baseUrl = buildBaseUrl(req);

    const where: Prisma.CustomerWhereInput = { isDeleted: false };
    if (status === 'Active' || status === 'Inactive') where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // TENANT SCOPE, ADDED. This filtered on `isDeleted` alone, so
    // GET /api/admin/customers-all — which the quotation form calls on every
    // load — returned every tenant's customer list, names and emails included.
    const customers = await quotationRepository.listCustomers(requireTenantId(req), where);

    res.status(200).json({
      success: true,
      message: 'Customers fetched successfully',
      data: {
        customers: customers.map((c) => formatCustomerSummary(c, baseUrl)),
        count: customers.length,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching customers:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching customers',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateQuotationStatus (accepted / declined)
// =============================================================================

export async function updateQuotationStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status?: string };

    if (!status || !TRANSITIONABLE_STATUSES.has(status)) {
      res.status(400).json({
        success: false,
        message: "Invalid status. Allowed values: 'accepted' or 'declined'.",
      });
      return;
    }

    // TENANT SCOPE, ADDED. Both the read and the write named only the id, so a
    // PATCH could accept or decline another tenant's quotation. `update` returns
    // null when nothing in this tenant matched, which is the same 404 the
    // missing-row case already answered.
    const updated = await quotationRepository.update(id, requireTenantId(req), { status: status as QuotationStatus });
    if (!updated) {
      res.status(404).json({ success: false, message: 'Quotation not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Quotation has been ${status}.`,
      data: updated,
    });
  } catch (err) {
    console.error('Error updating quotation status:', err);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// sendQuotationEmailAndUpdateStatus (sets status, sends email)
// =============================================================================

export async function sendQuotationEmailAndUpdateStatus(req: Request, res: Response): Promise<void> {
  try {
    const {
      quotationId,
      to,
      cc,
      subject,
      htmlContent,
      status,
      sendAttachment = false,
    } = req.body as {
      quotationId?: string;
      to?: string;
      cc?: string;
      subject?: string;
      htmlContent?: string;
      status?: string;
      sendAttachment?: boolean;
    };

    if (!quotationId || !to || !subject || !htmlContent || !status) {
      res.status(400).json({ message: 'Required fields missing' });
      return;
    }
    if (status !== 'sent') {
      res.status(400).json({ message: "Invalid status. Allowed values: 'sent'." });
      return;
    }

    // TENANT SCOPE, ADDED. Unscoped, this handler would mail another tenant's
    // quotation to an address of the caller's choosing and then write its
    // status — the worst of the five, because it exfiltrates as well as writes.
    const tenantId = requireTenantId(req);
    const existing = await quotationRepository.findById(quotationId, tenantId);
    if (!existing) {
      res.status(404).json({ message: 'Quotation not found' });
      return;
    }

    // Compute target status: only promote draft → sent; leave terminal states untouched
    const terminalOrAdvanced = ['accepted', 'declined', 'expired'];
    const nextStatus = terminalOrAdvanced.includes(existing.status) ? existing.status : 'sent';

    const mailOptions: Record<string, unknown> = {
      to,
      cc: cc || undefined,
      subject,
      html: htmlContent,
    };

    if (sendAttachment) {
      const pdfPath = `${process.env.QUOTATION_UPLOAD_PATH || './uploads/quotations'}/${quotationId}.pdf`;
      // Only attach if the PDF exists; skip gracefully if it hasn't been generated
      const fs = await import('fs');
      if (fs.existsSync(pdfPath)) {
        mailOptions.attachments = [
          {
            filename: `Quotation-${quotationId}.pdf`,
            path: pdfPath,
          },
        ];
      } else {
        console.warn(`Quotation PDF not found at ${pdfPath}; sending email without attachment`);
      }
    }

    // Send first — only persist status change on success
    await sendMail(mailOptions);

    const updated = await quotationRepository.update(quotationId, tenantId, { status: nextStatus });

    res.status(200).json({
      success: true,
      message: `Quotation email sent successfully`,
      data: updated,
    });
  } catch (err) {
    console.error('Failed to send quotation email:', err instanceof Error ? err.message : err);
    if ((err as NodeJS.ErrnoException).code === 'EMAIL_NOT_CONFIGURED') {
      res.status(422).json({ success: false, message: (err as Error).message });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send quotation email or update status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// enableQuotationPublicLink — mirrors invoiceController.ts's enablePublicLink
// =============================================================================

function generatePublicToken(): string {
  return randomBytes(32).toString('hex'); // 64-char hex string
}

/**
 * POST /api/admin/quotations/:id/enable-public-link
 * Generates publicViewToken if absent, sets publicViewEnabled=true.
 */
export async function enableQuotationPublicLink(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.quotation.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true, publicViewToken: true, publicViewEnabled: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Quotation not found' });
      return;
    }

    const token = existing.publicViewToken ?? generatePublicToken();
    // The read above was already scoped; the write was not. Scoped here too so
    // the whole handler is, rather than relying on the pre-read to have covered it.
    const updated = await quotationRepository.update(id, tenantId, {
      publicViewToken: token,
      publicViewEnabled: true,
    });
    if (!updated) {
      res.status(404).json({ success: false, message: 'Quotation not found' });
      return;
    }
    res.json({
      success: true,
      message: 'Public link enabled',
      data: {
        id: updated.id,
        publicViewToken: updated.publicViewToken,
        publicViewEnabled: updated.publicViewEnabled,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('enableQuotationPublicLink error:', err);
    res.status(500).json({ success: false, message: 'Failed to enable public link' });
  }
}
