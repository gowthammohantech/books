/**
 * Quotation business rules and response shaping.
 *
 * Takes parsed input, never a `Request` — same contract as
 * `modules/product/product.service.ts`. What lives here is everything that was
 * previously only reachable by constructing a fake req: how a list query becomes
 * a Prisma filter, how the next number in a series is derived, and how a row
 * becomes the JSON the web app reads.
 *
 * WHAT STAYS IN THE CONTROLLER, deliberately:
 *   - `req.protocol`/`req.get('host')` — the base URL for image links is an HTTP
 *     fact, so the controller computes it and passes it in;
 *   - multipart parsing (`req.file` for eSignature uploads);
 *   - every `res.status().json()`, because the six handlers disagree on the
 *     envelope: `getQuotationById` answers `{success, message, data}` while
 *     `updateQuotation` answers a bare `{message, data}` with no `success` at
 *     all. Unifying them is a visible API change, not a refactor.
 *
 * The presenters below are exported individually because the list and the detail
 * read format the SAME party two different ways — the list omits
 * `billingAddress`, `vatRegNumber` and `gstin`; the detail includes them — and
 * collapsing them into one would change one of the two responses.
 */
import type { Prisma, QuotationStatus } from '@prisma/client';

import { resolveDisplayName } from '../../lib/contacts/contactIdentity';

import type { QuotationDetail, QuotationListRow } from './quotation.repository';

export const VALID_STATUSES = new Set<QuotationStatus>(['draft', 'sent', 'accepted', 'declined']);

/** The two statuses `PATCH /quotations-status/:id` accepts. */
export const TRANSITIONABLE_STATUSES = new Set<string>(['accepted', 'declined']);

export function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** `dd/mm/yyyy`, the detail read's format. */
export function formatDateLong(date: Date | null | undefined): string | null {
  if (!date) return null;
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

/** `dd, Mon yyyy`, the list's format. Different from the detail's, as found. */
export function formatDateShort(date: Date | null | undefined): string | null {
  if (!date) return null;
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleString('default', { month: 'short' });
  return `${day}, ${month} ${date.getFullYear()}`;
}

/** Windows path separators reach the DB from legacy uploads; URLs need slashes. */
function toPublicUrl(baseUrl: string, storedPath: string | null | undefined): string {
  return storedPath ? `${baseUrl}${storedPath.replace(/\\/g, '/')}` : '';
}

export interface ListQuotationsInput {
  page?: string;
  limit?: string;
  status?: string;
  search?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * The list filter.
 *
 * Note what the search does NOT cover: `contact.firstName`/`lastName` and
 * `contact.organisation`. Documents on the contact path — the current write
 * path — are therefore unfindable by party name, while legacy customer-linked
 * ones are. `listQuotationsMinimal` searches both. Preserved as found; the fix
 * is an API behaviour change, not a refactor.
 */
export function buildListWhere(
  scope: { tenantId: string; isDeleted: boolean },
  q: ListQuotationsInput,
): Prisma.QuotationWhereInput {
  const where: Prisma.QuotationWhereInput = { ...scope };
  if (q.status && VALID_STATUSES.has(q.status as QuotationStatus)) {
    where.status = q.status as QuotationStatus;
  }
  if (q.customerId) where.customerId = q.customerId;
  if (q.startDate || q.endDate) {
    where.quotationDate = {};
    if (q.startDate) (where.quotationDate as Prisma.DateTimeFilter).gte = new Date(q.startDate);
    if (q.endDate) (where.quotationDate as Prisma.DateTimeFilter).lte = new Date(q.endDate);
  }
  if (q.search) {
    where.OR = [
      { quotationId: { contains: q.search, mode: 'insensitive' } },
      { referenceNo: { contains: q.search, mode: 'insensitive' } },
      { notes: { contains: q.search, mode: 'insensitive' } },
      { customer: { name: { contains: q.search, mode: 'insensitive' } } },
    ];
  }
  return where;
}

/**
 * The next number in the series, from the last one issued.
 *
 * `QT-000042` → `QT-000043`; an unparseable or absent last number restarts the
 * default series. The prefix is whatever the last number carried, so a tenant
 * that renamed its series keeps the new name.
 */
export function deriveNextQuotationId(lastQuotationId: string | null, fallback = 'QT-000001'): string {
  if (!lastQuotationId) return fallback;
  const m = lastQuotationId.match(/(\D*)(\d+)$/);
  if (!m) return fallback;
  return `${m[1]}${String(parseInt(m[2], 10) + 1).padStart(6, '0')}`;
}

// -----------------------------------------------------------------------------
// Presenters
// -----------------------------------------------------------------------------

/** The party block the LIST emits: contact first, legacy customer as fallback. */
export function presentListParty(
  contact: QuotationListRow['contact'],
  customer: QuotationListRow['customer'],
  baseUrl: string,
) {
  if (contact) {
    return {
      id: contact.id,
      name: resolveDisplayName(contact),
      email: contact.email ?? null,
      phone: contact.mobile ?? null,
      image: '',
    };
  }
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name || '',
    email: customer.email || null,
    phone: customer.phone || null,
    image: toPublicUrl(baseUrl, customer.image),
  };
}

/** The list's billTo block — the party block plus a `billingAddress`. */
export function presentListBillTo(
  contact: QuotationListRow['billToContact'],
  customer: QuotationListRow['billToCustomer'],
  baseUrl: string,
) {
  if (contact) {
    return {
      id: contact.id,
      name: resolveDisplayName(contact),
      email: contact.email ?? null,
      phone: contact.mobile ?? null,
      image: '',
      billingAddress: null,
    };
  }
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name || '',
    email: customer.email || null,
    phone: customer.phone || null,
    image: toPublicUrl(baseUrl, customer.image),
    billingAddress: customer.billingAddress || null,
  };
}

/** The DETAIL read's party block — wider than the list's, as found. */
export function presentDetailParty(
  contact: QuotationDetail['contact'],
  customer: QuotationDetail['customer'],
  baseUrl: string,
) {
  if (contact) {
    return {
      id: contact.id,
      name: resolveDisplayName(contact),
      email: contact.email ?? null,
      phone: contact.mobile ?? null,
      image: '',
      billingAddress: null,
      vatRegNumber: contact.vatRegNumber ?? null,
      gstin: contact.gstin ?? null,
    };
  }
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name || '',
    email: customer.email || null,
    phone: customer.phone || null,
    image: toPublicUrl(baseUrl, customer.image),
    billingAddress: customer.billingAddress || null,
  };
}

export function presentBillFromUser(user: QuotationDetail['billFromUser'], baseUrl: string) {
  if (!user) return null;
  return {
    id: user.id,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    email: user.email || null,
    phone: user.phone || null,
    profileImage: toPublicUrl(baseUrl, user.profileImage),
    address: user.address || null,
    // `user_type` defaults to 1 rather than null: the PDF templates branch on it.
    user_type: user.user_type || 1,
  };
}

/** The detail read's bank block. The list's omits `id`; see `presentListBank`. */
export function presentDetailBank(bank: QuotationDetail['bank']) {
  if (!bank) return null;
  return {
    id: bank.id,
    accountHoldername: bank.accountHoldername || '',
    bankName: bank.bankName || '',
    branchName: bank.branchName || '',
    accountNumber: bank.accountNumber || '',
    IFSCCode: bank.IFSCCode || '',
  };
}

/** The list's bank block — no `id`. Different from the detail's, as found. */
export function presentListBank(bank: QuotationListRow['bank']) {
  if (!bank) return null;
  return {
    accountHoldername: bank.accountHoldername || '',
    bankName: bank.bankName || '',
    branchName: bank.branchName || '',
    accountNumber: bank.accountNumber || '',
    IFSCCode: bank.IFSCCode || '',
  };
}

/**
 * The signature block.
 *
 * An eSignature is an uploaded image on the document; a digitalSignature is a
 * row in the Signature table. `includeImage` is false for the list, which emits
 * only `{id, name}` for the stored-signature case — again, as found.
 */
export function presentSignature(
  signType: string,
  signatureName: string | null,
  signatureImagePath: string | null,
  stored: { id: string; signatureName: string | null; signatureImage?: string | null } | null,
  baseUrl: string,
  includeImage: boolean,
): Record<string, unknown> | null {
  if (signType === 'eSignature') {
    return {
      name: signatureName || null,
      image: signatureImagePath ? toPublicUrl(baseUrl, signatureImagePath) : null,
    };
  }
  if (!stored) return null;
  if (!includeImage) return { id: stored.id, name: stored.signatureName || null };
  return {
    id: stored.id,
    name: stored.signatureName || null,
    image: stored.signatureImage ? toPublicUrl(baseUrl, stored.signatureImage) : null,
  };
}

interface StoredItem {
  id?: string;
  productId?: string;
  name?: string;
  productName?: string;
  unit?: string;
  qty?: unknown;
  rate?: unknown;
  discount?: unknown;
  tax?: unknown;
  totalTax?: unknown;
  tax_group_id?: string;
  discount_type?: string;
  discount_value?: unknown;
  amount?: unknown;
  lineTotal?: unknown;
}

/**
 * Line items as the editor expects them.
 *
 * The `??` fallbacks are not defensive padding — they read documents written by
 * three different generations of the write path. `productId`/`productName` and
 * `totalTax`/`lineTotal` are the older field names, still on rows in production.
 */
export function presentItems(raw: unknown) {
  const items = Array.isArray(raw) ? (raw as StoredItem[]) : [];
  return items.map((item) => ({
    id: item.id ?? item.productId ?? null,
    productId: item.id ?? item.productId ?? null,
    name: item.name || item.productName || '',
    unit: item.unit || '',
    qty: asNumber(item.qty, 0),
    rate: asNumber(item.rate, 0),
    discount: asNumber(item.discount, 0),
    tax: asNumber(item.tax ?? item.totalTax, 0),
    tax_group_id: item.tax_group_id || null,
    discount_type: item.discount_type || 'Fixed',
    discount_value: asNumber(item.discount_value, 0),
    amount: asNumber(item.amount ?? item.lineTotal, 0),
  }));
}

/** One LIST row, fully shaped. */
export function presentListRow(q: QuotationListRow, baseUrl: string) {
  return {
    id: q.id,
    quotationId: q.quotationId,
    customer: presentListParty(q.contact, q.customer, baseUrl),
    quotationDate: formatDateShort(q.quotationDate),
    expiryDate: formatDateShort(q.expiryDate),
    referenceNo: q.referenceNo,
    status: q.status,
    paymentTerms: q.paymentTerms,
    taxableAmount: q.taxableAmount,
    totalDiscount: q.totalDiscount,
    vat: q.vat,
    TotalAmount: q.TotalAmount,
    itemsCount: Array.isArray(q.items) ? q.items.length : 0,
    contactId: q.contactId ?? null,
    billToContactId: q.billToContactId ?? null,
    billFrom: q.billFrom,
    billTo: presentListBillTo(q.billToContact, q.billToCustomer, baseUrl),
    bank: presentListBank(q.bank),
    notes: q.notes,
    sign_type: q.sign_type,
    signature: presentSignature(q.sign_type, q.signatureName, q.signatureImage, q.signature, baseUrl, false),
    convert_type: q.convert_type,
    invoiceId: q.invoiceId ?? null,
    currencyCode: q.currencyCode ?? null,
    taxTreatment: q.taxTreatment ?? null,
    createdAt: formatDateShort(q.createdAt),
    updatedAt: formatDateShort(q.updatedAt),
  };
}

/** The DETAIL read, fully shaped. */
export function presentDetail(q: QuotationDetail, baseUrl: string) {
  return {
    id: q.id,
    quotationId: q.quotationId,
    salesPerson: q.salesPerson,
    contactId: q.contactId ?? null,
    billToContactId: q.billToContactId ?? null,
    customer: presentDetailParty(q.contact, q.customer, baseUrl),
    quotationDate: q.quotationDate,
    expiryDate: q.expiryDate,
    referenceNo: q.referenceNo,
    status: q.status,
    paymentTerms: q.paymentTerms,
    taxableAmount: q.taxableAmount,
    totalDiscount: q.totalDiscount,
    vat: q.vat,
    roundOff: q.roundOff,
    TotalAmount: q.TotalAmount,
    items: presentItems(q.items),
    billFrom: presentBillFromUser(q.billFromUser, baseUrl),
    billTo: presentDetailParty(q.billToContact, q.billToCustomer, baseUrl),
    bank: presentDetailBank(q.bank),
    notes: q.notes,
    termsAndCondition: q.termsAndCondition,
    sign_type: q.sign_type,
    signature: presentSignature(q.sign_type, q.signatureName, q.signatureImage, q.signature, baseUrl, true),
    convert_type: q.convert_type,
    currencyCode: q.currencyCode ?? null,
    taxTreatment: q.taxTreatment ?? null,
    // Exposed so the edit view can read the share-link state instead of
    // blind-POSTing enableQuotationPublicLink on every load to discover it.
    publicViewEnabled: q.publicViewEnabled,
    publicViewToken: q.publicViewToken ?? null,
    createdAt: formatDateLong(q.createdAt),
    updatedAt: formatDateLong(q.updatedAt),
  };
}
