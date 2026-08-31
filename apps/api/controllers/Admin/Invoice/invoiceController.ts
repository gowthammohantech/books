import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { Invoice, InvoiceStatus } from '@prisma/client';
import { validationResult } from 'express-validator';
import { resolveDisplayName } from '../../../lib/contacts/contactIdentity';
// NOTE: lib/contacts/accountCreditBalance.ts is being added by a parallel task
// (AccountCreditEntry model + ACCOUNT_CREDIT/CUSTOMER_CREDIT_EXPENSE ledger
// roles). Importing it by name/path now so this feature lands wired the moment
// that task merges — expect a module-not-found tsc error until it does.
import { getAccountCreditBalance, type AccountCreditBalanceDb } from '../../../lib/contacts/accountCreditBalance';
import { applyDocumentTreatment } from '../../../lib/tax/applyTreatment';
import { parseTaxTreatment } from '../../../lib/tax/taxTreatment';
import type { TaxTreatment } from '../../../lib/tax/taxTreatment';
import {
  isFlatRegime,
  recomputeServerTax,
  resolveSupplierCountry,
  resolveCustomerTaxContext,
} from '../../../lib/tax/serverAuthoritativeTax';
import {
  computeDocumentTotals,
  warnOnTotalsDivergence,
  type TotalsItem,
} from '../../../lib/documentTotals';
import { sanitizeLineCustomFields } from '../../../lib/lineCustomFields';
import {
  resolveLineCostCenterId,
  collectCostCentreIds,
  assertCostCentresExist,
  UnknownCostCentreError,
} from '../../../lib/lineDimensions';
import { splitNetByCentre } from '../../../lib/ledger/dimensionSplit';
import { nextCentreDocumentNumber, peekCentreDocumentNumber } from '../../../lib/costCenterNumbering';

// utils/mailer is still JS; static require is fine here.
// eslint-disable-next-line @typescript-eslint/no-require-imports, import/order
const mailerModule: { sendMail: (opts: Record<string, unknown>) => Promise<void> } = require('../../../utils/mailer');

import { prisma } from '../../../lib/prisma';
import {
  tenantScope,
  requireTenantId,
  UnauthorizedError, requireActingUserId } from '../../../lib/tenantScope';
import { handleLedgerError } from '../../../lib/httpErrors';
import { runRecurringForInvoice } from '../../../lib/recurringInvoiceRunner';
import {
  postInvoiceIssued,
  postInvoicePayment,
  postSaleCogs,
  reverseDocument,
  voidDocument,
  type PostingTx,
} from '../../../lib/ledger/ledgerPosting';
import { resolveBankGlAccountId } from '../../../lib/ledger/bankAccount';
import {
  reverseInvoicePaymentEffects,
  type PaymentEffectsTx,
} from '../../../lib/ledger/voidPaymentEffects';
import { explainedBankFields } from '../../../lib/moneyFlow/explainedBankFields';
import { applyIssue } from '../../../lib/ledger/inventoryCost';
import { applyWacIssue } from '../../../lib/ledger/inventoryValuation';
import { applyStockAdjustment, resolveRestockUnitCost } from '../../../lib/inventory/stockAdjust';
import { ZERO, toBaseAmount } from '../../../lib/ledger/money';
import { initialApprovalStatus, shouldPostOnCreate } from '../../../lib/ledger/approvals';
import { shouldPost } from '../../../lib/ledger/postingGate';
import {
  deriveInvoiceStatus,
  getInvoiceSettlement,
  OUTSTANDING_TOLERANCE,
} from '../../../lib/invoiceOutstanding';
import { creditNoteTotalsByInvoice, netInvoiceOutstanding } from '../../../lib/reports/aging';
import { currentActorId } from '../../../lib/actor';

type Tx = Prisma.TransactionClient;

const VALID_STATUSES = new Set<InvoiceStatus>([
  'DRAFT',
  'UNPAID',
  'SENT',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'PARTIALLY_PAID',
]);

// Payment status is DERIVED from recorded payments + credit notes (deriveInvoiceStatus),
// never set by hand — a manual "PAID"/"PARTIALLY_PAID" jump leaves an invoice with a
// full remaining balance but a paid label. The generic status endpoint may only set the
// non-settlement display statuses.
const DERIVED_PAYMENT_STATUSES = new Set<InvoiceStatus>(['PAID', 'PARTIALLY_PAID']);

// Normalise per-invoice "Pay with" links into a clean [{ name, url }] array.
// Returns null when nothing valid is supplied (so callers can skip the field).
function sanitizePaymentOptions(input: unknown): { name: string; url: string }[] | null {
  // Accept either a real array (JSON body) or a JSON string (multipart form-data).
  let arr: unknown = input;
  if (typeof input === 'string') {
    try {
      arr = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const cleaned = arr
    .filter(
      (o): o is { name: string; url: string } =>
        !!o &&
        typeof (o as { name?: unknown }).name === 'string' &&
        typeof (o as { url?: unknown }).url === 'string' &&
        String((o as { url: string }).url).trim() !== '',
    )
    .map((o) => ({ name: String(o.name).trim(), url: String(o.url).trim() }));
  return cleaned;
}

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

// Multipart form-data sends booleans as strings, so `Boolean(body.x)` is wrong:
// the string "false" is truthy. Parse explicitly.
function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  if (typeof value === 'number') return value === 1;
  return Boolean(value);
}

// Map a unified Contact's flat address columns into the billingAddress object the
// invoice templates read (addressLine1/city/state/country). Returns null when the
// contact carries no address at all, so the template renders nothing instead of
// stray commas. Previously billingAddress was hardcoded null → blank Invoice To.
function contactBillingAddress(c: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressLine3?: string | null;
  town?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
} | null | undefined): {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
} | null {
  if (!c) return null;
  const parts = [c.addressLine1, c.addressLine2, c.addressLine3, c.town, c.region, c.postcode, c.country];
  if (!parts.some((p) => typeof p === 'string' && p.trim().length > 0)) return null;
  return {
    addressLine1: c.addressLine1 ?? null,
    addressLine2: [c.addressLine2, c.addressLine3].filter((p) => p && p.trim()).join(', ') || null,
    city: c.town ?? null,
    state: c.region ?? null,
    postcode: c.postcode ?? null,
    country: c.country ?? null,
  };
}

function buildBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}/`;
}

interface IncomingItemTax {
  taxRateId?: string;
  name?: string;
  kind?: string | null;
  percent?: number;
  amount?: number;
}

interface IncomingItem {
  id?: string;
  productId?: string;
  name?: string;
  key?: number;
  qty?: number;
  unit?: string;
  rate?: number;
  discount?: number;
  tax?: number;
  tax_group_id?: string;
  amount?: number;
  discount_type?: string;
  discount_value?: number;
  taxes?: IncomingItemTax[];
  totalTax?: number;
  customFields?: unknown;
  /** Profit centre for this line. Resolved against the document header at
   *  write time (see normaliseItems), so persisted items are always fully
   *  resolved and every later reader — posting, reports, exports, PDF
   *  templates — can trust the line value without re-deriving it. */
  costCenterId?: string | null;
}

/**
 * Sanitize incoming line items.
 *
 * `headerCostCenterId` implements profit-centre inheritance: a line that names
 * no centre adopts the document's. `LINE_CENTRE_NONE` ('__none__') is the
 * explicit "leave this line untagged" escape hatch, needed because a plain
 * empty value has to keep meaning "inherit" for the multipart form encoding.
 *
 * Items persisted before this feature simply have no `costCenterId` key; they
 * read back as the header's centre, so historical documents report exactly as
 * they did before.
 */
function normaliseItems(raw: unknown, headerCostCenterId?: string | null): IncomingItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as IncomingItem[]).map((item) => ({
    costCenterId: resolveLineCostCenterId(item.costCenterId, headerCostCenterId ?? null),
    id: item.id ?? item.productId,
    productId: item.productId ?? item.id,
    name: item.name ?? '',
    key: typeof item.key === 'number' ? item.key : 0,
    qty: asNumber(item.qty, 0),
    unit: item.unit,
    rate: asNumber(item.rate, 0),
    discount: asNumber(item.discount, 0),
    tax: asNumber(item.tax, 0),
    tax_group_id: item.tax_group_id,
    amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
    discount_type: item.discount_type,
    discount_value: asNumber(item.discount_value, 0),
    taxes: Array.isArray(item.taxes)
      ? item.taxes.map((t) => ({ ...t, percent: asNumber(t.percent, 0), amount: asNumber(t.amount, 0) }))
      : undefined,
    totalTax: item.totalTax !== undefined ? asNumber(item.totalTax, 0) : undefined,
    customFields: sanitizeLineCustomFields(item.customFields),
  }));
}

async function generateNextInvoiceNumber(
  tx: Tx,
  tenantId: string,
  invoiceType: 'INVOICE' | 'PROFORMA' = 'INVOICE',
  opts?: { costCenterId?: string | null },
): Promise<string> {
  // Per-profit-centre series first: a centre with its own `numberPrefix` issues
  // SAL-000001 / ACAD-000001 from its own counter. Returns null when the
  // document has no centre, or its centre has no prefix — then we fall through
  // to the install-wide sequence below, unchanged.
  if (opts?.costCenterId) {
    const centreNumber = await nextCentreDocumentNumber(tx as never, {
      tenantId,
      costCenterId: opts.costCenterId,
      model: tx.invoice as never,
      field: 'invoiceNumber',
    });
    if (centreNumber) return centreNumber;
  }

  const settingKey = invoiceType === 'PROFORMA' ? 'proformaPrefix' : 'invoicePrefix';
  const fallbackPrefix = invoiceType === 'PROFORMA' ? 'PRO-' : 'INV-';
  const prefixSetting = await tx.generalSetting.findUnique({
    where: { tenantId_key: { tenantId, key: settingKey } },
  });
  let prefix = fallbackPrefix;
  if (prefixSetting && typeof prefixSetting.value === 'string') prefix = prefixSetting.value;

  const lastInvoice = await tx.invoice.findFirst({
    where: { tenantId, invoiceNumber: { not: null }, invoiceType },
    orderBy: { createdAt: 'desc' },
    select: { invoiceNumber: true },
  });

  let lastNumber = 0;
  if (lastInvoice?.invoiceNumber) {
    const match = lastInvoice.invoiceNumber.match(/\d+$/);
    if (match) lastNumber = parseInt(match[0], 10);
  }

  // #21: honour the configured "next number" set by the invoice-number settings
  // modal (GeneralSetting key `nextInvoiceNo`, a digit string). Only INVOICE
  // numbering is configurable there, so PROFORMA keeps the pure DB-derived seq.
  // The next number is max(configuredNext, lastDbNumber + 1) so we never collide
  // with an existing invoice yet still respect a forward jump from settings.
  let configuredNext = 0;
  const isInvoice = invoiceType === 'INVOICE';
  if (isInvoice) {
    const nextSetting = await tx.generalSetting.findUnique({
      where: { tenantId_key: { tenantId, key: 'nextInvoiceNo' } },
    });
    if (nextSetting) {
      const raw = nextSetting.value;
      const digits =
        typeof raw === 'string' ? raw.match(/\d+$/)?.[0] : typeof raw === 'number' ? String(raw) : undefined;
      if (digits) configuredNext = parseInt(digits, 10);
    }
  }

  const next = Math.max(configuredNext, lastNumber + 1);

  // Advance the configured next-number within the SAME tx so the sequence
  // increments on every successful invoice creation (mirrors the settings modal).
  if (isInvoice) {
    await tx.generalSetting.upsert({
      where: { tenantId_key: { tenantId, key: 'nextInvoiceNo' } },
      update: { value: String(next + 1) },
      create: { tenantId, key: 'nextInvoiceNo', value: String(next + 1), groupSlug: 'invoice' },
    });
  }

  return `${prefix}${String(next).padStart(6, '0')}`;
}

async function insertCustomFieldValues(
  tx: Tx,
  invoiceId: string,
  tenantId: string,
  customFieldsRaw: unknown,
  files: Express.Multer.File[],
): Promise<void> {
  let customFields = customFieldsRaw;
  if (typeof customFields === 'string') {
    try {
      customFields = JSON.parse(customFields);
    } catch {
      return;
    }
  }
  if (!Array.isArray(customFields) || customFields.length === 0) return;

  const records: Prisma.CustomFieldValueCreateManyInput[] = customFields.map((field) => {
    const f = field as { fieldId: string; value?: string };
    let value: Prisma.InputJsonValue = f.value ?? '';
    const fileMatch = files.find((file) => file.fieldname === `customField_${f.fieldId}`);
    if (fileMatch) value = fileMatch.path;
    return {
      tenantId,
      customFieldId: f.fieldId,
      module: 'invoice',
      recordId: invoiceId,
      value,
      // No `req` here - this is a helper. The acting user comes from the
      // request-scoped context, which holds the same person.
      createdBy: currentActorId(),
    };
  });

  await tx.customFieldValue.createMany({ data: records });
}

interface CustomerLite {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  image: string | null;
  billingAddress?: Prisma.JsonValue | null;
}

interface UserLite {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  profileImage: string | null;
}

interface BankLite {
  id: string;
  accountHoldername: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  IFSCCode: string;
}

interface SignatureLite {
  id: string;
  signatureName: string;
  signatureImage: string;
}

function formatCustomer(c: CustomerLite | null | undefined, baseUrl: string, withBillingAddress = false) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name || '',
    email: c.email || null,
    phone: c.phone || null,
    image: c.image ? `${baseUrl}${c.image.replace(/\\/g, '/')}` : '',
    ...(withBillingAddress ? { billingAddress: c.billingAddress ?? null } : {}),
  };
}

function formatBillFromUser(u: UserLite | null | undefined, baseUrl: string) {
  if (!u) return null;
  return {
    id: u.id,
    name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
    email: u.email || null,
    phone: u.phone || null,
    address: u.address || null,
    image: u.profileImage ? `${baseUrl}${u.profileImage.replace(/\\/g, '/')}` : '',
  };
}

function formatBank(b: BankLite | null | undefined) {
  if (!b) return null;
  return {
    id: b.id,
    accountHoldername: b.accountHoldername || '',
    bankName: b.bankName || '',
    branchName: b.branchName || '',
    accountNumber: b.accountNumber || '',
    IFSCCode: b.IFSCCode || '',
  };
}

function formatSignature(invoice: Invoice & { signature?: SignatureLite | null }, baseUrl: string) {
  if (invoice.sign_type === 'eSignature') {
    return {
      name: invoice.signatureName || null,
      image: invoice.signatureImage
        ? `${baseUrl}${invoice.signatureImage.replace(/\\/g, '/')}`
        : null,
    };
  }
  if (invoice.sign_type === 'digitalSignature' && invoice.signature) {
    return {
      id: invoice.signature.id,
      name: invoice.signature.signatureName || null,
      image: invoice.signature.signatureImage
        ? `${baseUrl}${invoice.signature.signatureImage.replace(/\\/g, '/')}`
        : null,
    };
  }
  return null;
}

function formatDateShort(d: Date | null | undefined): string | null {
  if (!d) return null;
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleString('default', { month: 'short' });
  return `${day}, ${month} ${d.getFullYear()}`;
}

// =============================================================================
// postInvoiceLedger — shared helper used by createInvoice (when approvalsEnabled=false)
//                     AND approveInvoice (when approvalsEnabled=true).
// Guarantees create/approve posting parity: both paths call this single function.
// =============================================================================

async function postInvoiceLedger(
  tx: Tx,
  invoice: { id: string; invoiceType: string; invoiceDate: Date | null; TotalAmount: Prisma.Decimal; vat: Prisma.Decimal | null; items: Prisma.JsonValue | null; currencyCode?: string | null; exchangeRate?: Prisma.Decimal | null; costCenterId?: string | null; projectId?: string | null },
  tenantId: string,
  // Pass precomputed totalCogs when already computed by the create path;
  // on the approve path we recompute from the persisted items + current avgCost.
  precomputedCogs?: Prisma.Decimal,
): Promise<void> {
  if (invoice.invoiceType === 'PROFORMA') return;

  const invoiceDate = invoice.invoiceDate ?? new Date();
  const headerCostCentre = invoice.costCenterId ?? null;

  // Resolve line centres from the PERSISTED items, passing the header so the
  // approve path resolves identically to the create path. If these two diverged,
  // creating and approving the same invoice would produce different journals.
  const resolvedItems = normaliseItems(invoice.items, headerCostCentre);

  // Split revenue by department. `perLine[].taxable` (gross − discount) is the
  // line's net, from the same authoritative computation used for the document
  // totals. splitNetByCentre returns [] when every line sits on the header
  // centre, so a single-department invoice posts exactly as it always has.
  const lineTotals = computeDocumentTotals(resolvedItems as TotalsItem[]);
  const documentNet = new Prisma.Decimal(String(invoice.TotalAmount))
    .minus(new Prisma.Decimal(String(invoice.vat ?? 0)));
  const revenueByCentre = splitNetByCentre(
    resolvedItems.map((item, i) => ({
      costCenterId: item.costCenterId,
      net: String(lineTotals.perLine[i]?.taxable ?? 0),
    })),
    headerCostCentre,
    documentNet.toString(),
  );

  // If cogs not precomputed (approve path), recompute from persisted items + current avgCost.
  // The per-centre breakdown is only needed when revenue actually spans several
  // departments — otherwise the extra product/inventory reads would be wasted.
  const needsCogsSplit = revenueByCentre.length > 0;
  const cogsByCentreRaw = new Map<string | null, Prisma.Decimal>();
  let totalCogs: Prisma.Decimal;

  if (precomputedCogs !== undefined && !needsCogsSplit) {
    totalCogs = precomputedCogs;
  } else {
    let walked = ZERO;
    for (const item of resolvedItems) {
      const productId = item.productId ?? item.id;
      if (!productId || !item.qty) continue;
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId },
        select: { item_type: true },
      });
      if (product?.item_type === 'Service') continue;
      const inv = await tx.inventory.findFirst({
        where: { productId, tenantId, isDeleted: false },
      });
      if (!inv) continue;
      // Re-read avgCost from current inventory state (same approach as updateInvoice)
      const lineCost = inv.avgCost.times(new Prisma.Decimal(item.qty));
      walked = walked.plus(lineCost);
      const key = item.costCenterId ?? null;
      cogsByCentreRaw.set(key, (cogsByCentreRaw.get(key) ?? ZERO).plus(lineCost));
    }
    // The create path's precomputed total stays authoritative; the walk above is
    // only there to apportion it. splitNetByCentre folds any drift between the
    // two into the header centre.
    totalCogs = precomputedCogs !== undefined ? precomputedCogs : walked;
  }

  const cogsByCentre = needsCogsSplit
    ? splitNetByCentre(
        [...cogsByCentreRaw.entries()].map(([costCenterId, cost]) => ({
          costCenterId,
          net: cost.toString(),
        })),
        headerCostCentre,
        totalCogs.toString(),
      )
    : [];

  // G: pass document currency/rate when present; omitting both falls back to functional path.
  // P3.3: pass dims if present on the document (null/undefined → no-op)
  await postInvoiceIssued(tx as unknown as PostingTx, {
    tenantId,
    invoiceId: invoice.id,
    date: invoiceDate,
    total: String(invoice.TotalAmount),
    tax: String(invoice.vat ?? 0),
    ...(invoice.currencyCode ? { currencyCode: invoice.currencyCode } : {}),
    ...(invoice.exchangeRate != null ? { exchangeRate: invoice.exchangeRate } : {}),
    ...(invoice.costCenterId !== undefined ? { costCenterId: invoice.costCenterId } : {}),
    ...(invoice.projectId !== undefined ? { projectId: invoice.projectId } : {}),
    ...(revenueByCentre.length ? { revenueByCentre } : {}),
  });
  // B.4: post COGS (Dr COGS / Cr INVENTORY) — COGS is always functional currency (no FX).
  // COGS carries the same dimensions as the revenue it offsets, or a tagged
  // department would report revenue with no cost against it.
  await postSaleCogs(tx as unknown as PostingTx, {
    tenantId,
    invoiceId: invoice.id,
    date: invoiceDate,
    cost: totalCogs.toString(),
    ...(invoice.costCenterId !== undefined ? { costCenterId: invoice.costCenterId } : {}),
    ...(invoice.projectId !== undefined ? { projectId: invoice.projectId } : {}),
    ...(cogsByCentre.length ? { cogsByCentre } : {}),
  });
}

// =============================================================================
// createInvoice
// =============================================================================

export async function createInvoice(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const tenantId = requireTenantId(req);
    const body = req.body as Record<string, unknown>;
    // Resolved BEFORE the items so each line can inherit the document's centre.
    const docCostCenterId = typeof body.costCenterId === 'string' && body.costCenterId ? body.costCenterId : null;
    const items = normaliseItems(body.items, docCostCenterId);
    const status = (body.status as string)?.toUpperCase() as InvoiceStatus | undefined;
    const rawIncomingNumber = body.invoiceNumber as string | undefined;
    const invoiceType: 'INVOICE' | 'PROFORMA' = (body.invoiceType === 'PROFORMA') ? 'PROFORMA' : 'INVOICE';

    // #21: enforce the configured numbering mode (GeneralSetting `invoiceNumberType`).
    // - auto: ignore any client-supplied number; always autogenerate from settings.
    // - manual: a number must be supplied by the client.
    // Only applies to INVOICE (PROFORMA has its own prefix/sequence, not configurable here).
    let invoiceNumberType = 'auto';
    if (invoiceType === 'INVOICE') {
      const typeSetting = await prisma.generalSetting.findUnique({
        where: { tenantId_key: { tenantId, key: 'invoiceNumberType' } },
      });
      if (typeSetting?.value && typeof typeSetting.value === 'string') invoiceNumberType = typeSetting.value;
    }
    const manualMode = invoiceType === 'INVOICE' && invoiceNumberType === 'manual';
    // In auto mode the supplied number is discarded so generateNextInvoiceNumber wins.
    const incomingNumber =
      invoiceType === 'INVOICE' && invoiceNumberType === 'auto' ? undefined : rawIncomingNumber;

    if (manualMode && !incomingNumber) {
      res.status(400).json({
        success: false,
        message: 'Invoice number is required when numbering is set to manual.',
        errors: { invoiceNumber: 'Invoice number is required when numbering is set to manual.' },
      });
      return;
    }

    if (incomingNumber) {
      // Scoped: invoiceNumber is unique per (tenantId, invoiceNumber) since
      // P4/M11, so a number another company holds is free here. Without the
      // filter a manual-mode user would get a spurious 400 for a number their
      // own company has never issued.
      const dup = await prisma.invoice.findFirst({
        where: { tenantId, invoiceNumber: incomingNumber },
      });
      if (dup) {
        res.status(400).json({
          success: false,
          message: `Invoice number ${incomingNumber} already exists`,
          errors: { invoiceNumber: `Invoice number ${incomingNumber} already exists` },
        });
        return;
      }
    }

    // Server-authoritative totals: recompute subTotal/discount/tax/grandTotal
    // from the line items and IGNORE any client-sent totals (compare + warn
    // only). Invoice lines carry taxes[] component percents (tax groups), so tax
    // is recomputed on the discounted base here; the flat per-country regimes
    // (VAT_UK/EU, GST_AU/NZ) additionally override the tax below via
    // serverAuthoritativeTax. This closes the grandTotal-spoofing gap for EVERY
    // regime (a client can no longer post items worth 10,000 with grandTotal 100).
    const serverTotals = computeDocumentTotals(items as TotalsItem[]);
    const clientGrandTotal = asNumber(body.grandTotal, asNumber(body.TotalAmount, NaN));
    warnOnTotalsDivergence('invoice', rawIncomingNumber ?? 'new', clientGrandTotal, serverTotals.grandTotal);
    const finalTaxable = serverTotals.subTotal;
    const finalTotal = serverTotals.grandTotal;
    const finalVat = serverTotals.totalTax;
    const finalDiscount = serverTotals.totalDiscount;

    // Contact-aware party resolution:
    // - New path: body.contactId provided → use it directly, write customerId: null, billTo: null
    // - Legacy path: body.billTo/customerId provided → resolve contactId via legacyCustomerId
    // - At least one party is required (400 if neither).
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
    // currencyCode derived from the primary contact (reused below to avoid double-query)
    let contactCurrencyCode: string | null = null;
    // C2: defaultTaxTreatment from the resolved primary contact
    let contactDefaultTaxTreatment: TaxTreatment | null = null;

    const cdb = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;

    if (incomingContactId) {
      // New contact-based path: verify the contact belongs to this tenant.
      const ownedContact = (await cdb().contact.findFirst({
        where: { id: incomingContactId, tenantId, isDeleted: false },
        select: { id: true, currencyCode: true, defaultTaxTreatment: true },
      } as never)) as { id: string; currencyCode: string | null; defaultTaxTreatment: TaxTreatment | null } | null;
      if (!ownedContact) {
        res.status(404).json({ success: false, message: 'Contact not found' });
        return;
      }
      contactCurrencyCode = ownedContact.currencyCode;
      contactDefaultTaxTreatment = ownedContact.defaultTaxTreatment;
      resolvedCustomerId = null;
      resolvedBillTo = null;

      // If a separate billToContactId was provided and differs, verify it too.
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
      // Legacy path: keep legacy ids, resolve contactId from legacyCustomerId
      resolvedCustomerId = legacyCustomerId;
      resolvedBillTo = legacyCustomerId;
      const contactRow = (await cdb().contact.findFirst({
        where: { legacyCustomerId, tenantId, isDeleted: false },
        select: { id: true, currencyCode: true, defaultTaxTreatment: true },
      } as never)) as { id: string; currencyCode: string | null; defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) {
        resolvedContactId = contactRow.id;
        resolvedBillToContactId = contactRow.id;
        contactCurrencyCode = contactRow.currencyCode;
        contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
      }
    }

    // G: document currency — optional. Omitting defaults to functional currency (rate 1).
    // §6: when no explicit currencyCode, derive from the chosen contact's currencyCode.
    // Reuse the currencyCode already fetched above; fall back to a secondary lookup only
    // when we have a legacyCustomerId but the contact row resolved no currency.
    const explicitCurrencyCode = typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : undefined;
    let docCurrencyCode = explicitCurrencyCode;
    if (!docCurrencyCode) {
      if (contactCurrencyCode) {
        docCurrencyCode = contactCurrencyCode;
      } else {
        const contactPartyId = resolvedContactId ?? legacyCustomerId;
        if (contactPartyId) {
          const contactRow = (await cdb().contact.findFirst({
            where: { OR: [{ id: contactPartyId }, { legacyCustomerId: contactPartyId }], tenantId, isDeleted: false },
            select: { currencyCode: true },
          } as never)) as { currencyCode: string | null } | null;
          if (contactRow?.currencyCode) docCurrencyCode = contactRow.currencyCode;
        }
      }
    }
    const docExchangeRate = body.exchangeRate != null ? toDecimal(body.exchangeRate) : undefined;

    // C2: per-document tax treatment.
    // body.taxTreatment is accepted only if it is one of the 5 known enum values.
    const VALID_TAX_TREATMENTS = new Set<TaxTreatment>([
      'STANDARD', 'ZERO_RATED', 'EXEMPT', 'REVERSE_CHARGE', 'OUT_OF_SCOPE',
    ]);
    const rawBodyTreatment = body.taxTreatment as string | undefined;
    const validatedBodyTreatment: TaxTreatment | undefined =
      rawBodyTreatment && VALID_TAX_TREATMENTS.has(rawBodyTreatment as TaxTreatment)
        ? (rawBodyTreatment as TaxTreatment)
        : undefined;
    const docTreatment: TaxTreatment =
      validatedBodyTreatment ?? contactDefaultTaxTreatment ?? 'STANDARD';

    // Apply treatment: STANDARD is a pass-through; suppressing treatments zero out tax + item taxes.
    const enforcedInvoice = applyDocumentTreatment(docTreatment, finalVat, items);
    const enforcedVat = enforcedInvoice.tax;
    const enforcedItems = enforcedInvoice.items;
    // Recompute grandTotal when tax was suppressed (taxable + suppressed_tax - discount).
    const enforcedTotal = docTreatment === 'STANDARD' ? finalTotal : finalTaxable + enforcedVat - finalDiscount;

    // P3.3: optional dimension tagging (null/undefined → omitted from create data → no-op).
    // docCostCenterId is resolved earlier, above normaliseItems, so lines inherit it.
    const docProjectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;

    // Signature handling
    const signType = (body.sign_type as string) ?? 'none';
    let signatureImage: string | null = null;
    let signatureId: string | null = null;
    let signatureName: string | null = null;
    if (signType === 'eSignature' && req.file) {
      signatureImage = req.file.path;
      signatureName = (body.signatureName as string) ?? null;
    } else if (signType === 'digitalSignature' && body.signatureId) {
      signatureId = body.signatureId as string;
    }

    // Recurring is retired from the invoice editor. New invoices are always
    // non-recurring; recurring is driven exclusively by RecurringInvoiceSchedule.
    // Schema defaults apply (isRecurring=false, cadence columns null).

    const invoice = await prisma.$transaction(async (tx) => {
      // Approval gate + tax regime: read companySettings for this tenant.
      const settings = await tx.companySettings.findFirst({ where: { tenantId } });
      const approvalsEnabled = settings?.approvalsEnabled ?? false;

      // -----------------------------------------------------------------------
      // Server-authoritative tax (tax packs: VAT_UK / VAT_EU / GST_AU / GST_NZ).
      // The legacy path SUMS client-supplied per-line tax (calcTotals -> finalVat).
      // For the flat per-country regimes we RECOMPUTE tax from the tenant regime +
      // supply context instead of trusting the client. GST_INDIA / US_SALES_TAX /
      // VAT_GENERIC / NONE are untouched (recomputeServerTax returns null) and keep
      // the existing client-derived/library-row behaviour.
      //
      // Suppressing tax treatments (ZERO_RATED/EXEMPT/REVERSE_CHARGE/OUT_OF_SCOPE)
      // already force tax to 0 via applyDocumentTreatment; that wins over the
      // recompute, so we only recompute when the treatment is STANDARD.
      let authVat = enforcedVat;
      let authTotal = enforcedTotal;
      let authReverseCharge = false;
      let authReverseChargeNote: string | null = null;
      const regime = settings?.taxRegime ?? 'NONE';
      if (docTreatment === 'STANDARD' && isFlatRegime(regime)) {
        const supplierCountry = await resolveSupplierCountry(tx, settings);
        let customerCtx = { customerCountry: null as string | null, customerVatNumber: null as string | null };
        if (regime === 'VAT_EU' && resolvedContactId) {
          const custContact = (await cdb().contact.findFirst({
            where: { id: resolvedContactId, tenantId, isDeleted: false },
            select: { country: true, countryId: true, vatNumber: true, vatRegNumber: true },
          } as never)) as
            | { country: string | null; countryId: string | null; vatNumber: string | null; vatRegNumber: string | null }
            | null;
          customerCtx = await resolveCustomerTaxContext(tx, custContact);
        }
        const recomputed = recomputeServerTax({
          regime,
          items: enforcedItems,
          supplierCountry,
          customerCountry: customerCtx.customerCountry,
          customerVatNumber: customerCtx.customerVatNumber,
          // OSS: destination-rate VAT for B2C cross-border when the tenant is registered.
          ossRegistered: settings?.ossRegistered === true,
        });
        if (recomputed) {
          authVat = recomputed.totalTax;
          // Keep the document balanced: total = taxable + recomputed tax - discount.
          authTotal = finalTaxable + recomputed.totalTax - finalDiscount;
          authReverseCharge = recomputed.reverseCharge;
          // Reuse reverseChargeNote to persist the OSS marker too (no new column).
          authReverseChargeNote = recomputed.note;
        }
      }

      // The items JSON has no foreign key, so nothing stops a typo'd or
      // cross-tenant centre id reaching a line and silently poisoning the
      // departmental P&L. One query covers the header and every line.
      await assertCostCentresExist(tx, tenantId, collectCostCentreIds(docCostCenterId, items));

      const created = await tx.invoice.create({
        data: {
          invoiceNumber:
            incomingNumber ??
            (await generateNextInvoiceNumber(tx, tenantId, invoiceType, {
              costCenterId: docCostCenterId,
            })),
          invoiceType,
          // Contact-aware party: write contactId (new path) or customerId (legacy).
          // When contactId is set, customerId/billTo are null (both nullable post-migration).
          customerId: resolvedCustomerId,
          ...(resolvedContactId ? { contactId: resolvedContactId } : {}),
          ...(resolvedBillToContactId ? { billToContactId: resolvedBillToContactId } : {}),
          invoiceDate: safeDate(body.invoiceDate) ?? new Date(),
          dueDate: safeDate(body.dueDate),
          referenceNo: (body.referenceNo as string) ?? '',
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          status: status ?? 'DRAFT',
          payment_method: (body.payment_method as string) ?? null,
          taxableAmount: toDecimal(finalTaxable),
          TotalAmount: toDecimal(authTotal),
          vat: toDecimal(authVat),
          totalDiscount: toDecimal(finalDiscount),
          taxTreatment: docTreatment,
          reverseCharge: authReverseCharge,
          reverseChargeNote: authReverseChargeNote,
          roundOff: parseBool(body.roundOff),
          bankId: (body.bank as string) || null,
          notes: (body.notes as string) ?? '',
          termsAndCondition: (body.termsAndCondition as string) ?? '',
          // Recurring retired: never written from the invoice editor. Schema
          // defaults keep isRecurring=false and cadence columns null.
          sign_type: signType as Invoice['sign_type'],
          signatureName,
          signatureImage,
          signatureId,
          billFrom: body.billFrom as string,
          billTo: resolvedBillTo,
          tenantId,
          approvalStatus: initialApprovalStatus(approvalsEnabled),
          // G: persist document currency/rate (null when absent → functional currency)
          ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
          ...(docExchangeRate !== undefined ? { exchangeRate: docExchangeRate } : {}),
          // P3.3: persist dimension tags (null when absent → unchanged)
          costCenterId: docCostCenterId,
          projectId: docProjectId,
          ...(sanitizePaymentOptions(body.paymentOptions)
            ? { paymentOptions: sanitizePaymentOptions(body.paymentOptions) as object }
            : {}),
        },
      });

      // Inventory side-effect (skip for PROFORMA — no stock movement until conversion)
      // B.4: accumulate total COGS across all inventory items for GL posting after the loop.
      // P3.5: FIFO products consume from cost layers; WAC products use existing applyIssue.
      //
      // FIFO + approvals documented v1 behaviour:
      //   Layer consumption happens at CREATE time only. If approvalsEnabled is true,
      //   FIFO layer consumption still occurs here (at create). On approve, the same
      //   totalCogs computed here is re-posted (via postInvoiceLedger) — layers are NOT
      //   re-consumed. This avoids double-consumption. The limitation: if approvals are
      //   enabled and an invoice is rejected then re-created, the layers from the first
      //   create are already consumed. This is a documented v1 limitation.
      // B.4: accumulate COGS from pre-adjustment inventory state (WAC: avgCost × qty;
      // FIFO: cogs=0 since avgCost is not maintained — consistent with approve-path behaviour).
      // DB writes (find-or-create + quantityOnHand/quantity/history) delegated to helper,
      // which also removes the silent skip on missing/insufficient inventory rows.
      let totalCogs = ZERO;
      if (invoiceType !== 'PROFORMA') {
        for (const item of items) {
          const productId = item.productId ?? item.id;
          if (!productId || !item.qty) continue;

          // Belt-and-braces: even if an Inventory row exists, never deduct for Service products.
          const product = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { item_type: true, valuationMethod: true },
          });
          if (product?.item_type === 'Service') continue;

          // Compute COGS from pre-adjustment state (WAC only; FIFO avgCost=0 → cogs=0 as documented).
          if (product?.valuationMethod !== 'FIFO') {
            const invForCogs = await tx.inventory.findFirst({
              where: { productId, tenantId, isDeleted: false },
            });
            if (invForCogs) {
              const issue = applyWacIssue(
                { quantityOnHand: invForCogs.quantityOnHand, avgCost: invForCogs.avgCost },
                item.qty,
              );
              totalCogs = totalCogs.plus(issue.cogs);
            }
          }

          // Delegate all DB writes (find-or-create, quantity/quantityOnHand/avgCost/history) to helper.
          // The helper removes the old silent-skip: rows are auto-created and stock can go to/below zero.
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId: requireTenantId(req),
            qtyDelta: -item.qty,
            type: 'stock_out',
            referenceType: 'invoice',
            referenceId: created.id,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock reduced due to Invoice #${created.referenceNo || created.id}`,
              createdBy: requireActingUserId(req),
            },
          });
        }
      }

      // Auto-create payment row when invoice ships as PAID.
      const effectiveStatus = status ?? 'DRAFT';
      let autoPayment: { id: string; amount: Prisma.Decimal } | null = null;
      if (effectiveStatus === 'PAID' && body.payment_method) {
        // Resolve payment mode: a CASH payment never touches a bank register.
        const pmAuto = await tx.paymentMode.findUnique({
          where: { id: body.payment_method as string },
          select: { id: true, slug: true },
        });
        const isCashAuto = pmAuto?.slug?.toLowerCase() === 'cash';
        const autoBank = !isCashAuto && body.bank
          ? await tx.bankDetail.findFirst({ where: { id: body.bank as string, tenantId } })
          : null;

        // Book the auto-payment at the SAME server total the invoice PERSISTED at
        // (authTotal), NOT enforcedTotal — for flat tax regimes the server recompute
        // can move tax so the two differ, which would leave a "PAID" invoice with a
        // residual balance (paid ≠ total).
        autoPayment = await tx.invoicePayment.create({
          data: {
            tenantId: tenantId,
            invoiceId: created.id,
            amount: toDecimal(authTotal),
            paymentModeId: body.payment_method as string,
            bankId: autoBank ? autoBank.id : ((body.bank as string) ?? ''),
            // A bank-backed auto-payment MOVES bankDetail.currentBalance below, so
            // delete/void must reverse it. Cash never touches the register → false.
            movedBankBalance: !!autoBank,
            received_on: safeDate(body.payment_date) ?? new Date(),
            notes: (body.payment_notes as string) ?? 'Full payment received upon invoice creation',
            received_by: requireActingUserId(req),
            // Persist the SAME rate the register-move below uses (docExchangeRate) so
            // reverseInvoicePaymentEffects' baseFor(amount, exchangeRate) refund on
            // delete/void is symmetric with the create-time toBaseAmount move. Base
            // currency (undefined) omits the field → rate 1 both ways, unchanged.
            ...(docExchangeRate !== undefined ? { exchangeRate: docExchangeRate } : {}),
          },
        });

        // Move the bank register + write the linked bankTransaction (mirror
        // recordInvoicePayment) so the received money actually enters the account.
        if (autoBank && invoiceType !== 'PROFORMA') {
          const autoPayDate = safeDate(body.payment_date) ?? new Date();
          const autoBaseAmount = toBaseAmount(authTotal, docExchangeRate ?? null);
          const autoBalanceBefore = Number(autoBank.currentBalance ?? 0);
          const autoNewBalance = Number((autoBalanceBefore + autoBaseAmount).toFixed(2));
          await tx.bankDetail.update({
            where: { id: autoBank.id },
            data: { currentBalance: toDecimal(autoNewBalance), asOnDate: new Date() },
          });
          await tx.bankTransaction.create({
            data: {
              tenantId: tenantId,
              bankAccountId: autoBank.id,
              transactionDate: autoPayDate,
              type: 'TRANSFER_IN',
              amount: toDecimal(autoBaseAmount),
              balanceBefore: toDecimal(autoBalanceBefore),
              balanceAfter: toDecimal(autoNewBalance),
              paymentModeId: pmAuto!.id,
              remarks: `Invoice Payment - ${created.invoiceNumber ?? created.id}`,
              relatedType: 'INVOICE_PAYMENT',
              relatedId: autoPayment.id,
              // Reconciled iff the payment JE actually posts on create (approvals off).
              ...explainedBankFields({
                postedSourceType: 'InvoicePayment',
                postedSourceId: autoPayment.id,
                posted: shouldPostOnCreate(approvalsEnabled),
                approvedById: tenantId,
                approvedAt: new Date(),
              }),
            },
          });
        }
      }

      // GL posting — gated by approval status.
      // When approvals are enabled, posting is deferred until approveInvoice fires.
      if (shouldPostOnCreate(approvalsEnabled)) {
        await postInvoiceLedger(tx, created, tenantId, totalCogs);
        if (autoPayment && invoiceType !== 'PROFORMA') {
          // Resolve payment mode slug to determine CASH vs BANK
          const pmDoc = await tx.paymentMode.findUnique({
            where: { id: body.payment_method as string },
            select: { slug: true },
          });
          const autoBankGlAccountId = body.bank
            ? await resolveBankGlAccountId(tx as never, body.bank as string)
            : null;
          await postInvoicePayment(tx as unknown as PostingTx, {
            tenantId,
            invoiceId: created.id,
            paymentId: autoPayment.id,
            date: safeDate(body.payment_date) ?? new Date(),
            amount: String(autoPayment.amount),
            paymentModeSlug: pmDoc?.slug ?? null,
            bankGlAccountId: autoBankGlAccountId,
          });
        }
      }

      // Custom fields
      const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
      await insertCustomFieldValues(tx, created.id, tenantId, body.customFields, files);

      return created;
    });

    res.status(201).json({
      message: 'Invoice created successfully and inventory updated',
      data: invoice,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof UnknownCostCentreError) {
      res.status(400).json({ message: err.message, errors: { costCenterId: err.message } });
      return;
    }
    if (handleLedgerError(res, err)) return;
    console.error('Create invoice error:', err);
    res.status(500).json({
      message: 'Error creating invoice',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateInvoiceStatus
// =============================================================================

export async function updateInvoiceStatus(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { invoiceId, status } = req.body as { invoiceId?: string; status?: string };

    if (!invoiceId || !status) {
      res.status(400).json({ message: 'Invoice ID and new status are required' });
      return;
    }

    const upper = status.toUpperCase() as InvoiceStatus;
    if (!VALID_STATUSES.has(upper)) {
      res.status(400).json({ message: `Invalid status: ${status}` });
      return;
    }

    // Safe-transition guard. This endpoint carries NO financial side effects, so
    // it must never be used to jump straight to a state that requires them:
    //   - PAID / PARTIALLY_PAID are derived from actual payments + credit notes
    //     (record a payment / issue a credit note instead).
    //   - CANCELLED needs GL reversal + stock restore + payment void — only
    //     delete/void does that. Setting it here would strand the ledger & stock.
    // Allowed (display-only, no side effects): DRAFT / SENT / OVERDUE / UNPAID.
    if (DERIVED_PAYMENT_STATUSES.has(upper)) {
      res.status(409).json({
        message:
          'Payment status (PAID/PARTIALLY_PAID) is derived from recorded payments and credit notes and cannot be set directly. Record a payment or issue a credit note instead.',
      });
      return;
    }
    if (upper === 'CANCELLED') {
      res.status(409).json({
        message:
          'Cancel an invoice by deleting or voiding it so its ledger entries and stock are reversed, rather than setting the status directly.',
      });
      return;
    }

    const existing = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!existing) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: upper },
    });

    res.status(200).json({ message: `Invoice status updated to ${status}`, data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Update invoice status error:', err);
    res.status(500).json({
      message: 'Error updating invoice status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// sendInvoiceEmail (mailer call preserved, status flipped to SENT)
// =============================================================================

export async function sendInvoiceEmail(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { invoiceId, to, cc, subject, htmlContent, sendAttachment = false } = req.body as {
      invoiceId?: string;
      to?: string;
      cc?: string;
      subject?: string;
      htmlContent?: string;
      sendAttachment?: boolean;
    };

    if (!invoiceId || !to || !subject || !htmlContent) {
      res.status(400).json({ message: 'Required fields missing' });
      return;
    }

    const owned = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!owned) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    const { sendMail } = mailerModule;

    const mailOptions: Record<string, unknown> = {
      to,
      cc: cc || undefined,
      subject,
      html: htmlContent,
    };

    if (sendAttachment) {
      const pdfPath = `${process.env.INVOICE_UPLOAD_PATH || './uploads/invoices'}/${invoiceId}.pdf`;
      // Only attach if the PDF exists; skip gracefully if it hasn't been generated
      const fs = await import('fs');
      if (fs.existsSync(pdfPath)) {
        mailOptions.attachments = [
          {
            filename: `Invoice-${invoiceId}.pdf`,
            path: pdfPath,
          },
        ];
      } else {
        console.warn(`Invoice PDF not found at ${pdfPath}; sending email without attachment`);
      }
    }

    await sendMail(mailOptions);

    // Compute target status: only promote draft → sent; leave every other
    // status (SENT/OVERDUE/PARTIALLY_PAID/PAID/CANCELLED/UNPAID) untouched —
    // a reminder send must not silently reset payment-status tracking.
    // Mirrors quotationController's sendQuotationEmailAndUpdateStatus.
    const nextStatus: InvoiceStatus = owned.status === 'DRAFT' ? 'SENT' : owned.status;

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: nextStatus },
    });

    res.status(200).json({
      success: true,
      message: "Invoice email sent and status updated to 'sent'",
      data: updated,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Failed to send invoice email:', err);
    if ((err as NodeJS.ErrnoException).code === 'EMAIL_NOT_CONFIGURED') {
      res.status(422).json({ success: false, message: (err as Error).message });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send invoice email',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateInvoice
// =============================================================================

export async function updateInvoice(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const tenantId = requireTenantId(req);
    const { id: invoiceId } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!existing) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    if (existing.convertedAt) {
      res.status(400).json({
        success: false,
        message: 'Cannot edit a proforma that has been converted to an invoice',
      });
      return;
    }

    // Profit centre: an omitted field keeps whatever the document already has;
    // an explicitly blank one clears it. Resolved before normaliseItems so the
    // lines inherit the centre this update is actually persisting.
    const docCostCenterId =
      body.costCenterId === undefined
        ? existing.costCenterId
        : (typeof body.costCenterId === 'string' && body.costCenterId ? body.costCenterId : null);
    const items = normaliseItems(body.items, docCostCenterId);

    // Only draft invoices can be edited. Once an invoice is sent/paid, status
    // changes (mark-sent, record-payment, write-off) go through their own
    // dedicated endpoints — the full-form update is locked to protect issued docs.
    if (existing.status !== 'DRAFT') {
      res.status(409).json({
        success: false,
        message: `Only draft invoices can be edited (current status: ${existing.status}).`,
      });
      return;
    }

    // Currency may still be supplied on a draft edit (no paid-invoice guard
    // needed here: the DRAFT-only check above means there are no payments yet).
    const incomingCurrencyCode =
      typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : undefined;

    // Server-authoritative totals (see createInvoice): recompute from items,
    // ignore client-sent totals (compare + warn only). updateInvoice is
    // DRAFT-only, but the persisted numbers must still be server-derived.
    const serverTotals = computeDocumentTotals(items as TotalsItem[]);
    const clientGrandTotal = asNumber(body.grandTotal, asNumber(body.TotalAmount, NaN));
    warnOnTotalsDivergence('invoice', invoiceId, clientGrandTotal, serverTotals.grandTotal);
    const finalTaxable = serverTotals.subTotal;
    const finalTotal = serverTotals.grandTotal;
    const finalVat = serverTotals.totalTax;
    const finalDiscount = serverTotals.totalDiscount;

    // C3: per-document tax treatment on update.
    // Resolve contact's defaultTaxTreatment (tenant-scoped) if available.
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

    // Party resolution (contact-first) — mirrors createInvoice.
    // The legacy `billTo` is a Customer scalar FK; on contact-migrated invoices
    // the party is a Contact, so blindly writing the incoming party id into
    // `billTo` throws a Prisma P2003 foreign-key violation (-> 500). Resolve the
    // incoming party against the contact model and write the correct relation:
    //   - contactId present  -> set the Contact relation(s), clear legacy customer
    //   - legacy billTo/customerId that maps to a Contact -> same (relink contact)
    //   - genuinely legacy customer (no contact) -> keep the Customer relation
    // When no party fields are supplied on the update, leave the existing party
    // untouched (partyUpdate stays empty).
    const incomingContactId =
      typeof body.contactId === 'string' && body.contactId ? body.contactId : null;
    const incomingBillToContactId =
      typeof body.billToContactId === 'string' && body.billToContactId ? body.billToContactId : null;
    const incomingLegacyCustomerId =
      (typeof body.billTo === 'string' && body.billTo ? body.billTo : null) ??
      (typeof body.customerId === 'string' && body.customerId ? body.customerId : null);

    // Scalar (unchecked) FK assignments for the Invoice party. The surrounding
    // `data` block writes unchecked scalars (tenantId, billFrom, ...), so the party
    // must also be expressed as scalar FKs — but resolved to the CORRECT column:
    //   contactId / billToContactId  (new Contact party)  vs
    //   customerId / billTo          (legacy Customer party).
    // Writing a Contact id into the Customer `billTo` column is exactly the bug
    // that caused P2003 -> 500. When no party fields are supplied, leave the
    // existing party untouched (partyUpdate stays empty).
    const partyUpdate: {
      contactId?: string | null;
      billToContactId?: string | null;
      customerId?: string | null;
      billTo?: string | null;
    } = {};

    if (incomingContactId) {
      // New contact-based party: verify ownership, set Contact FKs, clear legacy.
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
      // Legacy party id supplied. Prefer relinking to a Contact: the contact-first
      // picker sends a Contact id in billTo, so match EITHER the contact's
      // legacyCustomerId OR the Contact id directly. Only fall back to the legacy
      // Customer FK when the id is a genuine Customer — otherwise 400 (writing a
      // contactId into customerId/billTo violates the Customer FK → P2003 500).
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
    const enforcedInvoice = applyDocumentTreatment(docTreatment, finalVat, items);
    const enforcedVat = enforcedInvoice.tax;
    const enforcedItems = enforcedInvoice.items;
    const enforcedTotal = docTreatment === 'STANDARD' ? finalTotal : finalTaxable + enforcedVat - finalDiscount;

    // Signature handling
    const signType = (body.sign_type as string) ?? existing.sign_type;
    let signatureImage: string | null = existing.signatureImage;
    let signatureName: string | null = existing.signatureName;
    let signatureId: string | null = existing.signatureId;

    if (signType === 'eSignature') {
      if (req.file) signatureImage = req.file.path;
      signatureName = (body.signatureName as string) ?? existing.signatureName;
      signatureId = null;
    } else if (signType === 'digitalSignature') {
      const sigId = body.signatureId as string | undefined;
      if (sigId) {
        const sig = await prisma.signature.findFirst({ where: { id: sigId, tenantId } });
        if (!sig) {
          res.status(404).json({ message: 'Digital Signature not found' });
          return;
        }
        signatureId = sigId;
        signatureName = null;
        signatureImage = null;
      }
    }

    // Recurring is retired from the invoice editor. The edit path no longer
    // writes any recurring/cadence fields; existing column values are left
    // untouched. Recurring lifecycle lives in RecurringInvoiceSchedule.

    const updated = await prisma.$transaction(async (tx) => {
      // Server-authoritative tax recompute (tax packs), mirroring createInvoice.
      // updateInvoice is DRAFT-only (no GL posting here), but the persisted tax must
      // still be authoritative for the flat per-country regimes. Non-flat regimes
      // and suppressing treatments fall through to the existing values.
      const settings = await tx.companySettings.findFirst({ where: { tenantId } });
      let authVat = enforcedVat;
      let authTotal = enforcedTotal;
      let authReverseCharge: boolean | null = existing.reverseCharge ?? false;
      let authReverseChargeNote: string | null = existing.reverseChargeNote ?? null;
      const regime = settings?.taxRegime ?? 'NONE';
      if (docTreatment === 'STANDARD' && isFlatRegime(regime)) {
        const supplierCountry = await resolveSupplierCountry(tx, settings);
        const customerContactId = partyUpdate.contactId ?? existing.contactId;
        let customerCtx = { customerCountry: null as string | null, customerVatNumber: null as string | null };
        if (regime === 'VAT_EU' && customerContactId) {
          const custContact = (await cdb().contact.findFirst({
            where: { id: customerContactId, tenantId, isDeleted: false },
            select: { country: true, countryId: true, vatNumber: true, vatRegNumber: true },
          } as never)) as
            | { country: string | null; countryId: string | null; vatNumber: string | null; vatRegNumber: string | null }
            | null;
          customerCtx = await resolveCustomerTaxContext(tx, custContact);
        }
        const recomputed = recomputeServerTax({
          regime,
          items: enforcedItems,
          supplierCountry,
          customerCountry: customerCtx.customerCountry,
          customerVatNumber: customerCtx.customerVatNumber,
          // OSS: destination-rate VAT for B2C cross-border when the tenant is registered.
          ossRegistered: settings?.ossRegistered === true,
        });
        if (recomputed) {
          authVat = recomputed.totalTax;
          authTotal = finalTaxable + recomputed.totalTax - finalDiscount;
          authReverseCharge = recomputed.reverseCharge;
          // Reuse reverseChargeNote to persist the OSS marker too (no new column).
          authReverseChargeNote = recomputed.note;
        }
      }

      await assertCostCentresExist(tx, tenantId, collectCostCentreIds(docCostCenterId, items));

      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          ...(body.invoiceType !== undefined
            ? { invoiceType: body.invoiceType as 'INVOICE' | 'PROFORMA' }
            : {}),
          invoiceDate: safeDate(body.invoiceDate) ?? existing.invoiceDate,
          dueDate: safeDate(body.dueDate) ?? existing.dueDate,
          referenceNo: (body.referenceNo as string) ?? '',
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          status: ((body.status as string)?.toUpperCase() as InvoiceStatus) ?? existing.status,
          payment_method: (body.payment_method as string) ?? existing.payment_method,
          taxableAmount: toDecimal(finalTaxable),
          TotalAmount: toDecimal(authTotal),
          vat: toDecimal(authVat),
          totalDiscount: toDecimal(finalDiscount),
          taxTreatment: docTreatment,
          reverseCharge: authReverseCharge,
          reverseChargeNote: authReverseChargeNote,
          roundOff: parseBool(body.roundOff),
          bankId: (body.bank as string) || null,
          notes: (body.notes as string) ?? '',
          termsAndCondition: (body.termsAndCondition as string) ?? '',
          // Recurring retired: edit path no longer writes recurring/cadence
          // fields. Existing column values (if any) are preserved untouched.
          sign_type: signType as Invoice['sign_type'],
          signatureName,
          signatureImage,
          signatureId,
          billFrom: (typeof body.billFrom === 'string' && body.billFrom)
            ? (body.billFrom as string)
            : existing.billFrom,
          // Party (contact-first) relations resolved above. Never write a Contact
          // id into the legacy `billTo`/`billToCustomer` Customer FK (-> P2003 500).
          ...partyUpdate,
          tenantId,
          // C.1: persist updated currencyCode when provided and lock guard passed
          ...(incomingCurrencyCode !== undefined ? { currencyCode: incomingCurrencyCode } : {}),
          ...(body.paymentOptions !== undefined
            ? { paymentOptions: (sanitizePaymentOptions(body.paymentOptions) ?? []) as object }
            : {}),
          // Previously the update path never persisted the dimension at all, so
          // a draft's department could be set on create but never corrected.
          costCenterId: docCostCenterId,
          ...(body.projectId !== undefined
            ? { projectId: (typeof body.projectId === 'string' && body.projectId ? body.projectId : null) }
            : {}),
        },
      });

      // -----------------------------------------------------------------------
      // P1-3: stock coherence on a draft edit.
      // createInvoice deducts stock for EVERY non-PROFORMA invoice (regardless of
      // DRAFT status), and the P1-1 deleteInvoice restores the invoice's CURRENT
      // items. So a draft edit MUST keep inventory in step with the new line
      // quantities — otherwise deletion would restore quantities that were never
      // the ones deducted, leaving phantom stock (create −5, edit→10 no-op,
      // delete +10 ⇒ +5 phantom). Mirror updatePurchase: fully REVERT the
      // previously-applied issue for the old items, then RE-APPLY the issue for
      // the new items (net = the per-line delta). The revert is an avgCost-neutral
      // receipt (receive at the current avgCost so the WAC average is unchanged;
      // FIFO simply re-layers the qty), and the re-apply is a plain issue (issues
      // never touch avgCost). Skipped for PROFORMA on either side (never stocked).
      const priorItems = Array.isArray(existing.items)
        ? (existing.items as unknown as IncomingItem[])
        : [];
      const existingWasStock = existing.invoiceType !== 'PROFORMA';
      const effectiveInvoiceType =
        (typeof body.invoiceType === 'string' && body.invoiceType) || existing.invoiceType;
      const newIsStock = effectiveInvoiceType !== 'PROFORMA';

      if (existingWasStock) {
        for (const item of priorItems) {
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          const qty = asNumber(item.qty, 0);
          if (!qty) continue;
          const product = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          // Receive back at the current avgCost so reversing the issue leaves the
          // WAC average unchanged (a receipt at avg is a blend no-op).
          const invRow = await tx.inventory.findFirst({
            where: { productId, tenantId, isDeleted: false },
          });
          const revertUnitCost = invRow ? Number(invRow.avgCost) : 0;
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId,
            qtyDelta: qty,
            type: 'stock_in',
            referenceType: 'invoice',
            referenceId: invoiceId,
            unitCost: revertUnitCost,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock reverted from invoice update ${existing.invoiceNumber ?? invoiceId}`,
              createdBy: requireActingUserId(req),
            },
          });
        }
      }

      if (newIsStock) {
        for (const item of items) {
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          if (!item.qty) continue;
          const product = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId,
            qtyDelta: -item.qty,
            type: 'stock_out',
            referenceType: 'invoice',
            referenceId: invoiceId,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock reduced due to Invoice #${existing.invoiceNumber ?? invoiceId}`,
              createdBy: requireActingUserId(req),
            },
          });
        }
      }

      // -----------------------------------------------------------------------
      // P1-3: GL coherence on a draft edit.
      // Keep the ledger in step with the persisted (server-authoritative) totals.
      // When the invoice was ALREADY posted — approvals off (NOT_REQUIRED, posted
      // at create) or already APPROVED (posted at approve) — void the stale
      // issued + cogs entries via voidDocument (P0-1 void+repost pattern;
      // voidDocument frees the idempotency slot). If the edit demotes the
      // document to PROFORMA, stop there: a proforma must carry no GL, mirroring
      // the stock side above (revert, don't re-apply). Otherwise re-post at the
      // new figures via the shared postInvoiceLedger. COGS is recomputed from the
      // persisted items + current avgCost (stable: the re-apply above is
      // avgCost-neutral). When the invoice is still PENDING/REJECTED it was never
      // posted — approveInvoice will post the edited figures later — so we skip
      // here and never post an unapproved draft. All GL calls are no-ops when the
      // tenant ledger is uninitialised (gatedPost) or the entry is absent
      // (voidDocument), so this is safe for non-ledger installs too.
      const glWasPosted =
        existing.approvalStatus === 'NOT_REQUIRED' || existing.approvalStatus === 'APPROVED';
      if (glWasPosted) {
        await voidDocument(tx as unknown as PostingTx, {
          tenantId, sourceType: 'Invoice', sourceId: invoiceId, event: 'issued',
        });
        await voidDocument(tx as unknown as PostingTx, {
          tenantId, sourceType: 'Invoice', sourceId: invoiceId, event: 'cogs',
        });
        if (updatedInvoice.invoiceType !== 'PROFORMA') {
          await postInvoiceLedger(tx, updatedInvoice, tenantId);
        }
      }

      // Custom fields: delete then reinsert
      await tx.customFieldValue.deleteMany({
        where: { tenantId, module: 'invoice', recordId: invoiceId },
      });
      const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
      await insertCustomFieldValues(tx, invoiceId, tenantId, body.customFields, files);

      return updatedInvoice;
    });

    res.status(200).json({ message: 'Invoice updated successfully', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof UnknownCostCentreError) {
      res.status(400).json({ message: err.message, errors: { costCenterId: err.message } });
      return;
    }
    if (handleLedgerError(res, err)) return;
    console.error('Update invoice error:', err);
    res.status(500).json({
      message: 'Error updating invoice',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getInvoice (used by both /:id and the public /details/:id)
// =============================================================================

export async function getInvoice(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req);
    const baseUrl = buildBaseUrl(req);

    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true, vatRegNumber: true, gstin: true, addressLine1: true, addressLine2: true, addressLine3: true, town: true, region: true, postcode: true, country: true },
        },
        billToContact: {
          select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true, vatRegNumber: true, gstin: true, addressLine1: true, addressLine2: true, addressLine3: true, town: true, region: true, postcode: true, country: true },
        },
        customer: {
          select: { id: true, name: true, email: true, phone: true, image: true, billingAddress: true },
        },
        billFromUser: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, address: true, profileImage: true },
        },
        billToCustomer: {
          select: { id: true, name: true, email: true, phone: true, billingAddress: true, image: true },
        },
        bank: {
          select: { id: true, accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true },
        },
        signature: {
          select: { id: true, signatureName: true, signatureImage: true },
        },
      },
    });

    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    // Sum non-voided payments so the edit view shows accurate Paid / Remaining.
    const paymentAgg = await prisma.invoicePayment.aggregate({
      where: { invoiceId: invoice.id, isVoided: false },
      _sum: { amount: true },
      _max: { received_on: true },
    });
    const totalPaid = Number(paymentAgg._sum.amount ?? 0);

    const invoiceModule = await prisma.module.findFirst({ where: { moduleSlug: 'invoices' } });
    let tableFields: { id: string; fieldSlug: string; labelName: string }[] = [];
    if (invoiceModule) {
      tableFields = await prisma.customField.findMany({
        where: { tenantId, moduleId: invoiceModule.id, deletedAt: null },
        select: { id: true, fieldSlug: true, labelName: true },
      });
    }
    const customValues = await prisma.customFieldValue.findMany({
      where: { tenantId, module: 'invoice', recordId: invoice.id },
    });
    const customValueMap: Record<string, Prisma.JsonValue> = {};
    customValues.forEach((v) => {
      customValueMap[v.customFieldId] = v.value;
    });
    const customFieldsObject: Record<string, Prisma.JsonValue | null> = {};
    tableFields.forEach((field) => {
      customFieldsObject[field.fieldSlug] = customValueMap[field.id] ?? null;
    });

    // Prefer contact for display; fall back to legacy customer when no contactId.
    const contactForDisplay = invoice.contact
      ? {
          id: invoice.contact.id,
          name: resolveDisplayName(invoice.contact),
          email: invoice.contact.email ?? null,
          phone: invoice.contact.mobile ?? null,
          image: '',
          billingAddress: contactBillingAddress(invoice.contact),
          vatRegNumber: invoice.contact.vatRegNumber ?? null,
          gstin: invoice.contact.gstin ?? null,
        }
      : null;
    const billToContactForDisplay = invoice.billToContact
      ? {
          id: invoice.billToContact.id,
          name: resolveDisplayName(invoice.billToContact),
          email: invoice.billToContact.email ?? null,
          phone: invoice.billToContact.mobile ?? null,
          image: '',
          billingAddress: contactBillingAddress(invoice.billToContact),
          vatRegNumber: invoice.billToContact.vatRegNumber ?? null,
          gstin: invoice.billToContact.gstin ?? null,
        }
      : null;

    const responseData = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: invoice.invoiceType,
      publicViewToken: invoice.publicViewToken,
      publicViewEnabled: invoice.publicViewEnabled,
      paymentOptions: invoice.paymentOptions ?? [],
      // Contact-aware: prefer contact relation; fall back to legacy customer.
      contactId: invoice.contactId ?? null,
      customer: contactForDisplay ?? formatCustomer(invoice.customer, baseUrl, true),
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      referenceNo: invoice.referenceNo,
      status: invoice.status,
      payment_method: invoice.payment_method,
      taxableAmount: invoice.taxableAmount,
      totalDiscount: invoice.totalDiscount,
      vat: invoice.vat,
      TotalAmount: invoice.TotalAmount,
      roundOff: invoice.roundOff,
      totalPaid,
      lastPaymentDate: paymentAgg._max.received_on ?? null,
      items: invoice.items,
      itemsCount: Array.isArray(invoice.items) ? invoice.items.length : 0,
      billFrom: formatBillFromUser(invoice.billFromUser, baseUrl),
      // Contact-aware: prefer billToContact; fall back to legacy billToCustomer.
      billToContactId: invoice.billToContactId ?? null,
      billTo: billToContactForDisplay ?? formatCustomer(invoice.billToCustomer, baseUrl, true),
      bank: formatBank(invoice.bank),
      notes: invoice.notes,
      termsAndCondition: invoice.termsAndCondition,
      isRecurring: invoice.isRecurring,
      repeatEvery: invoice.isRecurring ? invoice.repeatEvery : null,
      customIntervalNumber: invoice.isRecurring ? invoice.customIntervalNumber : null,
      customIntervalType: invoice.isRecurring ? invoice.customIntervalType : null,
      startOn: invoice.isRecurring ? invoice.startOn : null,
      endsOn: invoice.isRecurring ? invoice.endsOn : null,
      neverExpire: invoice.isRecurring ? invoice.neverExpire : null,
      stopped: invoice.isRecurring ? invoice.stopped : null,
      nextRecurringDate: invoice.isRecurring ? invoice.nextRecurringDate : null,
      sign_type: invoice.sign_type,
      signature: formatSignature(invoice, baseUrl),
      customFields: customFieldsObject,
      currencyCode: invoice.currencyCode ?? null, // C.1
      taxTreatment: invoice.taxTreatment ?? null, // C.2
      reverseCharge: invoice.reverseCharge ?? false, // tax packs: EU reverse-charge marker
      reverseChargeNote: invoice.reverseChargeNote ?? null,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };

    res.status(200).json({
      success: true,
      message: 'Invoice retrieved successfully',
      data: responseData,
    });
  } catch (err) {
    console.error('Get invoice error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching invoice',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getAllInvoices (parent invoices only)
// =============================================================================

// (No-op placeholder removed in favour of buildInvoiceList below.)

interface ListQuery {
  page?: string;
  limit?: string;
  status?: string;
  search?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  payment_method?: string;
  // Aging drill-down: filter by dueDate window instead of invoiceDate.
  dueStartDate?: string;
  dueEndDate?: string;
  // Department filter. Accepts a CSV of ids, or the literal "none" for
  // documents that carry no profit centre at all.
  costCenterId?: string;
}

async function buildInvoiceList(
  req: Request,
  res: Response,
  parentClause: Prisma.InvoiceWhereInput,
): Promise<void> {
  const scope = tenantScope(req);
  const { page = '1', limit = '10', status, search = '', customerId, startDate, endDate, payment_method, dueStartDate, dueEndDate, costCenterId } =
    req.query as ListQuery;
  const pageN = Number(page);
  const limitN = Number(limit);
  const skip = (pageN - 1) * limitN;

  const where: Prisma.InvoiceWhereInput = {
    ...scope,
    ...parentClause,
  };
  // `status` accepts a single value or a comma-separated list (the aging
  // drill-down passes the full unpaid set, e.g. UNPAID,PARTIALLY_PAID,OVERDUE,SENT).
  if (status) {
    const statuses = status
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is InvoiceStatus => VALID_STATUSES.has(s as InvoiceStatus));
    if (statuses.length === 1) where.status = statuses[0];
    else if (statuses.length > 1) where.status = { in: statuses };
  }
  if (customerId) where.customerId = customerId;
  if (costCenterId) {
    // "none" selects the untagged documents that land in the report's
    // Common / Unallocated column, so the list and the report agree.
    const ids = String(costCenterId).split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 1 && ids[0] === "none") where.costCenterId = null;
    else if (ids.length === 1) where.costCenterId = ids[0];
    else if (ids.length > 1) where.costCenterId = { in: ids };
  }
  if (payment_method) where.payment_method = payment_method;
  const invoiceTypeFilter = req.query.invoiceType as string | undefined;
  if (invoiceTypeFilter === 'INVOICE' || invoiceTypeFilter === 'PROFORMA') {
    where.invoiceType = invoiceTypeFilter;
  }
  if (startDate || endDate) {
    where.invoiceDate = {};
    if (startDate) (where.invoiceDate as Prisma.DateTimeFilter).gte = new Date(startDate);
    if (endDate) (where.invoiceDate as Prisma.DateTimeFilter).lte = new Date(endDate);
  }
  // Aging drill-down: dueDate window (lets a clicked aging bucket land on exactly
  // the invoices whose due date falls in that bucket's date range).
  if (dueStartDate || dueEndDate) {
    where.dueDate = {};
    if (dueStartDate) (where.dueDate as Prisma.DateTimeFilter).gte = new Date(dueStartDate);
    if (dueEndDate) (where.dueDate as Prisma.DateTimeFilter).lte = new Date(dueEndDate);
  }
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { referenceNo: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
      // N1: also search contact-based invoices by organisation or first/last name
      { contact: { organisation: { contains: search, mode: 'insensitive' } } },
      { contact: { firstName: { contains: search, mode: 'insensitive' } } },
      { contact: { lastName: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const baseUrl = buildBaseUrl(req);

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
        billToContact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
        customer: { select: { id: true, name: true, email: true, phone: true, image: true } },
        billFromUser: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, address: true, profileImage: true } },
        billToCustomer: { select: { id: true, name: true, email: true, phone: true, billingAddress: true, image: true } },
        bank: { select: { id: true, accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true } },
        costCenter: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitN,
    }),
  ]);

  const invoiceIds = invoices.map((i) => i.id);

  // Custom field setup
  const invoiceModule = await prisma.module.findFirst({ where: { moduleSlug: 'invoices' } });
  let tableFields: { id: string; fieldSlug: string; labelName: string }[] = [];
  if (invoiceModule) {
    tableFields = await prisma.customField.findMany({
      where: { tenantId: scope.tenantId, moduleId: invoiceModule.id, showInTable: true, deletedAt: null },
      select: { id: true, fieldSlug: true, labelName: true },
    });
  }
  const customValues = await prisma.customFieldValue.findMany({
    where: { tenantId: scope.tenantId, module: 'invoice', recordId: { in: invoiceIds } },
  });
  const customValueMap: Record<string, Record<string, Prisma.JsonValue>> = {};
  for (const v of customValues) {
    if (!customValueMap[v.recordId]) customValueMap[v.recordId] = {};
    customValueMap[v.recordId][v.customFieldId] = v.value;
  }

  // Payment aggregation
  const paymentGroups =
    invoiceIds.length > 0
      ? await prisma.invoicePayment.groupBy({
          by: ['invoiceId'],
          where: { invoiceId: { in: invoiceIds }, isVoided: false },
          _sum: { amount: true },
          _max: { received_on: true },
        })
      : [];
  const paymentMap: Record<string, { totalPaid: number; lastPaymentDate: Date | null }> = {};
  for (const p of paymentGroups) {
    paymentMap[p.invoiceId] = {
      totalPaid: Number(p._sum.amount ?? 0),
      lastPaymentDate: p._max.received_on ?? null,
    };
  }

  // Net applied credit notes against each invoice's due. A credit note posts
  // Cr AR for its total, so remainingBalance must subtract them or a fully
  // credit-noted invoice reads UNPAID here while AR aging shows it settled.
  // Same netting the aging report uses (creditNoteTotalsByInvoice) → both agree.
  const creditNoteMap =
    invoiceIds.length > 0
      ? creditNoteTotalsByInvoice(
          await prisma.creditNote.findMany({
            where: { tenantId: scope.tenantId, isDeleted: false, invoiceId: { in: invoiceIds } },
            select: { invoiceId: true, totalAmount: true },
          }),
        )
      : new Map<string, Prisma.Decimal>();

  // Next invoice number — this tenant's series, not the install's.
  const lastInvoice = await prisma.invoice.findFirst({
    where: { tenantId: scope.tenantId, invoiceNumber: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { invoiceNumber: true },
  });
  let nextInvoiceNumber = 'INV-000001';
  if (lastInvoice?.invoiceNumber) {
    const m = lastInvoice.invoiceNumber.match(/(\D*)(\d+)$/);
    if (m) {
      nextInvoiceNumber = `${m[1]}${String(parseInt(m[2], 10) + 1).padStart(6, '0')}`;
    }
  }

  const formatted = invoices.map((invoice) => {
    const totalPaidInfo = paymentMap[invoice.id] ?? { totalPaid: 0, lastPaymentDate: null };
    const customFieldsObject: Record<string, Prisma.JsonValue | null> = {};
    const invoiceValues = customValueMap[invoice.id] ?? {};
    tableFields.forEach((f) => {
      customFieldsObject[f.fieldSlug] = invoiceValues[f.id] ?? null;
    });

    // Contact-aware party display: prefer contact relation; fall back to legacy customer.
    const contactForDisplay = invoice.contact
      ? {
          id: invoice.contact.id,
          name: resolveDisplayName(invoice.contact),
          email: invoice.contact.email ?? null,
          phone: invoice.contact.mobile ?? null,
          image: '',
        }
      : null;
    const billToContactForDisplay = invoice.billToContact
      ? {
          id: invoice.billToContact.id,
          name: resolveDisplayName(invoice.billToContact),
          email: invoice.billToContact.email ?? null,
          phone: invoice.billToContact.mobile ?? null,
          image: '',
          billingAddress: null,
        }
      : null;

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: invoice.invoiceType,
      convertedFromId: invoice.convertedFromId,
      convertedAt: invoice.convertedAt ? invoice.convertedAt.toISOString() : null,
      publicViewToken: invoice.publicViewToken,
      publicViewEnabled: invoice.publicViewEnabled,
      paymentOptions: invoice.paymentOptions ?? [],
      contactId: invoice.contactId ?? null,
      customer: contactForDisplay ?? formatCustomer(invoice.customer, baseUrl),
      invoiceDate: formatDateShort(invoice.invoiceDate),
      dueDate: formatDateShort(invoice.dueDate),
      referenceNo: invoice.referenceNo,
      status: invoice.status,
      payment_method: invoice.payment_method,
      taxableAmount: invoice.taxableAmount,
      totalDiscount: invoice.totalDiscount,
      vat: invoice.vat,
      TotalAmount: invoice.TotalAmount,
      roundOff: invoice.roundOff,
      totalPaid: totalPaidInfo.totalPaid,
      remainingBalance: netInvoiceOutstanding(
        invoice.TotalAmount,
        totalPaidInfo.totalPaid,
        creditNoteMap.get(invoice.id) ?? ZERO,
      ).toNumber(),
      lastPaymentDate: formatDateShort(totalPaidInfo.lastPaymentDate),
      items: invoice.items,
      itemsCount: Array.isArray(invoice.items) ? invoice.items.length : 0,
      billFrom: formatBillFromUser(invoice.billFromUser, baseUrl),
      billToContactId: invoice.billToContactId ?? null,
      billTo: billToContactForDisplay ?? formatCustomer(invoice.billToCustomer, baseUrl, true),
      bank: formatBank(invoice.bank),
      costCenterId: invoice.costCenterId ?? null,
      costCenter: invoice.costCenter
        ? { id: invoice.costCenter.id, code: invoice.costCenter.code, name: invoice.costCenter.name }
        : null,
      notes: invoice.notes,
      termsAndCondition: invoice.termsAndCondition,
      isRecurring: invoice.isRecurring,
      sign_type: invoice.sign_type,
      signature: invoice.sign_type === 'eSignature'
        ? { name: invoice.signatureName, image: invoice.signatureImage ? `${baseUrl}${invoice.signatureImage.replace(/\\/g, '/')}` : null }
        : null,
      customFields: customFieldsObject,
      currencyCode: invoice.currencyCode ?? null, // C.1
      taxTreatment: invoice.taxTreatment ?? null, // C.2
      reverseCharge: invoice.reverseCharge ?? false, // tax packs: EU reverse-charge marker
      reverseChargeNote: invoice.reverseChargeNote ?? null,
      createdAt: formatDateShort(invoice.createdAt),
      updatedAt: formatDateShort(invoice.updatedAt),
    };
  });

  res.status(200).json({
    success: true,
    message: 'Invoices retrieved successfully',
    data: {
      invoices: formatted,
      nextInvoiceNumber,
      pagination: {
        total,
        page: pageN,
        limit: limitN,
        totalPages: Math.ceil(total / limitN),
      },
    },
  });
}

export async function getAllInvoices(req: Request, res: Response): Promise<void> {
  try {
    // #33: hide recurring TEMPLATES only (isRecurring: true). Generated children
    // (isRecurring: false, parentInvoice set) and normal invoices must appear.
    // Filtering on `parentInvoice: null` here wrongly excluded every child.
    await buildInvoiceList(req, res, { isRecurring: false, isDeleted: false });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List invoices error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching invoices',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getChildInvoices(req: Request, res: Response): Promise<void> {
  try {
    await buildInvoiceList(req, res, { parentInvoice: { not: null }, isDeleted: false });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List child invoices error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching invoices',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getNextInvoiceNumber
// =============================================================================

export async function getNextInvoiceNumber(_req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(_req);
    const [prefixSetting, typeSetting, nextSetting] = await Promise.all([
      prisma.generalSetting.findUnique({ where: { tenantId_key: { tenantId, key: 'invoicePrefix' } } }),
      prisma.generalSetting.findUnique({ where: { tenantId_key: { tenantId, key: 'invoiceNumberType' } } }),
      prisma.generalSetting.findUnique({ where: { tenantId_key: { tenantId, key: 'nextInvoiceNo' } } }),
    ]);

    // #21: unify fallback prefix with the create path ('INV-', not 'INV_').
    const invoicePrefix =
      prefixSetting?.value && typeof prefixSetting.value === 'string'
        ? prefixSetting.value
        : 'INV-';
    const invoiceNumberType =
      typeSetting?.value && typeof typeSetting.value === 'string' ? typeSetting.value : 'auto';

    // When the form has a profit centre selected, preview THAT centre's series
    // rather than the install-wide one — otherwise the number shown while
    // filling the form disagrees with the number issued on save, which users
    // report as a bug. peek does not reserve, so an abandoned form leaves no gap.
    const previewCostCenterId =
      typeof _req.query?.costCenterId === 'string' && _req.query.costCenterId
        ? _req.query.costCenterId
        : null;
    if (previewCostCenterId) {
      const centreNumber = await peekCentreDocumentNumber(prisma as never, {
        tenantId,
        costCenterId: previewCostCenterId,
      });
      if (centreNumber) {
        res.json({
          success: true,
          data: { invoicePrefix, invoiceNumberType, nextInvoiceNumber: centreNumber },
        });
        return;
      }
    }

    const lastInvoice = await prisma.invoice.findFirst({
      where: { tenantId, invoiceNumber: { not: null }, invoiceType: 'INVOICE' },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });

    let lastNumber = 0;
    if (lastInvoice?.invoiceNumber) {
      const match = lastInvoice.invoiceNumber.match(/\d+$/);
      if (match) lastNumber = parseInt(match[0], 10);
    }

    // #21: preview must match what generateNextInvoiceNumber will actually assign:
    // honour the configured nextInvoiceNo, falling back to lastDbNumber + 1.
    let configuredNext = 0;
    if (nextSetting) {
      const raw = nextSetting.value;
      const digits =
        typeof raw === 'string' ? raw.match(/\d+$/)?.[0] : typeof raw === 'number' ? String(raw) : undefined;
      if (digits) configuredNext = parseInt(digits, 10);
    }
    const next = Math.max(configuredNext, lastNumber + 1);
    const nextInvoiceNumber = `${invoicePrefix}${String(next).padStart(6, '0')}`;

    res.status(200).json({
      success: true,
      message: 'Next invoice number fetched successfully',
      data: { invoicePrefix, invoiceNumberType, nextInvoiceNumber },
    });
  } catch (err) {
    console.error('Error fetching next invoice number:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching next invoice number',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listInvoicesMinimal / listInvoicesMinimalWithoutChallan
// =============================================================================

async function buildMinimalList(
  req: Request,
  res: Response,
  excludeIds: string[],
  notFoundMessage: string,
  foundMessage: string,
): Promise<void> {
  const scope = tenantScope(req);
  const { search = '' } = (req.body ?? {}) as { search?: string };

  const where: Prisma.InvoiceWhereInput = {
    ...scope,
    id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
  };
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { referenceNo: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
      // N1: also search contact-based invoices
      { contact: { organisation: { contains: search, mode: 'insensitive' } } },
      { contact: { firstName: { contains: search, mode: 'insensitive' } } },
      { contact: { lastName: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const invoices = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      invoiceNumber: true,
      referenceNo: true,
      invoiceDate: true,
      status: true,
      TotalAmount: true,
      contactId: true,
      contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
      customer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: search ? undefined : 20,
  });

  const ids = invoices.map((i) => i.id);
  const paymentGroups =
    ids.length > 0
      ? await prisma.invoicePayment.groupBy({
          by: ['invoiceId'],
          where: { invoiceId: { in: ids }, isVoided: false },
          _sum: { amount: true },
        })
      : [];
  const paymentMap: Record<string, number> = {};
  for (const p of paymentGroups) {
    paymentMap[p.invoiceId] = Number(p._sum.amount ?? 0);
  }

  const formatted = invoices.map((invoice) => {
    const totalPaid = paymentMap[invoice.id] ?? 0;
    // N1: prefer contact display; fall back to legacy customer.
    const partyDisplay = invoice.contact
      ? { id: invoice.contact.id, name: resolveDisplayName(invoice.contact) }
      : invoice.customer
        ? { id: invoice.customer.id, name: invoice.customer.name }
        : null;
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      referenceNo: invoice.referenceNo,
      invoiceDate: invoice.invoiceDate,
      status: invoice.status,
      totalAmount: invoice.TotalAmount,
      contactId: invoice.contactId ?? null,
      customer: partyDisplay,
      payment: {
        totalPaid,
        remaining: Number(invoice.TotalAmount) - totalPaid,
      },
    };
  });

  res.status(200).json({
    success: true,
    message: search ? foundMessage : notFoundMessage,
    data: formatted,
    meta: { count: invoices.length, isSearchResult: Boolean(search) },
  });
}

export async function listInvoicesMinimal(req: Request, res: Response): Promise<void> {
  try {
    const creditNoteRows = await prisma.creditNote.findMany({
      where: { isDeleted: false },
      select: { invoiceId: true },
    });
    const excludeIds = creditNoteRows.map((r) => r.invoiceId);
    await buildMinimalList(
      req,
      res,
      excludeIds,
      'Last 20 invoices without credit notes retrieved successfully',
      'Search results for invoices without credit notes retrieved successfully',
    );
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List minimal invoices error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching invoices',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listInvoicesMinimalWithoutChallan(req: Request, res: Response): Promise<void> {
  try {
    const challanRows = await prisma.deliveryChallan.findMany({
      where: { isDeleted: false, invoiceId: { not: null } },
      select: { invoiceId: true },
    });
    const excludeIds = challanRows.map((r) => r.invoiceId).filter((v): v is string => Boolean(v));
    await buildMinimalList(
      req,
      res,
      excludeIds,
      'Last 20 invoices without credit notes and challans retrieved successfully',
      'Search results for invoices without credit notes and challans retrieved successfully',
    );
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List invoices without challans error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching invoices without challans',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getInvoicePaymentDetails
// =============================================================================

export async function getInvoicePaymentDetails(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: {
        id: true,
        invoiceNumber: true,
        referenceNo: true,
        invoiceDate: true,
        status: true,
        TotalAmount: true,
        contactId: true,
        contact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found or has been deleted' });
      return;
    }

    const paymentModes = await prisma.paymentMode.findMany({
      where: { status: true },
      select: { id: true, name: true, slug: true, status: true },
    });

    const paymentAgg = await prisma.invoicePayment.aggregate({
      where: { invoiceId: id, isVoided: false },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const totalPaid = Number(paymentAgg._sum.amount ?? 0);
    const paymentCount = paymentAgg._count._all;

    // Net applied credit notes so remaining/settled agree with AR aging and the
    // overpayment guard (a fully credit-noted invoice reads as fully settled).
    const creditNoted =
      creditNoteTotalsByInvoice(
        await prisma.creditNote.findMany({
          where: { tenantId, isDeleted: false, invoiceId: id },
          select: { invoiceId: true, totalAmount: true },
        }),
      ).get(id) ?? ZERO;
    const settlement = deriveInvoiceStatus(invoice.TotalAmount, totalPaid, creditNoted, invoice.status);

    // N1: prefer contact display; fall back to legacy customer.
    const customerDisplay = invoice.contact
      ? {
          id: invoice.contact.id,
          name: resolveDisplayName(invoice.contact),
          email: invoice.contact.email ?? null,
          phone: invoice.contact.mobile ?? null,
        }
      : invoice.customer
        ? {
            id: invoice.customer.id,
            name: invoice.customer.name,
            email: invoice.customer.email || null,
            phone: invoice.customer.phone || null,
          }
        : null;

    res.status(200).json({
      success: true,
      message: 'Invoice minimal details retrieved successfully',
      data: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        referenceNo: invoice.referenceNo,
        invoiceDate: invoice.invoiceDate,
        status: invoice.status,
        totalAmount: invoice.TotalAmount,
        contactId: invoice.contactId ?? null,
        customer: customerDisplay,
        payment: {
          totalPaid,
          remaining: settlement.outstanding.toNumber(),
          paymentCount,
          isFullyPaid: settlement.status === 'PAID',
          isPartiallyPaid: settlement.status === 'PARTIALLY_PAID',
        },
        paymentMethods: paymentModes,
      },
      paymentModes,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get invoice minimal error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching invoice details',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteInvoice (soft)
// =============================================================================

export async function deleteInvoice(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.invoice.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    const updated = await prisma.$transaction(async (tx) => {
      // Restore inventory that createInvoice deducted (mirror of deletePurchase).
      // createInvoice decrements stock for every non-PROFORMA invoice (Service items
      // excluded), so deletion must add it back. Guard on !isDeleted so re-deleting an
      // already-deleted invoice can't double-restore stock.
      if (!existing.isDeleted && existing.invoiceType !== 'PROFORMA') {
        const existingItems = Array.isArray(existing.items)
          ? (existing.items as unknown as IncomingItem[])
          : [];
        for (const item of existingItems) {
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          const qty = asNumber(item.qty, 0);
          if (!qty) continue;
          // Skip Service products — they were never deducted on create.
          const product = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { item_type: true },
          });
          if (product?.item_type === 'Service') continue;
          // Bug 4: restore at a valuation-neutral cost — the reversing stock_in
          // must not dilute WAC (restocking at 0 blends the average toward 0) nor
          // create a 0-cost FIFO layer. Mirrors the avgCost-neutral revert used by
          // updateInvoice's draft edit.
          const restockUnitCost = await resolveRestockUnitCost(
            tx as unknown as Parameters<typeof resolveRestockUnitCost>[0],
            { productId, tenantId },
          );
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId,
            qtyDelta: qty,
            type: 'stock_in',
            referenceType: 'invoice',
            referenceId: id,
            unitCost: restockUnitCost,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock restored from invoice delete ${existing.invoiceNumber ?? id}`,
              createdBy: requireActingUserId(req),
            },
          });
        }
      }

      // Void every non-voided payment recorded against this invoice BEFORE the
      // issued reversal. Without this the payment JEs (Dr Bank/Cr AR) stay
      // posted and bankDetail.currentBalance stays credited after the invoice is
      // gone — AR goes negative and the bank is overstated. reverseInvoicePayment-
      // Effects reverses the exact payment JE + inverts the bank balance + writes
      // a reversing bankTransaction (the same effects voidInvoicePayment applies).
      // Guard on !isDeleted so re-deleting can't double-void.
      if (!existing.isDeleted) {
        const payments = await tx.invoicePayment.findMany({
          where: { invoiceId: id, isVoided: false },
          include: { bank: true, paymentMode: true },
        });
        for (const payment of payments) {
          await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
            tenantId,
            payment,
            remarks: `Void of invoice payment ${payment.id} (invoice deleted)`,
          });
          const paymentVoidedAt = new Date();
          await tx.invoicePayment.update({
            where: { id: payment.id },
            data: {
              isVoided: true,
              voidedById: requireActingUserId(req),
              voidedAt: paymentVoidedAt,
              voidReason: 'Invoice deleted',
            },
          });
          // Mirrors voidInvoicePayment: restore any account credit this payment
          // redeemed — deleting the invoice must not leave the customer's
          // credit balance permanently reduced. No-op for non-credit payments.
          await tx.accountCreditEntry.updateMany({
            where: { invoicePaymentId: payment.id, type: 'REDEMPTION', isVoided: false },
            data: { isVoided: true, voidedById: requireActingUserId(req), voidedAt: paymentVoidedAt },
          });
        }
      }

      // GL: reverse any posted issued entry for this invoice (no-op if none / ledger off)
      await reverseDocument(tx as unknown as PostingTx, {
        tenantId,
        sourceType: 'Invoice',
        sourceId: id,
        event: 'issued',
      });
      // B.4: reverse the COGS entry alongside the issued entry.
      await reverseDocument(tx as unknown as PostingTx, {
        tenantId,
        sourceType: 'Invoice',
        sourceId: id,
        event: 'cogs',
      });
      return tx.invoice.update({
        where: { id },
        data: { isDeleted: true },
      });
    });
    res.status(200).json({ message: 'Invoice deleted successfully', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Delete invoice error:', err);
    res.status(500).json({
      message: 'Error deleting invoice',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// convertQuotationToInvoice
// =============================================================================

export async function convertQuotationToInvoice(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { quotationId } = req.params as { quotationId: string };

    const invoice = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirst({ where: { id: quotationId, tenantId } });
      if (!quotation) throw new Error('Quotation not found');
      if (quotation.invoiceId) throw new Error('Quotation already converted to invoice');

      const invoiceNumber = await generateNextInvoiceNumber(tx, tenantId, 'INVOICE', {
        costCenterId: quotation.costCenterId,
      });

      // Ledger: DRAFT invoices are not posted to the GL until issued (see createInvoice gate).
      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: quotation.customerId ?? quotation.tenantId,
          invoiceDate: new Date(),
          dueDate: quotation.expiryDate,
          referenceNo: quotation.referenceNo ?? '',
          items: quotation.items ?? Prisma.JsonNull,
          // Carry the quotation's department onto the invoice, or converting
          // would silently drop the tag the quote was raised under. The line
          // items keep their own centres — they travel inside `items`.
          costCenterId: quotation.costCenterId,
          status: 'DRAFT',
          taxableAmount: quotation.taxableAmount,
          TotalAmount: quotation.TotalAmount,
          vat: quotation.vat,
          totalDiscount: quotation.totalDiscount,
          roundOff: quotation.roundOff,
          bankId: quotation.bankId,
          notes: quotation.notes,
          termsAndCondition: quotation.termsAndCondition,
          sign_type: quotation.sign_type,
          signatureName: quotation.sign_type === 'eSignature' ? quotation.signatureName : null,
          signatureImage: quotation.signatureImage,
          signatureId: quotation.sign_type === 'digitalSignature' ? quotation.signatureId : null,
          billFrom: quotation.billFrom,
          billTo: quotation.billTo,
          tenantId: quotation.tenantId,
        },
      });

      await tx.quotation.update({
        where: { id: quotation.id },
        data: { invoiceId: created.id },
      });

      return created;
    });

    res.status(201).json({
      message: 'Quotation converted to invoice successfully',
      data: invoice,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Quotation not found') {
      res.status(404).json({ message: msg });
      return;
    }
    console.error('Convert quotation error:', err);
    res.status(500).json({
      message: 'Error converting quotation to invoice',
      error: msg,
    });
  }
}

// =============================================================================
// recordInvoicePayment
// =============================================================================

export async function recordInvoicePayment(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { amount, payment_method, received_on, invoiceId, notes, bankId, reference } = req.body as {
      amount?: number;
      payment_method?: string;
      received_on?: string;
      invoiceId?: string;
      notes?: string;
      bankId?: string;
      reference?: string;
    };
    // G: payment-date currency/rate (optional — absent → functional path)
    const body = req.body as Record<string, unknown>;
    const pmtCurrencyCode = typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : undefined;
    const pmtExchangeRate = body.exchangeRate != null ? toDecimal(body.exchangeRate) : undefined;

    if (!amount || amount <= 0) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { amount: 'Invalid payment amount.' },
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId } });
      if (!invoice) throw new Error('INVOICE_NOT_FOUND');
      if (invoice.status === 'PAID') throw new Error('INVOICE_ALREADY_PAID');

      // Outstanding nets BOTH non-voided payments AND applied credit notes, so a
      // fully credit-noted invoice rejects further payment (which would otherwise
      // drive the GL AR control negative). Same netting as AR aging → screens agree.
      const { totalPaid: alreadyPaidDec, creditNoted } = await getInvoiceSettlement(tx, invoice.id, tenantId);
      const alreadyPaid = alreadyPaidDec.toNumber();
      const { outstanding } = deriveInvoiceStatus(invoice.TotalAmount, alreadyPaidDec, creditNoted, invoice.status);
      const remainingBalance = outstanding.toNumber();

      if (new Prisma.Decimal(amount).gt(outstanding.add(OUTSTANDING_TOLERANCE))) {
        throw new Error(`PAYMENT_EXCEEDS:${remainingBalance}`);
      }

      const paymentModeDoc = await tx.paymentMode.findUnique({ where: { id: payment_method } });
      if (!paymentModeDoc) throw new Error('PAYMENT_MODE_NOT_FOUND');

      // QA #9/#30: a CASH receipt must NOT require a bank account. The bank
      // lookup, bank-balance update, bankTransaction and InvoicePayment.bankId
      // are all gated on a non-cash method. The GL posting (below) already
      // routes cash to the CASH role via cashRoleFor() when bankGlAccountId is
      // null, so a cash receipt still balances Dr Cash / Cr AR.
      const isCash = paymentModeDoc.slug?.toLowerCase() === 'cash';
      // Redeeming Account Credit is likewise not a bank/register movement —
      // it settles AR against a customer's existing credit balance instead of
      // real cash. Dr ACCOUNT_CREDIT / Cr AR posts via cashRoleFor() below.
      const isAccountCredit = paymentModeDoc.slug?.toLowerCase() === 'account-credit';

      // Whether the InvoicePayment JE actually posts under the go-live gate
      // (same settings/date the postInvoicePayment → gatedPost call below uses).
      // The bank line is reconciled iff that JE truly posts.
      const paymentDate = safeDate(received_on) ?? new Date();
      const ledgerSettings = await tx.companySettings.findFirst({ where: { tenantId } });
      const didPostPayment = shouldPost(ledgerSettings, paymentDate);

      let bank: Awaited<ReturnType<typeof tx.bankDetail.findFirst>> | null = null;

      if (!isCash && !isAccountCredit) {
        bank = await tx.bankDetail.findFirst({ where: { id: bankId, tenantId } });
        if (!bank) throw new Error('BANK_NOT_FOUND');
      }

      // Account credit can only cover as much as the customer currently has
      // available — validated the same way as the outstanding-amount check
      // above (Decimal comparison, throw a "<CODE>:<available>" domain error
      // handled by the identical response-building path as PAYMENT_EXCEEDS).
      if (isAccountCredit) {
        if (!invoice.contactId) throw new Error('ACCOUNT_CREDIT_NO_CONTACT');
        const availableCredit = await getAccountCreditBalance(tx as unknown as AccountCreditBalanceDb, { tenantId, contactId: invoice.contactId });
        const availableCreditDec = new Prisma.Decimal(availableCredit.toString());
        if (new Prisma.Decimal(amount).gt(availableCreditDec.add(OUTSTANDING_TOLERANCE))) {
          throw new Error(`ACCOUNT_CREDIT_EXCEEDS:${availableCreditDec.toNumber()}`);
        }
      }

      // #40: surface manual (offline) receipts in the Payment Transactions
      // table by writing a tracking PaymentTransaction row in the same tx.
      // Tenant-scoped via tenantId; additive only — no GL/bank/amount effect.
      const paymentTxn = await tx.paymentTransaction.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          kind: 'OFFLINE',
          status: 'CAPTURED',
          amount: toDecimal(amount),
          ...(pmtCurrencyCode ? { currency: pmtCurrencyCode } : {}),
          metadata: {
            source: 'manual_record_payment',
            paymentMode: paymentModeDoc.slug ?? paymentModeDoc.id,
            receivedOn: (safeDate(received_on) ?? new Date()).toISOString(),
            ...(reference ? { reference } : {}),
          },
        },
      });

      // Persist the payment. bankId is null for cash, the bank id otherwise.
      const payment = await tx.invoicePayment.create({
        data: {
          tenantId: tenantId,
          invoiceId: invoice.id,
          amount: toDecimal(amount),
          paymentModeId: paymentModeDoc.id,
          bankId: bank ? bank.id : null,
          // Record path: a bank-backed receipt MOVES bankDetail.currentBalance in
          // the bank block below, so the delete/void reversal must undo it. Cash
          // receipts (bank null) never touch the register → stays false.
          movedBankBalance: !!bank,
          received_on: safeDate(received_on) ?? new Date(),
          notes: notes ?? '',
          received_by: requireActingUserId(req),
          paymentTransactionId: paymentTxn.id,
          ...(reference ? { reference } : {}),
          // G: persist payment-date currency/rate
          ...(pmtCurrencyCode ? { currencyCode: pmtCurrencyCode } : {}),
          ...(pmtExchangeRate !== undefined ? { exchangeRate: pmtExchangeRate } : {}),
        },
      });

      // Data row for the customer's credit balance/history — NOT a GL posting.
      // postInvoicePayment (below) already posts Dr ACCOUNT_CREDIT / Cr AR via
      // cashRoleFor(); this just records the redemption so getAccountCreditBalance
      // can net it out and voidInvoicePayment can restore it on void.
      if (isAccountCredit) {
        await tx.accountCreditEntry.create({
          data: {
            type: 'REDEMPTION',
            contactId: invoice.contactId!,
            amount: toDecimal(amount),
            invoiceId: invoice.id,
            invoicePaymentId: payment.id,
            tenantId,
            createdById: tenantId,
            ...(pmtCurrencyCode ? { currencyCode: pmtCurrencyCode } : invoice.currencyCode ? { currencyCode: invoice.currencyCode } : {}),
          },
        });
      }

      // Bank-side effects (balance update + bankTransaction) only for non-cash.
      // Cash never touches a bank account.
      let bankTransaction: Awaited<ReturnType<typeof tx.bankTransaction.create>> | null = null;
      if (bank) {
        // The bank register is base-currency, so it must move by the base value
        // of the receipt (base = amount × payment rate) — never the raw foreign
        // amount. The persisted payment rate lets the void refund the same base.
        const baseAmount = toBaseAmount(amount, pmtExchangeRate ?? null);
        const balanceBefore = Number(bank.currentBalance ?? 0);
        const newBalance = Number((balanceBefore + baseAmount).toFixed(2));

        await tx.bankDetail.update({
          where: { id: bank.id },
          data: { currentBalance: toDecimal(newBalance), asOnDate: new Date() },
        });

        bankTransaction = await tx.bankTransaction.create({
          data: {
            tenantId: tenantId,
            bankAccountId: bank.id,
            transactionDate: paymentDate,
            type: 'TRANSFER_IN',
            amount: toDecimal(baseAmount),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(newBalance),
            paymentModeId: paymentModeDoc.id,
            remarks: notes ?? `Invoice Payment - ${invoice.invoiceNumber ?? invoice.id}`,
            relatedType: 'INVOICE_PAYMENT',
            relatedId: payment.id,
            // Banking A2: payment-born line is already linked to a posted doc →
            // auto-explain + reconcile so it skips the unexplained queue.
            // Reconciled iff the JE actually posts under the go-live gate.
            ...explainedBankFields({
              postedSourceType: 'InvoicePayment',
              postedSourceId: payment.id,
              posted: didPostPayment,
              approvedById: tenantId,
              approvedAt: new Date(),
            }),
          },
        });
      }

      // G: derive documentRate from parent invoice; paymentRate from payment body or document rate.
      // documentRate: the rate at which AR was originally booked (invoice.exchangeRate ?? 1).
      // paymentRate: the rate at which cash settles today (pmtExchangeRate ?? documentRate).
      const documentRate = invoice.exchangeRate ?? new Prisma.Decimal(1);
      const paymentRate = pmtExchangeRate ?? documentRate;

      // GL: post the payment (Dr BANK/CASH, Cr AR) — FX-aware when foreign currency provided.
      await postInvoicePayment(tx as unknown as PostingTx, {
        tenantId,
        invoiceId: invoice.id,
        paymentId: payment.id,
        date: safeDate(received_on) ?? new Date(),
        amount: String(payment.amount),
        paymentModeSlug: paymentModeDoc.slug ?? null,
        bankGlAccountId: bank?.accountId ?? null,
        ...(pmtCurrencyCode ? { currencyCode: pmtCurrencyCode, paymentRate, documentRate } : {}),
      });

      const newTotalPaid = alreadyPaid + amount;
      // Derive the post-payment status from cash + credit notes so a payment that
      // clears the remaining (credit-note-reduced) balance flips the invoice to PAID.
      const after = deriveInvoiceStatus(invoice.TotalAmount, newTotalPaid, creditNoted, invoice.status);

      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: after.status },
      });

      return {
        payment,
        bankTransaction,
        invoice_status: updatedInvoice.status,
        remaining_balance: after.outstanding.toNumber(),
      };
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment: result.payment,
        bank_transaction: result.bankTransaction,
        invoice_status: result.invoice_status,
        remaining_balance: result.remaining_balance,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    const message = err instanceof Error ? err.message : String(err);
    const friendly: Record<string, { status: number; field: string; msg: string }> = {
      INVOICE_NOT_FOUND: { status: 400, field: 'invoiceId', msg: 'Invoice not found.' },
      INVOICE_ALREADY_PAID: { status: 400, field: 'invoiceId', msg: 'Invoice is already fully paid.' },
      BANK_NOT_FOUND: { status: 400, field: 'bankId', msg: 'Bank account not found.' },
      PAYMENT_MODE_NOT_FOUND: { status: 400, field: 'payment_method', msg: 'Payment mode not found.' },
      ACCOUNT_CREDIT_NO_CONTACT: { status: 400, field: 'payment_method', msg: 'This invoice has no linked contact, so it cannot be settled with account credit.' },
    };
    if (message.startsWith('PAYMENT_EXCEEDS:')) {
      const remaining = message.split(':')[1];
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { amount: `Payment exceeds remaining balance. Remaining: ${remaining}` },
      });
      return;
    }
    if (message.startsWith('ACCOUNT_CREDIT_EXCEEDS:')) {
      const available = message.split(':')[1];
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { amount: `Payment exceeds available account credit. Available: ${available}` },
      });
      return;
    }
    if (friendly[message]) {
      const f = friendly[message];
      res.status(f.status).json({
        success: false,
        message: 'Validation failed.',
        errors: { [f.field]: f.msg },
      });
      return;
    }
    console.error('Record payment error:', err);
    res.status(500).json({
      success: false,
      message: 'Error recording payment',
      error: message,
    });
  }
}

// =============================================================================
// convertProformaToInvoice
// =============================================================================

export async function convertProformaToInvoice(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const newInvoice = await prisma.$transaction(async (tx) => {
      const source = await tx.invoice.findFirst({
        where: { id, tenantId, isDeleted: false },
      });
      if (!source) {
        throw new Error('NOT_FOUND');
      }
      if (source.invoiceType !== 'PROFORMA') {
        throw new Error('NOT_PROFORMA');
      }
      if (source.convertedAt) {
        throw new Error('ALREADY_CONVERTED');
      }

      // Clone the source into a new INVOICE row
      const newNumber = await generateNextInvoiceNumber(tx, tenantId, 'INVOICE', {
        costCenterId: source.costCenterId,
      });

      // Strip fields that should NOT be cloned (id/timestamps/number)
      const {
        id: _id,
        createdAt: _ca,
        updatedAt: _ua,
        invoiceNumber: _in,
        ...rest
      } = source;

      const created = await tx.invoice.create({
        data: {
          ...rest,
          items: (rest.items ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
          paymentOptions: (rest.paymentOptions ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
          invoiceType: 'INVOICE',
          invoiceNumber: newNumber,
          convertedFromId: source.id,
          convertedAt: null,
          status: 'UNPAID',
        },
      });

      // Mark the source as converted
      await tx.invoice.update({
        where: { id: source.id },
        data: { convertedAt: new Date() },
      });

      // GL: post the new real INVOICE to the general ledger
      await postInvoiceIssued(tx as unknown as PostingTx, {
        tenantId,
        invoiceId: created.id,
        date: created.invoiceDate ?? new Date(),
        total: String(created.TotalAmount),
        tax: String(created.vat ?? 0),
      });

      // Fire inventory deduction for the new INVOICE's line items
      // B.4: also accumulate COGS at current average cost for GL posting.
      const items = (created.items as unknown as Array<{ productId?: string; id?: string; qty?: number; unit?: string }>) ?? [];
      let convertCogs = ZERO;
      for (const item of items) {
        const productId = item.productId ?? item.id;
        if (!productId || !item.qty) continue;
        const product = await tx.product.findFirst({
          where: { id: productId, tenantId },
          select: { item_type: true, valuationMethod: true },
        });
        if (product?.item_type === 'Service') continue;
        // Compute COGS from pre-adjustment state (WAC only; FIFO avgCost=0 → cogs=0).
        if (product?.valuationMethod !== 'FIFO') {
          const invForCogs = await tx.inventory.findFirst({
            where: { productId, tenantId, isDeleted: false },
          });
          if (invForCogs) {
            const issue = applyIssue(
              { quantityOnHand: invForCogs.quantityOnHand, avgCost: invForCogs.avgCost },
              String(item.qty),
            );
            convertCogs = convertCogs.plus(issue.cogs);
          }
        }
        // Delegate DB writes to helper (removes silent skip; allows stock to go to/below zero).
        await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
          productId,
          tenantId,
          qtyDelta: -item.qty,
          type: 'stock_out',
          referenceType: 'invoice',
          referenceId: created.id,
          extra: { unitId: item.unit ?? null, createdBy: requireActingUserId(req) },
        });
      }
      // B.4: post COGS for the converted invoice.
      await postSaleCogs(tx as unknown as PostingTx, {
        tenantId,
        invoiceId: created.id,
        date: created.invoiceDate ?? new Date(),
        cost: convertCogs.toString(),
      });

      return created;
    });

    res.status(201).json({
      success: true,
      message: 'Proforma converted to invoice',
      data: { invoice: { ...newInvoice } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    if (handleLedgerError(res, err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'NOT_FOUND') {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }
    if (msg === 'NOT_PROFORMA') {
      res.status(400).json({ success: false, message: 'Only proformas can be converted' });
      return;
    }
    if (msg === 'ALREADY_CONVERTED') {
      res.status(400).json({ success: false, message: 'Proforma already converted' });
      return;
    }
    console.error('convertProformaToInvoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to convert proforma' });
  }
}

// =============================================================================
// Recurring invoices (slice B.3)
// =============================================================================

/**
 * GET /api/admin/recurring-invoices
 * Paginated list of recurring parent invoices (not children).
 */
export async function getRecurringInvoices(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)));
    const search = ((req.query.search as string) ?? '').trim();

    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      isDeleted: false,
      isRecurring: true,
      parentInvoice: null,
      invoiceType: 'INVOICE', // exclude proforma invoices from the recurring list
    };
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          billToCustomer: { select: { id: true, name: true } },
          _count: { select: { children: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    const data = rows.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customer: inv.billToCustomer ? { id: inv.billToCustomer.id, name: inv.billToCustomer.name } : null,
      repeatEvery: inv.repeatEvery,
      customIntervalNumber: inv.customIntervalNumber,
      customIntervalType: inv.customIntervalType,
      startOn: inv.startOn,
      endsOn: inv.endsOn,
      neverExpire: inv.neverExpire,
      stopped: inv.stopped,
      lastRecurringDate: inv.lastRecurringDate,
      nextRecurringDate: inv.nextRecurringDate,
      childrenCount: inv._count.children,
      TotalAmount: inv.TotalAmount,
    }));

    res.json({
      success: true,
      data: {
        recurringInvoices: data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getRecurringInvoices error:', err);
    res.status(500).json({ success: false, message: 'Failed to list recurring invoices' });
  }
}

/**
 * GET /api/admin/invoices/:id/children
 * List child invoices generated from a recurring parent.
 * (Named `getInvoiceChildren` to avoid collision with the legacy system-wide
 *  `getChildInvoices` used by /invoices-recurring.)
 */
export async function getInvoiceChildren(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const parent = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true, isRecurring: true },
    });
    if (!parent) {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }

    const rows = await prisma.invoice.findMany({
      where: { parentInvoice: id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        status: true,
        TotalAmount: true,
      },
    });

    res.json({
      success: true,
      data: {
        children: rows.map((r) => ({ ...r })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getInvoiceChildren error:', err);
    res.status(500).json({ success: false, message: 'Failed to list child invoices' });
  }
}

/**
 * POST /api/admin/invoices/:id/run-recurring-now
 * Manually trigger one iteration of a recurring parent.
 */
export async function runRecurringNow(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const owned = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false, isRecurring: true, parentInvoice: null },
      select: { id: true, stopped: true },
    });
    if (!owned) {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }
    if (owned.stopped) {
      res.status(400).json({ success: false, message: 'Recurring schedule is stopped. Resume it first.' });
      return;
    }

    const out = await runRecurringForInvoice(id);
    res.status(201).json({
      success: true,
      message: 'Recurring iteration created',
      data: { newInvoiceId: out.newInvoiceId, newInvoiceNumber: out.newInvoiceNumber },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SOURCE_NOT_FOUND') {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }
    if (msg === 'SOURCE_STOPPED') {
      res.status(400).json({ success: false, message: 'Recurring schedule is stopped' });
      return;
    }
    console.error('runRecurringNow error:', err);
    res.status(500).json({ success: false, message: 'Failed to run recurring' });
  }
}

/**
 * PATCH /api/admin/invoices/:id/recurring-status
 * Toggle the `stopped` flag on a recurring parent invoice.
 * Body: { stopped: boolean }
 */
export async function setRecurringStatus(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const body = req.body as { stopped?: boolean };
    if (typeof body.stopped !== 'boolean') {
      res.status(400).json({ success: false, message: 'Body must include { stopped: boolean }' });
      return;
    }

    const existing = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false, isRecurring: true, parentInvoice: null },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { stopped: body.stopped },
      select: { id: true, stopped: true },
    });

    res.json({ success: true, message: 'Recurring status updated', data: updated });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('setRecurringStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update recurring status' });
  }
}

function generatePublicToken(): string {
  return randomBytes(32).toString('hex'); // 64-char hex string
}

/**
 * POST /api/admin/invoices/:id/enable-public-link
 * Generates publicViewToken if absent, sets publicViewEnabled=true.
 */
export async function enablePublicLink(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true, publicViewToken: true, publicViewEnabled: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const token = existing.publicViewToken ?? generatePublicToken();
    const updated = await prisma.invoice.update({
      where: { id },
      data: { publicViewToken: token, publicViewEnabled: true },
      select: { id: true, publicViewToken: true, publicViewEnabled: true },
    });
    res.json({ success: true, message: 'Public link enabled', data: updated });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('enablePublicLink error:', err);
    res.status(500).json({ success: false, message: 'Failed to enable public link' });
  }
}

export async function disablePublicLink(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { publicViewEnabled: false },
      select: { id: true, publicViewToken: true, publicViewEnabled: true },
    });
    res.json({ success: true, message: 'Public link disabled', data: updated });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('disablePublicLink error:', err);
    res.status(500).json({ success: false, message: 'Failed to disable public link' });
  }
}

export async function rotatePublicLink(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { publicViewToken: generatePublicToken(), publicViewEnabled: true },
      select: { id: true, publicViewToken: true, publicViewEnabled: true },
    });
    res.json({ success: true, message: 'Public link rotated', data: updated });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('rotatePublicLink error:', err);
    res.status(500).json({ success: false, message: 'Failed to rotate public link' });
  }
}

// =============================================================================
// approveInvoice — Spec D maker-checker
// =============================================================================

export async function approveInvoice(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }
    if (existing.approvalStatus !== 'PENDING') {
      res.status(409).json({
        success: false,
        message: 'Not pending approval',
        current: existing.approvalStatus,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const approved = await tx.invoice.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedById: tenantId,
          approvedAt: new Date(),
        },
      });
      // Post the ledger entries exactly as create would have (shared helper guarantees parity).
      // COGS is recomputed from persisted items + current avgCost (same as updateInvoice approach).
      await postInvoiceLedger(tx, approved, tenantId);
      return approved;
    });

    res.status(200).json({ success: true, message: 'Invoice approved', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('approveInvoice error:', err);
    res.status(500).json({
      success: false,
      message: 'Error approving invoice',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// rejectInvoice — Spec D maker-checker
// =============================================================================

export async function rejectInvoice(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const { reason } = req.body as { reason?: string };

    const existing = await prisma.invoice.findFirst({
      where: { id, tenantId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }
    if (existing.approvalStatus !== 'PENDING') {
      res.status(409).json({
        success: false,
        message: 'Not pending approval',
        current: existing.approvalStatus,
      });
      return;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason ?? null,
      },
    });

    // No GL effect on rejection. The invoice never posted (was PENDING), so no reversal needed.
    // Operational side-effects (stock deductions at create time) are NOT reversed in v1 — documented limitation.
    void tenantId; // referenced for future audit-log use

    res.status(200).json({ success: true, message: 'Invoice rejected', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('rejectInvoice error:', err);
    res.status(500).json({
      success: false,
      message: 'Error rejecting invoice',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// markInvoiceSent — move a DRAFT invoice to SENT without emailing it.
// For when the user downloads the PDF and sends it manually. Mirrors the
// status flip done by sendInvoiceEmail (no email, no extra ledger side-effects;
// GL posting already happens at create time). Guarded to the DRAFT->SENT step.
// =============================================================================
export async function markInvoiceSent(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const id = req.params.id as string;
    const existing = await prisma.invoice.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }
    if (existing.status !== 'DRAFT') {
      res.status(400).json({
        success: false,
        message: `Only draft invoices can be marked as sent (current status: ${existing.status})`,
      });
      return;
    }
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'SENT' },
    });
    res.status(200).json({ success: true, message: 'Invoice marked as sent', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('markInvoiceSent error:', err);
    res.status(500).json({
      success: false,
      message: 'Error marking invoice as sent',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes
module.exports = {
  createInvoice,
  updateInvoiceStatus,
  markInvoiceSent,
  sendInvoiceEmail,
  updateInvoice,
  getInvoice,
  getAllInvoices,
  getChildInvoices,
  listInvoicesMinimal,
  getInvoicePaymentDetails,
  convertQuotationToInvoice,
  convertProformaToInvoice,
  recordInvoicePayment,
  listInvoicesMinimalWithoutChallan,
  getNextInvoiceNumber,
  deleteInvoice,
  getRecurringInvoices,
  getInvoiceChildren,
  runRecurringNow,
  setRecurringStatus,
  enablePublicLink,
  disablePublicLink,
  rotatePublicLink,
  approveInvoice,
  rejectInvoice,
};
module.exports.createInvoice = createInvoice;
module.exports.updateInvoiceStatus = updateInvoiceStatus;
module.exports.markInvoiceSent = markInvoiceSent;
module.exports.sendInvoiceEmail = sendInvoiceEmail;
module.exports.updateInvoice = updateInvoice;
module.exports.getInvoice = getInvoice;
module.exports.getAllInvoices = getAllInvoices;
module.exports.getChildInvoices = getChildInvoices;
module.exports.listInvoicesMinimal = listInvoicesMinimal;
module.exports.getInvoicePaymentDetails = getInvoicePaymentDetails;
module.exports.convertQuotationToInvoice = convertQuotationToInvoice;
module.exports.convertProformaToInvoice = convertProformaToInvoice;
module.exports.recordInvoicePayment = recordInvoicePayment;
module.exports.listInvoicesMinimalWithoutChallan = listInvoicesMinimalWithoutChallan;
module.exports.getNextInvoiceNumber = getNextInvoiceNumber;
module.exports.deleteInvoice = deleteInvoice;
module.exports.getRecurringInvoices = getRecurringInvoices;
module.exports.getInvoiceChildren = getInvoiceChildren;
module.exports.runRecurringNow = runRecurringNow;
module.exports.setRecurringStatus = setRecurringStatus;
module.exports.enablePublicLink = enablePublicLink;
module.exports.disablePublicLink = disablePublicLink;
module.exports.rotatePublicLink = rotatePublicLink;
module.exports.approveInvoice = approveInvoice;
module.exports.rejectInvoice = rejectInvoice;
