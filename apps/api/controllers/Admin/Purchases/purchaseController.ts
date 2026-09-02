import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type {
  Purchase,
  PurchaseStatus,
  PurchaseSignType,
  PurchaseOrderStatus,
} from '@prisma/client';
import { validationResult } from 'express-validator';

import { tenantOwnerInclude, tenantOwner } from '../../../lib/tenantOwner';
import { resolveDisplayName } from '../../../lib/contacts/contactIdentity';
import { applyDocumentTreatment } from '../../../lib/tax/applyTreatment';
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
import { parseTaxTreatment } from '../../../lib/tax/taxTreatment';
import type { TaxTreatment } from '../../../lib/tax/taxTreatment';

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/order
import { sendMail } from '../../../utils/mailer';

import { prisma } from '../../../lib/prisma';
import {
  tenantScope,
  requireTenantId,
  UnauthorizedError, requireActingUserId } from '../../../lib/tenantScope';
import { handleLedgerError } from '../../../lib/httpErrors';
import {
  nextDocumentNumber,
  withDocumentNumberRetry,
  handleNumberConflict,
  type NumberingModel,
} from '../../../lib/documentNumbering';
import {
  postPurchaseReceived,
  reverseDocument,
  voidDocument,
  type PostingTx,
} from '../../../lib/ledger/ledgerPosting';
import { computeLandedAdditions } from '../../../lib/ledger/inventoryValuation';
import {
  reverseSupplierPaymentEffects,
  type PaymentEffectsTx,
} from '../../../lib/ledger/voidPaymentEffects';
import { explainedBankFields } from '../../../lib/moneyFlow/explainedBankFields';
import { applyStockAdjustment } from '../../../lib/inventory/stockAdjust';
import { initialApprovalStatus, shouldPostOnCreate } from '../../../lib/ledger/approvals';
import { currentActorId } from '../../../lib/actor';
import { signedUrlFor } from '../../../lib/blobStorage';

type Tx = Prisma.TransactionClient;

const VALID_STATUSES = new Set<PurchaseStatus>([
  'new',
  'pending',
  'completed',
  'cancelled',
  'partially_paid',
  'paid',
]);

const VALID_SIGN_TYPES = new Set<PurchaseSignType>([
  'none',
  'digitalSignature',
  'eSignature',
]);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

/**
 * Task 6 review round 2 (Important): a PENDING (maker-checker, Spec D) purchase
 * must only change approvalStatus via approvePurchase/rejectPurchase — createPurchase
 * defers GL posting to approvePurchase's `approvalStatus === 'PENDING'` gate. Letting
 * updatePurchaseStatus flip a still-PENDING document's `status` (e.g. new -> paid)
 * would stock inventory in via applyStockAdjustment with NO GL entry ever posted,
 * since approvePurchase — the only path that posts for this document — never runs.
 * Thrown as soon as `existing` is loaded, caught here and mapped to 409 — mirrors
 * the `UnauthorizedError`/`OverpaymentError` convention.
 */
class PendingApprovalError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'PendingApprovalError';
  }
}

function handlePendingApproval(res: Response, err: unknown): boolean {
  if (err instanceof PendingApprovalError) {
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
  return new Prisma.Decimal(
    typeof value === 'number' || typeof value === 'string' ? value : fallback,
  );
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalise an optional foreign-key input to `string | null`.
 *
 * The purchase forms post `''` — not `undefined` — for every picker the user
 * left alone, and `''` is not nullish, so `body.x ?? null` handed the empty
 * string straight to an FK column. Postgres answered with P2003
 * (`Purchase_purchaseOrderId_fkey`) and the whole create 500'd. Blank, missing
 * and non-string all mean "no relation": null.
 */
function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
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

interface IncomingItemTax {
  taxRateId?: string;
  name?: string;
  kind?: string | null;
  percent?: number;
  amount?: number;
}

interface IncomingItem {
  costCenterId?: string | null;
  id?: string;
  productId?: string;
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
  taxes?: IncomingItemTax[];
  totalTax?: number;
  customFields?: unknown;
}

function normaliseItems(raw: unknown, headerCostCenterId?: string | null): IncomingItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as IncomingItem[]).map((item) => ({
    costCenterId: resolveLineCostCenterId(item.costCenterId, headerCostCenterId ?? null),
    id: item.id ?? item.productId,
    productId: item.productId ?? item.id,
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
    taxes: Array.isArray(item.taxes)
      ? item.taxes.map((t) => ({ ...t, percent: asNumber(t.percent, 0), amount: asNumber(t.amount, 0) }))
      : undefined,
    totalTax: item.totalTax !== undefined ? asNumber(item.totalTax, 0) : undefined,
    customFields: sanitizeLineCustomFields(item.customFields),
  }));
}

function generateNextPurchaseId(tx: Tx, tenantId: string): Promise<string> {
  return nextDocumentNumber({
    model: tx.purchase as unknown as NumberingModel,
    field: 'purchaseId',
    prefix: 'PUR-',
    tenantWhere: { tenantId },
  });
}

async function insertCustomFieldValues(
  tx: Tx,
  purchaseId: string,
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

  const records: Prisma.CustomFieldValueCreateManyInput[] = customFields.map(
    (field) => {
      const f = field as { fieldId: string; value?: string };
      let value: Prisma.InputJsonValue = f.value ?? '';
      const fileMatch = files.find(
        (file) => file.fieldname === `customField_${f.fieldId}`,
      );
      if (fileMatch) value = fileMatch.path;
      return {
        tenantId,
        customFieldId: f.fieldId,
        module: 'purchase',
        recordId: purchaseId,
        value,
        // No `req` here - this is a helper. The acting user comes from the
        // request-scoped context, which holds the same person.
        createdBy: currentActorId(),
      };
    },
  );

  await tx.customFieldValue.createMany({ data: records });
}

interface UserLite {
  id: string;
  // Nullable since this now arrives via the tenant OWNER membership rather
  // than a direct User FK -- User allows both to be null.
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address?: string | null;
  profileImage?: string | null;
}

interface SupplierLite {
  id: string;
  supplier_name: string;
  supplier_email: string;
  supplier_phone: string;
  profileImage?: string | null;
  stateId?: string | null;
  countryId?: string | null;
}

// Build a single-line address from a unified Contact's address parts.
// Used to populate the Bill To address on purchase views (empty before this).
function buildContactAddressLine(c: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressLine3?: string | null;
  town?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
} | null | undefined): string {
  if (!c) return '';
  return [c.addressLine1, c.addressLine2, c.addressLine3, c.town, c.region, c.postcode, c.country]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)
    .join(', ');
}

function formatSupplierParty(
  s: SupplierLite | null | undefined,
  baseUrl: string,
  withAddress = false,
): {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address?: string | null;
  profileImage: string;
} | null {
  if (!s) return null;
  return {
    id: s.id,
    name: s.supplier_name || '',
    email: s.supplier_email || null,
    phone: s.supplier_phone || null,
    ...(withAddress ? { address: null } : {}),
    profileImage: s.profileImage
      ? signedUrlFor(s.profileImage.replace(/\\/g, '/'))
      : '',
  };
}

function formatUser(u: UserLite | null | undefined): {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
} | null {
  if (!u) return null;
  return {
    id: u.id,
    name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
    email: u.email || null,
    phone: u.phone || null,
  };
}

function formatPartyDetails(
  u: UserLite | null | undefined,
  baseUrl: string,
  withAddress = false,
): {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address?: string | null;
  profileImage: string;
} | null {
  if (!u) return null;
  return {
    id: u.id,
    name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
    email: u.email || null,
    phone: u.phone || null,
    ...(withAddress ? { address: u.address ?? null } : {}),
    profileImage: u.profileImage
      ? signedUrlFor(u.profileImage.replace(/\\/g, '/'))
      : '',
  };
}

interface BankLite {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHoldername: string;
  IFSCCode: string;
  branchName?: string;
}

function formatBank(
  b: BankLite | null | undefined,
  withBranch = false,
): {
  id: string;
  name: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  ifscCode: string | null;
  branchName?: string | null;
} | null {
  if (!b) return null;
  return {
    id: b.id,
    name: b.bankName || null,
    accountNumber: b.accountNumber || null,
    accountHolderName: b.accountHoldername || null,
    ifscCode: b.IFSCCode || null,
    ...(withBranch ? { branchName: b.branchName ?? null } : {}),
  };
}

interface PaymentModeLite {
  id: string;
  name: string;
  slug: string;
  status: boolean | null;
}

function formatPaymentMode(p: PaymentModeLite | null | undefined) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name || null,
    slug: p.slug || null,
    status: p.status ?? null,
  };
}

// =============================================================================
// postPurchaseLedger — shared helper used by createPurchase (approvalsEnabled=false)
//                      AND approvePurchase (approvalsEnabled=true).
// Computes the inventory/expense split from the purchase's items + current state,
// then posts. Called with re-read items from the persisted purchase to guarantee parity.
// =============================================================================

async function postPurchaseLedger(
  tx: Tx,
  purchase: { id: string; purchaseDate: Date | null; totalAmount: Prisma.Decimal; totalTax: Prisma.Decimal | null; items: Prisma.JsonValue | null; tenantId: string; currencyCode?: string | null; exchangeRate?: Prisma.Decimal | null; costCenterId?: string | null; projectId?: string | null },
  tenantId: string,
): Promise<void> {
  const headerCostCentre = purchase.costCenterId ?? null;
  // Pass the header so the classification below resolves line centres exactly as
  // the create path did when it persisted them.
  const items = normaliseItems(purchase.items, headerCostCentre);
  const total = String(purchase.totalAmount);
  const tax = String(purchase.totalTax ?? 0);
  let inventoryNet = new Prisma.Decimal(0);
  // Accumulate each bucket per department alongside the totals, so the same
  // single walk feeds both the clamped totals and the departmental split.
  const invByCentre = new Map<string | null, Prisma.Decimal>();
  const expByCentre = new Map<string | null, Prisma.Decimal>();
  for (const item of items) {
    const productId = item.productId ?? item.id;
    if (!productId) continue;
    const product = await tx.product.findFirst({
      where: { id: productId, tenantId },
      select: { item_type: true },
    });
    const lineAmount = new Prisma.Decimal(asNumber(item.amount, 0));
    const centre = item.costCenterId ?? null;
    if (product && product.item_type !== 'Service') {
      inventoryNet = inventoryNet.plus(lineAmount);
      invByCentre.set(centre, (invByCentre.get(centre) ?? new Prisma.Decimal(0)).plus(lineAmount));
    } else {
      expByCentre.set(centre, (expByCentre.get(centre) ?? new Prisma.Decimal(0)).plus(lineAmount));
    }
  }
  const totalDec = new Prisma.Decimal(String(purchase.totalAmount ?? 0));
  const taxDec = new Prisma.Decimal(String(purchase.totalTax ?? 0));
  const maxNet = totalDec.minus(taxDec);
  const clampedInv = inventoryNet.greaterThan(maxNet) ? maxNet : inventoryNet;
  const expenseNet = maxNet.minus(clampedInv);

  // Only split when the lines actually disagree with the header — otherwise the
  // posting must stay byte-identical to what it produced before.
  const multiCentre =
    new Set([...invByCentre.keys(), ...expByCentre.keys()]).size > 1 ||
    [...invByCentre.keys(), ...expByCentre.keys()].some((k) => k !== headerCostCentre);

  const toGroups = (m: Map<string | null, Prisma.Decimal>, bucketTotal: Prisma.Decimal) =>
    splitNetByCentre(
      [...m.entries()].map(([costCenterId, amount]) => ({ costCenterId, net: amount.toString() })),
      headerCostCentre,
      bucketTotal.toString(),
    );

  // splitNetByCentre reconciles each bucket to its CLAMPED total, so the
  // inventory/expense/tax split still sums to the document total exactly.
  const inventoryByCentre = multiCentre ? toGroups(invByCentre, clampedInv) : [];
  const expenseByCentre = multiCentre ? toGroups(expByCentre, expenseNet) : [];
  // G: pass document currency/rate when present; omitting falls back to functional path.
  // P3.3: pass dims if present on the document (null/undefined → no-op)
  await postPurchaseReceived(tx as unknown as PostingTx, {
    tenantId,
    purchaseId: purchase.id,
    date: purchase.purchaseDate ?? new Date(),
    total,
    tax,
    inventoryNet: clampedInv.toString(),
    expenseNet: expenseNet.toString(),
    ...(purchase.currencyCode ? { currencyCode: purchase.currencyCode } : {}),
    ...(purchase.exchangeRate != null ? { exchangeRate: purchase.exchangeRate } : {}),
    ...(purchase.costCenterId !== undefined ? { costCenterId: purchase.costCenterId } : {}),
    ...(purchase.projectId !== undefined ? { projectId: purchase.projectId } : {}),
    ...(inventoryByCentre.length ? { inventoryByCentre } : {}),
    ...(expenseByCentre.length ? { expenseByCentre } : {}),
  });
}

/**
 * Shared post-create side-effects for a purchase: inventory stock-in + GL posting.
 *
 * Lifted verbatim from createPurchase so that PO->Purchase conversion produces
 * the SAME stock movements and ledger entries as a directly-created purchase of
 * the same status. Keeping a single implementation guarantees the two paths
 * cannot drift (e.g. the GL tie-out invariant SUM(baseDebit)-SUM(baseCredit)=0
 * holds identically for both).
 *
 *  - Inventory stock-in runs when goods are received (any status except
 *    `new`/`cancelled`). Movements are keyed to `created.id` so a later
 *    purchase edit/delete can reverse them consistently.
 *  - GL posting runs under the same `shouldPostOnCreate(approvalsEnabled)` gate;
 *    when approvals are enabled, posting is deferred to approvePurchase.
 */
async function applyPurchaseReceiptEffects(
  tx: Tx,
  created: Awaited<ReturnType<Tx['purchase']['create']>>,
  items: IncomingItem[],
  opts: {
    tenantId: string;
    status: PurchaseStatus;
    landedCost: number | null | undefined;
    receiptDate: Date;
    approvalsEnabled: boolean;
  },
): Promise<void> {
  const { tenantId, status, landedCost, receiptDate, approvalsEnabled } = opts;

  // Inventory increment when goods received (any status except draft/cancelled).
  // P3.5: compute landed-cost per-unit additions for all inventory lines.
  if (status !== 'new' && status !== 'cancelled') {
    const inventoryLineParams = items.map((item) => ({
      amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
      qty: asNumber(item.qty, 0),
    }));
    const landedAdditions = computeLandedAdditions(inventoryLineParams, landedCost);

    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const item = items[itemIdx]!;
      const productId = item.productId ?? item.id;
      if (!productId) continue;
      const qty = asNumber(item.qty, 0);
      const baseUnitCost = asNumber(item.rate, 0);
      // P3.5: landed-inclusive unit cost = base rate + landed addition per unit.
      const landedUnitCost = baseUnitCost + (landedAdditions[itemIdx] ?? 0);

      await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
        productId,
        tenantId,
        qtyDelta: qty,
        type: 'stock_in',
        referenceType: 'purchase',
        referenceId: created.id,
        unitCost: landedUnitCost,
        receiptDate,
        extra: {
          unitId: item.unit ?? null,
          notes: `Stock in from purchase ${created.purchaseId ?? created.id}`,
          createdBy: currentActorId(),
        },
      });
    }
  }

  // GL posting — gated by approval status.
  if (shouldPostOnCreate(approvalsEnabled)) {
    await postPurchaseLedger(tx, created, tenantId);
  }
}

// =============================================================================
// createPurchase
// =============================================================================

export async function createPurchase(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const authUserId = requireTenantId(req);
    const body = req.body as Record<string, unknown>;

    const purchaseOrderId = optionalId(body.purchaseOrderId);
    // SECURITY: always use the authenticated tenant id — never trust body.tenantId.
    const tenantId = authUserId;
    const billFrom = body.billFrom as string;
    const legacySupplierId = ((body.supplierId ?? body.billTo) as string | undefined) ?? null;
    const referenceNo = (body.referenceNo as string) ?? '';
    const purchaseDate = safeDate(body.purchaseDate) ?? new Date();
    // Resolved before the items so each line can inherit the document centre.
    const docCostCenterId = typeof body.costCenterId === 'string' && body.costCenterId ? body.costCenterId : null;
    const items = normaliseItems(body.items, docCostCenterId);

    try {
      await assertCostCentresExist(prisma, tenantId, collectCostCentreIds(docCostCenterId, items));
    } catch (centreErr) {
      if (centreErr instanceof UnknownCostCentreError) {
        res.status(400).json({ success: false, message: centreErr.message, errors: { costCenterId: centreErr.message } });
        return;
      }
      throw centreErr;
    }
    const notes = (body.notes as string) ?? '';
    const termsAndCondition = (body.termsAndCondition as string) ?? '';
    const paymentMode = optionalId(body.paymentMode);
    const subTotal = body.subTotal as number | undefined;
    const totalTax = body.totalTax as number | undefined;
    const totalDiscount = body.totalDiscount as number | undefined;
    const grandTotal = body.grandTotal as number | undefined;
    const signType = (body.sign_type as PurchaseSignType) ?? 'none';
    const signatureIdInput = optionalId(body.signatureId);
    const signatureName = body.signatureName as string | undefined;
    const checkNumber = body.checkNumber as string | undefined;
    const bank = optionalId(body.bank);
    const sp_amount = body.sp_amount as number | undefined;
    const sp_paid_amount = body.sp_paid_amount as number | undefined;

    // Contact-aware party resolution:
    // - New path: body.contactId provided → use it directly, supplierId = null
    // - Legacy path: body.supplierId/billTo provided → resolve contactId via legacySupplierId
    // - At least one party is required (400 if neither).
    const incomingContactId = typeof body.contactId === 'string' && body.contactId ? body.contactId : null;

    if (!incomingContactId && !legacySupplierId) {
      res.status(400).json({ success: false, message: 'A contactId or a supplier (supplierId/billTo) is required.' });
      return;
    }

    let resolvedContactId: string | null = incomingContactId;
    let resolvedSupplierId: string | null = null;
    // currencyCode derived from the primary contact (reused below to avoid double-query)
    let contactCurrencyCode: string | null = null;
    // C2: defaultTaxTreatment from the resolved primary contact
    let contactDefaultTaxTreatment: TaxTreatment | null = null;

    const cdb = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;

    if (incomingContactId) {
      // New contact-based path: verify the contact belongs to the AUTHENTICATED tenant.
      // Use authUserId (not body.tenantId) so a client cannot escalate via a spoofed tenantId.
      const ownedContact = (await cdb().contact.findFirst({
        where: { id: incomingContactId, tenantId: authUserId, isDeleted: false },
        select: { id: true, currencyCode: true, defaultTaxTreatment: true },
      } as never)) as { id: string; currencyCode: string | null; defaultTaxTreatment: TaxTreatment | null } | null;
      if (!ownedContact) {
        res.status(404).json({ success: false, message: 'Contact not found' });
        return;
      }
      contactCurrencyCode = ownedContact.currencyCode;
      contactDefaultTaxTreatment = ownedContact.defaultTaxTreatment;
      resolvedSupplierId = null;
    } else if (legacySupplierId) {
      // Legacy path: keep supplierId, resolve contactId from legacySupplierId.
      // Use authUserId for the ownership lookup (contact must belong to the authenticated tenant).
      resolvedSupplierId = legacySupplierId;
      const contactRow = (await cdb().contact.findFirst({
        where: { legacySupplierId, tenantId: authUserId, isDeleted: false },
        select: { id: true, currencyCode: true, defaultTaxTreatment: true },
      } as never)) as { id: string; currencyCode: string | null; defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) {
        resolvedContactId = contactRow.id;
        contactCurrencyCode = contactRow.currencyCode;
        contactDefaultTaxTreatment = contactRow.defaultTaxTreatment;
      }
    }

    // G: document currency — optional. Omitting defaults to functional currency (rate 1).
    // §6: when no explicit currencyCode, derive from the chosen contact's currencyCode.
    // Reuse the currencyCode already fetched above; fall back to a secondary lookup only
    // when we have a legacySupplierId but the contact row resolved no currency.
    const explicitCurrencyCode = typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode as string : undefined;
    let docCurrencyCode = explicitCurrencyCode;
    if (!docCurrencyCode) {
      if (contactCurrencyCode) {
        docCurrencyCode = contactCurrencyCode;
      } else {
        const contactPartyId = resolvedContactId ?? legacySupplierId;
        if (contactPartyId) {
          const contactRow = (await cdb().contact.findFirst({
            where: { OR: [{ id: contactPartyId }, { legacySupplierId: contactPartyId }], tenantId: authUserId, isDeleted: false },
            select: { currencyCode: true },
          } as never)) as { currencyCode: string | null } | null;
          if (contactRow?.currencyCode) docCurrencyCode = contactRow.currencyCode;
        }
      }
    }
    const docExchangeRate = body.exchangeRate != null ? toDecimal(body.exchangeRate) : undefined;

    // P3.3: optional dimension tagging
    const docProjectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;

    // P3.5: optional landed cost (freight/duties) to fold into inventory unit cost.
    const docLandedCost = body.landedCost != null && body.landedCost !== '' ? asNumber(body.landedCost, 0) : null;

    // C2: per-document tax treatment.
    // body.taxTreatment is accepted only if it is one of the 5 known enum values.
    const VALID_TAX_TREATMENTS = new Set<TaxTreatment>([
      'STANDARD', 'ZERO_RATED', 'EXEMPT', 'REVERSE_CHARGE', 'OUT_OF_SCOPE',
    ]);
    const rawBodyTreatmentP = body.taxTreatment as string | undefined;
    const validatedBodyTreatmentP: TaxTreatment | undefined =
      rawBodyTreatmentP && VALID_TAX_TREATMENTS.has(rawBodyTreatmentP as TaxTreatment)
        ? (rawBodyTreatmentP as TaxTreatment)
        : undefined;
    const docTreatmentP: TaxTreatment =
      validatedBodyTreatmentP ?? contactDefaultTaxTreatment ?? 'STANDARD';

    // Validate bill from user (buyer). Supplier validation is conditional (null when contact-based).
    const [billFromUser, supplier] = await Promise.all([
      prisma.user.findUnique({ where: { id: billFrom } }),
      resolvedSupplierId
        ? prisma.supplier.findFirst({ where: { id: resolvedSupplierId, isDeleted: false } })
        : Promise.resolve(null),
    ]);
    if (!billFromUser) {
      res.status(422).json({ message: 'Invalid bill from user' });
      return;
    }
    if (resolvedSupplierId && !supplier) {
      res.status(422).json({ message: 'Invalid supplier' });
      return;
    }

    // A linked PO must exist AND belong to this tenant. Without the check an
    // unknown id reached Postgres as an FK violation (a 500 the user reads as
    // "save failed"), and a known id from another workspace would have linked
    // across tenants.
    if (purchaseOrderId) {
      const linkedPO = await prisma.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, tenantId },
        select: { id: true },
      });
      if (!linkedPO) {
        res.status(404).json({ success: false, message: 'Purchase Order not found' });
        return;
      }
    }

    // Validate signature type
    if (signType && !VALID_SIGN_TYPES.has(signType)) {
      res.status(400).json({ message: 'Invalid signature type' });
      return;
    }
    if (signType === 'eSignature') {
      if (!req.file) {
        res.status(400).json({
          message: 'Signature image is required for eSignature',
        });
        return;
      }
      if (!signatureName) {
        res.status(400).json({
          message: 'Signature name is required for eSignature',
        });
        return;
      }
    }

    // Server-authoritative totals: recompute from items (purchase lines carry
    // taxes[] component percents); ignore client-sent totals (compare + warn
    // only). Persisted totalAmount/totalTax feed postPurchaseLedger, so the GL
    // takes the server figures.
    const serverTotals = computeDocumentTotals(items as TotalsItem[]);
    warnOnTotalsDivergence('purchase', (body.purchaseId as string) ?? 'new', asNumber(grandTotal, NaN), serverTotals.grandTotal);
    const calculatedSubTotal = serverTotals.subTotal;
    const calculatedTotalDiscount = serverTotals.totalDiscount;
    const calculatedTotalTax = serverTotals.totalTax;
    const calculatedGrandTotal = serverTotals.grandTotal;

    // C2: apply treatment — STANDARD is a pass-through; suppressing treatments zero tax + item taxes.
    const enforcedPurchase = applyDocumentTreatment(docTreatmentP, calculatedTotalTax, items);
    const enforcedTotalTax = enforcedPurchase.tax;
    const enforcedItems = enforcedPurchase.items;
    // Recompute grandTotal when tax was suppressed (subtotal + suppressed_tax - discount).
    const enforcedGrandTotal = docTreatmentP === 'STANDARD'
      ? calculatedGrandTotal
      : calculatedSubTotal + enforcedTotalTax - calculatedTotalDiscount;

    // Status & payment derivation
    let status: PurchaseStatus =
      ((body.status as PurchaseStatus) ?? 'pending');
    let paidAmount = 0;
    let balanceAmount = enforcedGrandTotal;
    if (sp_amount && sp_paid_amount && status === 'paid') {
      if (sp_paid_amount === sp_amount) {
        status = 'paid';
        paidAmount = sp_paid_amount;
        balanceAmount = 0;
      } else {
        status = 'partially_paid';
        paidAmount = sp_paid_amount;
        balanceAmount = sp_amount - sp_paid_amount;
      }
    }

    const signatureImage =
      signType === 'eSignature' && req.file ? req.file.path : null;
    const signatureNameFinal = signType === 'eSignature' ? signatureName ?? null : null;
    const signatureIdFinal =
      signType === 'digitalSignature' ? signatureIdInput ?? null : null;

    const purchase = await withDocumentNumberRetry('purchaseId', () => prisma.$transaction(async (tx) => {
      // Approval gate: read companySettings for this tenant
      const settings = await tx.companySettings.findFirst({ where: { tenantId } });
      const approvalsEnabled = settings?.approvalsEnabled ?? false;

      const purchaseIdString =
        (body.purchaseId as string) ?? (await generateNextPurchaseId(tx, tenantId));

      const created = await tx.purchase.create({
        data: {
          purchaseId: purchaseIdString,
          purchaseOrderId,
          // Contact-aware: write contactId (new path) or supplierId (legacy). Both nullable.
          supplierId: resolvedSupplierId,
          ...(resolvedContactId ? { contactId: resolvedContactId } : {}),
          purchaseDate,
          dueDate: purchaseDate,
          referenceNo,
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          status,
          paymentModeId: paymentMode ?? null,
          taxableAmount: toDecimal(calculatedSubTotal),
          totalDiscount: toDecimal(calculatedTotalDiscount),
          totalTax: toDecimal(enforcedTotalTax),
          taxTreatment: docTreatmentP,
          roundOff: Boolean(body.roundOff),
          totalAmount: toDecimal(enforcedGrandTotal),
          paidAmount: toDecimal(paidAmount),
          balanceAmount: toDecimal(balanceAmount),
          bankId: bank ?? null,
          notes,
          termsAndCondition,
          sign_type: signType,
          signatureId: signatureIdFinal,
          signatureImage,
          signatureName: signatureNameFinal,
          checkNumber: checkNumber ?? null,
          tenantId,
          billFrom,
          billTo: null,
          approvalStatus: initialApprovalStatus(approvalsEnabled),
          // G: persist document currency/rate (omitted when absent → functional currency)
          ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
          ...(docExchangeRate !== undefined ? { exchangeRate: docExchangeRate } : {}),
          // P3.3: persist dimension tags
          costCenterId: docCostCenterId,
          projectId: docProjectId,
          // P3.5: persist landed cost (null when absent)
          ...(docLandedCost != null && docLandedCost > 0 ? { landedCost: toDecimal(docLandedCost) } : {}),
        },
      });

      // Update related PurchaseOrder status if linked
      if (purchaseOrderId) {
        const poStatus: PurchaseOrderStatus =
          status === 'paid'
            ? 'completed'
            : status === 'cancelled'
              ? 'cancelled'
              : 'pending';
        await tx.purchaseOrder.updateMany({
          where: { id: purchaseOrderId, tenantId },
          data: { status: poStatus },
        });
      }

      // SupplierPayment row when (partially) paid
      if (status === 'paid' || status === 'partially_paid') {
        await tx.supplierPayment.create({
          data: {
            tenantId: authUserId,
            purchaseId: created.id,
            supplierId: resolvedSupplierId,
            referenceNumber: (body.sp_referenceNumber as string) ?? '',
            paymentDate: safeDate(body.sp_paymentDate) ?? new Date(),
            paymentModeId: optionalId(body.sp_paymentMode),
            sourceType: 'BANK',
            amount: Math.min(asNumber(body.sp_amount, 0), enforcedGrandTotal),
            paidAmount: Math.min(asNumber(body.sp_amount, 0), enforcedGrandTotal),
            dueAmount: asNumber(body.sp_due_amount, 0),
            notes: (body.sp_notes as string) ?? '',
            createdBy: requireActingUserId(req),
          },
        });
      }

      // Inventory stock-in + GL posting (shared with PO->Purchase conversion).
      // CRITICAL: stock is keyed to the authenticated tenant (`tenantId`), never a
      // potentially spoofed body.tenantId. Movements reference created.id so a later
      // edit/delete can reverse them.
      await applyPurchaseReceiptEffects(tx, created, items, {
        tenantId,
        status,
        landedCost: docLandedCost,
        receiptDate: purchaseDate,
        approvalsEnabled,
      });

      // Custom field values
      const files = Array.isArray(req.files)
        ? (req.files as Express.Multer.File[])
        : [];
      await insertCustomFieldValues(tx, created.id, tenantId, body.customFields, files);

      return created;
    }));

    res.status(201).json({
      message: 'Purchase created successfully',
      data: { purchase },
    });

    // Fire-and-forget email — sent to the supplier (only when legacy supplier row exists)
    if (supplier && supplier.supplier_email && process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
      try {
        await sendMail({
          to: supplier.supplier_email,
          subject: 'New Purchase Created',
          html: `
            <h3>Hello ${supplier.supplier_name},</h3>
            <p>A new purchase has been created for you.</p>
            <p><strong>Reference No:</strong> ${purchase.referenceNo ?? ''}</p>
            <p><strong>Total Amount:</strong> ${Number(purchase.totalAmount)}</p>
            <p>Purchase Date: ${new Date(purchase.purchaseDate).toLocaleDateString()}</p>
            <br>
            <p>Best Regards,<br>Your Company</p>
          `,
        });
      } catch (emailErr) {
        console.error(
          'Failed to send purchase email:',
          emailErr instanceof Error ? emailErr.message : String(emailErr),
        );
      }
    }
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    if (handleNumberConflict(res, err, 'purchaseId')) return;
    console.error(err);
    res.status(500).json({
      message: 'Error creating purchase',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// createPurchaseFromPO
// =============================================================================

export async function createPurchaseFromPO(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { purchaseOrderId } = req.body as { purchaseOrderId?: string };

    if (!purchaseOrderId) {
      res.status(400).json({ message: 'Purchase Order ID is required' });
      return;
    }

    const purchase = await withDocumentNumberRetry('purchaseId', () => prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, tenantId },
      });
      if (!purchaseOrder) {
        throw new Error('Purchase Order not found');
      }

      const existing = await tx.purchase.findFirst({
        where: { purchaseOrderId: purchaseOrder.id, tenantId },
      });
      if (existing) {
        throw new Error('Purchase Order already converted to Purchase');
      }

      const nextPurchaseId = await generateNextPurchaseId(tx, tenantId);

      // Translate the PO status onto purchase enum domain. If the PO is
      // already `completed`, the produced purchase should still start at
      // Converting a PO to a Purchase records the actual receipt of goods, so the
      // resulting Purchase should be `pending` (received → stock-in + GL post) for
      // any non-cancelled PO — including a `new` PO. A `new`→`new` carry-over left
      // the receipt below the inventory gate, so stock never moved on convert.
      const poStatus = purchaseOrder.status as PurchaseOrderStatus;
      const purchaseStatus: PurchaseStatus =
        poStatus === 'cancelled' ? 'cancelled' : 'pending';

      const created = await tx.purchase.create({
        data: {
          purchaseId: nextPurchaseId,
          purchaseOrderId: purchaseOrder.id,
          supplierId: purchaseOrder.supplierId ?? null,
          // Carry the unified Contact through conversion. Without this the converted
          // purchase has no party and the UI renders the supplier as "Deleted User"
          // (contactId is the source of truth; supplierId/billTo are legacy fallbacks).
          ...(purchaseOrder.contactId ? { contactId: purchaseOrder.contactId } : {}),
          purchaseDate: new Date(),
          dueDate: purchaseOrder.dueDate,
          referenceNo: purchaseOrder.referenceNo ?? '',
          items: (purchaseOrder.items ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status: purchaseStatus,
          paymentModeId: null, // PurchaseOrder.paymentMode is a different enum domain
          taxableAmount: purchaseOrder.taxableAmount,
          totalDiscount: purchaseOrder.totalDiscount,
          totalTax: purchaseOrder.vat,
          roundOff: purchaseOrder.roundOff,
          totalAmount: purchaseOrder.TotalAmount,
          bankId: purchaseOrder.bankId,
          notes: purchaseOrder.notes,
          termsAndCondition: purchaseOrder.termsAndCondition,
          sign_type: purchaseOrder.sign_type as unknown as PurchaseSignType,
          signatureId: purchaseOrder.signatureId,
          signatureImage: purchaseOrder.signatureImage,
          signatureName: purchaseOrder.signatureName,
          tenantId: purchaseOrder.tenantId,
          billFrom: purchaseOrder.billFrom,
          billTo: purchaseOrder.billTo,
          // #61: carry the document currency through conversion so the
          // converted Purchase keeps the PO's currency instead of falling
          // back to the base currency (₹). PurchaseOrder has no exchangeRate
          // column, so there is no rate to copy — leave it null.
          currencyCode: purchaseOrder.currencyCode ?? null,
          exchangeRate: null,
        },
      });

      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { status: 'completed' },
      });

      // Apply the SAME post-create side-effects a directly-created purchase gets:
      // inventory stock-in (gated on status, skipped for new/cancelled) and GL
      // posting (gated by approvals). Without this the converted purchase silently
      // skipped stock movements and ledger entries (GL tie-out gap).
      //
      // - Items come from the PO JSON, normalised to the same shape create uses.
      // - Stock is keyed to the authenticated tenant (`tenantId`), matching create.
      // - The PO carries no landed cost, so pass 0 (computeLandedAdditions no-ops).
      // - Idempotent by construction: the handler rejects above (already-converted
      //   guard) if a Purchase already links this PO, so no double-post risk.
      const settings = await tx.companySettings.findFirst({
        where: { tenantId },
      });
      const approvalsEnabled = settings?.approvalsEnabled ?? false;
      const poItems = normaliseItems(purchaseOrder.items);

      await applyPurchaseReceiptEffects(tx, created, poItems, {
        tenantId,
        status: purchaseStatus,
        landedCost: 0,
        receiptDate: created.purchaseDate ?? new Date(),
        approvalsEnabled,
      });

      return created;
    }));

    res.status(201).json({
      message: 'Purchase Order converted to Purchase successfully',
      data: purchase,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Error && err.message === 'Purchase Order not found') {
      res.status(404).json({ message: err.message });
      return;
    }
    if (handleNumberConflict(res, err, 'purchaseId')) return;
    console.error(err);
    res.status(500).json({
      message: 'Error converting Purchase Order to Purchase',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updatePurchase
// =============================================================================

export async function updatePurchase(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const authUserId = requireTenantId(req);
    const body = req.body as Record<string, unknown>;

    const purchasePk = (body.id ?? body._id) as string | undefined;
    if (!purchasePk) {
      res.status(400).json({ message: 'Purchase ID is required' });
      return;
    }

    const existingPurchase = await prisma.purchase.findFirst({
      where: { id: purchasePk, tenantId: authUserId, isDeleted: false },
    });
    if (!existingPurchase) {
      res.status(404).json({ message: 'Purchase not found' });
      return;
    }

    // Maker-checker: a still-PENDING purchase must be approved/rejected before it
    // can be edited — otherwise this endpoint's void+re-post would post GL ahead of
    // approval, bypassing the gate (mirrors updatePurchaseStatus's PENDING guard).
    // Rejected here, after the tenant-scoped 404, before any mutation/GL.
    if (existingPurchase.approvalStatus === 'PENDING') {
      throw new PendingApprovalError(
        'Purchase is pending approval — approve or reject it first',
      );
    }

    // SECURITY: always use the authenticated tenant id — never trust body.tenantId.
    const tenantId = authUserId;
    const billFrom = body.billFrom as string;
    // Contact-aware party resolution (mirrors createPurchase). Empty strings coming
    // from the edit form ('') count as "not provided", so a contact-based purchase
    // does not fail the legacy supplier lookup with "Invalid bill from user or supplier".
    const incomingContactId =
      typeof body.contactId === 'string' && body.contactId ? (body.contactId as string) : null;
    const rawLegacySupplier = (body.supplierId ?? body.billTo) as unknown;
    const legacySupplierId =
      typeof rawLegacySupplier === 'string' && rawLegacySupplier ? rawLegacySupplier : null;
    const referenceNo = body.referenceNo as string | undefined;
    const purchaseDate = safeDate(body.purchaseDate) ?? existingPurchase.purchaseDate;
    const docCostCenterId =
      body.costCenterId === undefined
        ? existingPurchase.costCenterId
        : (typeof body.costCenterId === 'string' && body.costCenterId ? body.costCenterId : null);
    const items = normaliseItems(body.items, docCostCenterId);
    const notes = body.notes as string | undefined;
    const termsAndCondition = body.termsAndCondition as string | undefined;
    const paymentMode = optionalId(body.paymentMode);
    const subTotal = body.subTotal as number | undefined;
    const totalTax = body.totalTax as number | undefined;
    const totalDiscount = body.totalDiscount as number | undefined;
    const grandTotal = body.grandTotal as number | undefined;
    const signType = (body.sign_type as PurchaseSignType) ?? existingPurchase.sign_type;
    const signatureIdInput = optionalId(body.signatureId);
    const signatureName = body.signatureName as string | undefined;
    const checkNumber = body.checkNumber as string | undefined;
    const bank = optionalId(body.bank);
    // P0-4 (Task 6): sp_* payment fields are no longer consumed on the update
    // path — payment state is derived from preserved SupplierPayment rows.
    const reqStatus = body.status as PurchaseStatus | undefined;

    // Resolve the party: new contactId wins; else legacy supplierId; else keep the
    // purchase's existing party untouched. At least one must exist.
    const cdbParty = () =>
      prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
    let resolvedContactId: string | null = existingPurchase.contactId ?? null;
    let resolvedSupplierId: string | null = existingPurchase.supplierId ?? null;

    if (
      !incomingContactId &&
      !legacySupplierId &&
      !existingPurchase.contactId &&
      !existingPurchase.supplierId
    ) {
      res.status(422).json({ message: 'A contactId or a supplier (supplierId/billTo) is required.' });
      return;
    }

    if (incomingContactId) {
      const ownedContact = (await cdbParty().contact.findFirst({
        where: { id: incomingContactId, tenantId: authUserId, isDeleted: false },
        select: { id: true },
      } as never)) as { id: string } | null;
      if (!ownedContact) {
        res.status(404).json({ message: 'Contact not found' });
        return;
      }
      resolvedContactId = incomingContactId;
      resolvedSupplierId = null;
    } else if (legacySupplierId) {
      resolvedSupplierId = legacySupplierId;
      const contactRow = (await cdbParty().contact.findFirst({
        where: { legacySupplierId, tenantId: authUserId, isDeleted: false },
        select: { id: true },
      } as never)) as { id: string } | null;
      resolvedContactId = contactRow ? contactRow.id : null;
    }

    // Validate bill from user (buyer). Supplier validated only on the legacy path.
    const [billFromUser, supplier] = await Promise.all([
      prisma.user.findUnique({ where: { id: billFrom } }),
      resolvedSupplierId
        ? prisma.supplier.findFirst({ where: { id: resolvedSupplierId, isDeleted: false } })
        : Promise.resolve(null),
    ]);
    if (!billFromUser) {
      res.status(422).json({ message: 'Invalid bill from user' });
      return;
    }
    if (resolvedSupplierId && !supplier) {
      res.status(422).json({ message: 'Invalid supplier' });
      return;
    }

    // Validate signature
    if (signType && !VALID_SIGN_TYPES.has(signType)) {
      res.status(400).json({ message: 'Invalid signature type' });
      return;
    }
    if (signType === 'eSignature') {
      if (!req.file && !existingPurchase.signatureImage) {
        res.status(400).json({ message: 'Signature image is required for eSignature' });
        return;
      }
      if (!signatureName && !existingPurchase.signatureName) {
        res.status(400).json({ message: 'Signature name is required for eSignature' });
        return;
      }
    }

    // Server-authoritative totals (see createPurchase): recompute from items,
    // ignore client-sent totals. The re-post block below reads these persisted
    // figures, so the GL stays consistent.
    const serverTotals = computeDocumentTotals(items as TotalsItem[]);
    warnOnTotalsDivergence('purchase', existingPurchase.id, asNumber(grandTotal, NaN), serverTotals.grandTotal);
    const calculatedSubTotal = serverTotals.subTotal;
    const calculatedTotalDiscount = serverTotals.totalDiscount;
    const calculatedTotalTax = serverTotals.totalTax;
    const calculatedGrandTotal = serverTotals.grandTotal;

    // C3: resolve contact's defaultTaxTreatment (tenant-scoped) if available.
    const cdbUP = () => prisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
    const upContactId = existingPurchase.contactId;
    let upContactDefaultTreatment: TaxTreatment | null = null;
    if (upContactId) {
      const contactRow = (await cdbUP().contact.findFirst({
        where: { id: upContactId, tenantId: authUserId, isDeleted: false },
        select: { defaultTaxTreatment: true },
      } as never)) as { defaultTaxTreatment: TaxTreatment | null } | null;
      if (contactRow) upContactDefaultTreatment = contactRow.defaultTaxTreatment;
    }
    const docTreatmentP: TaxTreatment =
      parseTaxTreatment(body.taxTreatment) ??
      (existingPurchase.taxTreatment as TaxTreatment | null) ??
      upContactDefaultTreatment ??
      'STANDARD';
    // C3: apply treatment — STANDARD is a pass-through; suppressing treatments zero tax + item taxes.
    const enforcedPurchase = applyDocumentTreatment(docTreatmentP, calculatedTotalTax, items);
    const enforcedTotalTax = enforcedPurchase.tax;
    const enforcedItems = enforcedPurchase.items;
    // Recompute grandTotal when tax was suppressed.
    const enforcedGrandTotal = docTreatmentP === 'STANDARD'
      ? calculatedGrandTotal
      : calculatedSubTotal + enforcedTotalTax - calculatedTotalDiscount;

    // P0-4 (Task 6): the "base" status drives inventory/GL (received-ness). It is
    // NEVER derived from client sp_* payment fields anymore. paidAmount /
    // balanceAmount / paid-vs-partial refinement are recomputed inside the
    // transaction from the ACTUAL preserved SupplierPayment rows (see below), so
    // the update path can no longer wipe or fabricate payment state.
    const status: PurchaseStatus = reqStatus ?? existingPurchase.status ?? 'pending';

    const existingItems = Array.isArray(existingPurchase.items)
      ? (existingPurchase.items as unknown as IncomingItem[])
      : [];

    const newSignatureImage =
      signType === 'eSignature'
        ? req.file?.path ?? existingPurchase.signatureImage
        : null;
    const newSignatureName =
      signType === 'eSignature'
        ? signatureName ?? existingPurchase.signatureName
        : null;
    const newSignatureId =
      signType === 'digitalSignature'
        ? signatureIdInput ?? existingPurchase.signatureId
        : null;

    const updated = await prisma.$transaction(async (tx) => {
      // Revert prior inventory increments if previously received (any status except draft/cancelled).
      if (
        existingPurchase.status !== 'new' &&
        existingPurchase.status !== 'cancelled'
      ) {
        for (const item of existingItems) {
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          const qty = asNumber(item.qty, 0);
          if (!qty) continue;
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId: requireTenantId(req),
            qtyDelta: -qty,
            type: 'stock_out',
            referenceType: 'purchase',
            referenceId: existingPurchase.id,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock reverted from purchase update ${existingPurchase.purchaseId ?? existingPurchase.id}`,
              createdBy: requireActingUserId(req),
            },
          });
        }
      }

      // P0-4 (Task 6): recompute paid/balance/status from the PRESERVED
      // SupplierPayment rows (never wipe them, never trust sp_* for state).
      // paidAmount = Σ non-voided/non-deleted payments' paidAmount; balance =
      // server total − paid; status is refined to paid/partially_paid only when
      // real payments exist (0.005 tolerance). new/cancelled keep their base
      // status; a fully-unpaid document keeps its requested/existing status.
      const paidAgg = await tx.supplierPayment.aggregate({
        where: { purchaseId: existingPurchase.id, isVoided: false, isDeleted: false },
        _sum: { paidAmount: true },
      });
      const paidDec = new Prisma.Decimal(String(paidAgg._sum.paidAmount ?? 0));
      const totalDec = new Prisma.Decimal(String(enforcedGrandTotal));
      const balanceRawDec = totalDec.minus(paidDec);
      const balanceDec = balanceRawDec.lessThan(0) ? new Prisma.Decimal(0) : balanceRawDec;
      let derivedStatus: PurchaseStatus = status;
      if (status !== 'new' && status !== 'cancelled') {
        if (paidDec.greaterThanOrEqualTo(totalDec.minus(0.005)) && paidDec.greaterThan(0.005)) {
          derivedStatus = 'paid';
        } else if (paidDec.greaterThan(0.005)) {
          derivedStatus = 'partially_paid';
        }
      }

      // C.1: update currencyCode if provided (freely editable on purchases)
      const updCurrencyCode = typeof body.currencyCode === 'string' && body.currencyCode
        ? body.currencyCode
        : undefined;

      const upd = await tx.purchase.update({
        where: { id: existingPurchase.id },
        data: {
          supplierId: resolvedSupplierId,
          contactId: resolvedContactId,
          purchaseDate,
          // Previously the update path never persisted the dimension, so a
          // purchase's department could be set on create but never corrected.
          costCenterId: docCostCenterId,
          referenceNo: referenceNo ?? existingPurchase.referenceNo,
          items: enforcedItems as unknown as Prisma.InputJsonValue,
          paymentModeId: paymentMode ?? existingPurchase.paymentModeId,
          taxableAmount: toDecimal(calculatedSubTotal),
          totalDiscount: toDecimal(calculatedTotalDiscount),
          totalTax: toDecimal(enforcedTotalTax),
          totalAmount: toDecimal(enforcedGrandTotal),
          taxTreatment: docTreatmentP,
          status: derivedStatus,
          paidAmount: paidDec,
          balanceAmount: balanceDec,
          notes: notes ?? existingPurchase.notes,
          termsAndCondition: termsAndCondition ?? existingPurchase.termsAndCondition,
          sign_type: signType,
          signatureId: newSignatureId,
          signatureImage: newSignatureImage,
          signatureName: newSignatureName,
          checkNumber: checkNumber ?? existingPurchase.checkNumber,
          bankId: bank ?? existingPurchase.bankId,
          tenantId,
          billFrom,
          billTo: null,
          ...(updCurrencyCode !== undefined ? { currencyCode: updCurrencyCode } : {}),
        },
      });

      // Re-apply inventory increments if newly received (any status except draft/cancelled).
      // P3.5: stock in at the LANDED unit cost (base rate + per-unit freight/duty),
      // mirroring createPurchase. Reading stock at the raw item.rate here stripped
      // landed cost from an edited purchase's inventory valuation.
      if (status !== 'new' && status !== 'cancelled') {
        const landedCostNum = upd.landedCost != null ? asNumber(upd.landedCost, 0) : null;
        const inventoryLineParams = items.map((item) => ({
          amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
          qty: asNumber(item.qty, 0),
        }));
        const landedAdditions = computeLandedAdditions(inventoryLineParams, landedCostNum);
        for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
          const item = items[itemIdx]!;
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          const qty = asNumber(item.qty, 0);
          if (!qty) continue;
          const landedUnitCost = asNumber(item.rate, 0) + (landedAdditions[itemIdx] ?? 0);
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId: requireTenantId(req),
            qtyDelta: qty,
            type: 'stock_in',
            referenceType: 'purchase',
            referenceId: upd.id,
            unitCost: landedUnitCost,
            receiptDate: purchaseDate,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock in from updated purchase ${upd.purchaseId ?? upd.id}`,
              createdBy: requireActingUserId(req),
            },
          });
        }
      }

      // P0-4 (Task 6): DO NOT delete or re-create SupplierPayment rows here. The
      // old `deleteMany` wiped payments whose GL/bank effects still existed
      // (orphaning journal entries + bank transactions) and re-created a bare,
      // GL-less marker row. Payments are now created only via the dedicated
      // createSupplierPayment endpoint (full GL + bank side-effects); this update
      // preserves them and merely re-derives the purchase's paid/balance/status
      // above.

      // GL: void the prior received entry, then re-post ONLY when the edit did
      // not cancel the purchase. On edit-to-cancelled we void-only (mirrors
      // updatePurchaseStatus's cancel branch): stock was reverted above and is
      // NOT re-applied (the re-stock block skips new/cancelled), so re-posting a
      // live `received` entry would overstate AP/inventory for a cancelled doc.
      {
        await voidDocument(tx as unknown as PostingTx, {
          tenantId,
          sourceType: 'Purchase',
          sourceId: upd.id,
          event: 'received',
        });
        if (derivedStatus !== 'cancelled') {
          // Re-post through the SAME shared helper createPurchase uses, so the
          // edit re-posts at the purchase's document currency/rate and carries
          // its cost-centre/project dimensions. Previously this inlined the split
          // and called postPurchaseReceived with NO currency/rate/dims, so an
          // edited FX purchase re-posted at BASE rate 1 and dropped its dims.
          await postPurchaseLedger(tx, upd, tenantId);
        }
      }

      // Custom field values - reset
      await tx.customFieldValue.deleteMany({
        where: { tenantId, module: 'purchase', recordId: upd.id },
      });
      const files = Array.isArray(req.files)
        ? (req.files as Express.Multer.File[])
        : [];
      await insertCustomFieldValues(tx, upd.id, tenantId, body.customFields, files);

      return upd;
    });

    res.status(200).json({
      message: 'Purchase updated successfully',
      data: { purchase: updated },
    });

    // Fire-and-forget email — sent to the legacy supplier when present.
    // Contact-based purchases carry no legacy supplier row, so skip (guarded by ?.).
    if (supplier?.supplier_email && process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
      try {
        await sendMail({
          to: supplier.supplier_email,
          subject: 'Purchase Updated',
          html: `
            <h3>Hello ${supplier.supplier_name},</h3>
            <p>A purchase has been updated.</p>
            <p><strong>Reference No:</strong> ${updated.referenceNo ?? ''}</p>
            <p><strong>Total Amount:</strong> ${Number(updated.totalAmount)}</p>
            <p>Purchase Date: ${new Date(updated.purchaseDate).toLocaleDateString()}</p>
            <br>
            <p>Best Regards,<br>Your Company</p>
          `,
        });
      } catch (emailErr) {
        console.error(
          'Failed to send purchase update email:',
          emailErr instanceof Error ? emailErr.message : String(emailErr),
        );
      }
    }
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handlePendingApproval(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error(err);
    res.status(500).json({
      message: 'Error updating purchase',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getAllPurchases
// =============================================================================

interface ListQuery {
  page?: string;
  limit?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  paymentMode?: string;
  // Aging drill-down: filter by dueDate window instead of purchaseDate.
  dueStartDate?: string;
  dueEndDate?: string;
}

export async function getAllPurchases(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const {
      page = '1',
      limit = '10',
      status,
      search = '',
      startDate,
      endDate,
      paymentMode,
      dueStartDate,
      dueEndDate,
    } = req.query as ListQuery;

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.PurchaseWhereInput = { ...scope };
    // `status` accepts a single value or comma-separated list (AP aging drill-down
    // passes the unpaid set, e.g. new,pending,partially_paid).
    if (status) {
      const statuses = status
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is PurchaseStatus => VALID_STATUSES.has(s as PurchaseStatus));
      if (statuses.length === 1) where.status = statuses[0];
      else if (statuses.length > 1) where.status = { in: statuses };
    }
    if (paymentMode) where.paymentModeId = paymentMode;
    if (startDate || endDate) {
      where.purchaseDate = {};
      if (startDate)
        (where.purchaseDate as Prisma.DateTimeFilter).gte = new Date(startDate);
      if (endDate)
        (where.purchaseDate as Prisma.DateTimeFilter).lte = new Date(endDate);
    }
    // Aging drill-down: dueDate window.
    if (dueStartDate || dueEndDate) {
      where.dueDate = {};
      if (dueStartDate)
        (where.dueDate as Prisma.DateTimeFilter).gte = new Date(dueStartDate);
      if (dueEndDate)
        (where.dueDate as Prisma.DateTimeFilter).lte = new Date(dueEndDate);
    }
    if (search) {
      where.OR = [
        { purchaseId: { contains: search, mode: 'insensitive' } },
        { purchaseOrderId: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, purchases] = await Promise.all([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true },
          },
          supplier: {
            select: { id: true, supplier_name: true, supplier_email: true, supplier_phone: true, profileImage: true },
          },
          tenant: tenantOwnerInclude,
          billFromUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              profileImage: true,
            },
          },
          billToUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              profileImage: true,
            },
          },
          bank: {
            select: {
              id: true,
              bankName: true,
              accountNumber: true,
              accountHoldername: true,
              IFSCCode: true,
            },
          },
          paymentMode: {
            select: { id: true, name: true, slug: true, status: true },
          },
          signature: {
            select: { id: true, signatureName: true, signatureImage: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    // Module + custom field setup
    const purchaseModule = await prisma.module.findFirst({
      where: { moduleSlug: 'purchases' },
    });
    let tableFields: { id: string; fieldSlug: string; labelName: string }[] = [];
    if (purchaseModule) {
      tableFields = await prisma.customField.findMany({
        where: { tenantId: requireTenantId(req), moduleId: purchaseModule.id, showInTable: true, deletedAt: null },
        select: { id: true, fieldSlug: true, labelName: true },
      });
    }
    const purchaseIds = purchases.map((p) => p.id);
    const customValues =
      purchaseIds.length > 0
        ? await prisma.customFieldValue.findMany({
            where: { tenantId: requireTenantId(req), module: 'purchase', recordId: { in: purchaseIds } },
          })
        : [];
    const customValueMap: Record<string, Record<string, Prisma.JsonValue>> = {};
    for (const v of customValues) {
      if (!customValueMap[v.recordId]) customValueMap[v.recordId] = {};
      customValueMap[v.recordId][v.customFieldId] = v.value;
    }

    const baseUrl = buildBaseUrl(req);

    const formattedPurchases = purchases.map((purchase) => {
      const signatureImageUrl = purchase.signatureImage
        ? signedUrlFor(purchase.signatureImage.replace(/\\/g, '/'))
        : null;

      const signatureDetails =
        purchase.sign_type === 'eSignature'
          ? { name: purchase.signatureName || null, image: signatureImageUrl }
          : purchase.signature
            ? {
                id: purchase.signature.id,
                name: purchase.signature.signatureName || null,
              }
            : null;

      const customFieldsObject: Record<string, Prisma.JsonValue | null> = {};
      const purchaseValues = customValueMap[purchase.id] ?? {};
      tableFields.forEach((field) => {
        customFieldsObject[field.fieldSlug] = purchaseValues[field.id] ?? null;
      });

      const itemsArr = Array.isArray(purchase.items)
        ? (purchase.items as unknown[])
        : [];

      // Contact-aware party display: prefer contact relation; fall back to legacy supplier.
      const contactVendor = purchase.contact
        ? {
            id: purchase.contact.id,
            name: resolveDisplayName(purchase.contact),
            email: purchase.contact.email ?? null,
            phone: purchase.contact.mobile ?? null,
          }
        : null;
      const contactBillTo = purchase.contact
        ? {
            ...formatPartyDetails(
              {
                id: purchase.contact.id,
                firstName: purchase.contact.firstName ?? '',
                lastName: purchase.contact.lastName ?? null,
                email: purchase.contact.email ?? '',
                phone: purchase.contact.mobile ?? null,
              },
              baseUrl,
            ),
            // formatPartyDetails builds the name from first/last only — use the
            // org-aware display name so a company-only contact isn't blank
            // ("Deleted User") in the list.
            name: resolveDisplayName(purchase.contact),
          }
        : null;

      // Derive vendor: prefer contact, then legacy supplier
      const vendorFormatted = contactVendor
        ?? (purchase.supplier
          ? { id: purchase.supplier.id, name: purchase.supplier.supplier_name, email: purchase.supplier.supplier_email, phone: purchase.supplier.supplier_phone }
          : null);

      // Derive billTo party: prefer contact, then supplier, then legacy billToUser
      const billToParty = contactBillTo
        ?? (purchase.supplier
          ? formatSupplierParty(purchase.supplier, baseUrl)
          : formatPartyDetails(purchase.billToUser, baseUrl));

      return {
        id: purchase.id,
        purchaseId: purchase.purchaseId,
        purchaseOrderId: purchase.purchaseOrderId,
        contactId: purchase.contactId ?? null,
        vendor: vendorFormatted,
        user: formatUser(tenantOwner(purchase.tenant)),
        purchaseDate: formatDateShort(purchase.purchaseDate),
        dueDate: formatDateShort(purchase.dueDate),
        referenceNo: purchase.referenceNo,
        status: purchase.status,
        paymentMode: formatPaymentMode(purchase.paymentMode),
        taxableAmount: Number(purchase.taxableAmount),
        totalDiscount: Number(purchase.totalDiscount ?? 0),
        totalTax: Number(purchase.totalTax ?? 0),
        totalAmount: Number(purchase.totalAmount),
        paidAmount: Number(purchase.paidAmount ?? 0),
        balanceAmount: Number(purchase.balanceAmount ?? 0),
        itemsCount: itemsArr.length,
        billFrom: formatPartyDetails(purchase.billFromUser, baseUrl),
        billTo: billToParty,
        notes: purchase.notes,
        termsAndCondition: purchase.termsAndCondition,
        sign_type: purchase.sign_type,
        signature: signatureDetails,
        bank: formatBank(purchase.bank),
        checkNumber: purchase.checkNumber,

        customFields: customFieldsObject,
        currencyCode: purchase.currencyCode ?? null, // C.1
        taxTreatment: purchase.taxTreatment ?? null, // C.2

        createdAt: formatDateShort(purchase.createdAt),
        updatedAt: formatDateShort(purchase.updatedAt),
      };
    });

    res.status(200).json({
      success: true,
      message: 'Purchases retrieved successfully',
      data: {
        purchases: formattedPurchases,
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
    console.error('Get all purchases error:', err);
    res.status(500).json({
      message: 'Error fetching purchases',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listPurchasesMinimal (last 20 received purchases or search — for debit-note source dropdown)
// =============================================================================

export async function listPurchasesMinimal(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { search = '' } = req.query as { search?: string };

    const where: Prisma.PurchaseWhereInput = {
      ...scope,
      status: { in: ['pending', 'partially_paid', 'paid', 'completed'] },
    };
    if (search) {
      where.OR = [
        { purchaseId: { contains: search, mode: 'insensitive' } },
        { purchaseOrderId: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const purchases = await prisma.purchase.findMany({
      where,
      select: {
        id: true,
        purchaseId: true,
        referenceNo: true,
        purchaseDate: true,
        status: true,
        totalAmount: true,
        currencyCode: true,
        contact: { select: { id: true, organisation: true, firstName: true, lastName: true, email: true, mobile: true, telephone: true, image: true } },
        supplier: { select: { id: true, supplier_name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: search ? undefined : 20,
    });

    // Payment details lookup
    const purchaseIds = purchases.map((p) => p.id);
    const payments =
      purchaseIds.length > 0
        ? await prisma.supplierPayment.findMany({
            where: { purchaseId: { in: purchaseIds }, isDeleted: false, isVoided: false },
            select: {
              purchaseId: true,
              amount: true,
              paidAmount: true,
              dueAmount: true,
              paymentDate: true,
            },
          })
        : [];
    const paymentMap: Record<
      string,
      { amount: number; paidAmount: number; dueAmount: number; paymentDate: Date | null }
    > = {};
    for (const p of payments) {
      paymentMap[p.purchaseId] = {
        amount: Number(p.amount),
        paidAmount: Number(p.paidAmount),
        dueAmount: Number(p.dueAmount),
        paymentDate: p.paymentDate,
      };
    }

    const formatted = purchases.map((purchase) => {
      const paymentInfo = paymentMap[purchase.id] ?? null;
      // Contact-first vendor resolution: prefer unified Contact, fall back to legacy supplier.
      const vendor = purchase.contact
        ? { id: purchase.contact.id, name: resolveDisplayName(purchase.contact) }
        : purchase.supplier
          ? { id: purchase.supplier.id, name: purchase.supplier.supplier_name }
          : null;
      return {
        id: purchase.id,
        purchaseId: purchase.purchaseId,
        referenceNo: purchase.referenceNo,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
        totalAmount: Number(purchase.totalAmount),
        currencyCode: purchase.currencyCode ?? null,
        vendor,
        payment: paymentInfo
          ? {
              amount: paymentInfo.amount,
              paidAmount: paymentInfo.paidAmount,
              dueAmount: paymentInfo.dueAmount,
              paymentDate: paymentInfo.paymentDate,
            }
          : null,
      };
    });

    res.status(200).json({
      success: true,
      message: search
        ? 'Search results for paid purchases retrieved successfully'
        : 'Last 20 paid purchases retrieved successfully',
      data: formatted,
      meta: {
        count: purchases.length,
        isSearchResult: Boolean(search),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List minimal purchases error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching purchases',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listPurchasesPending
// =============================================================================

export async function listPurchasesPending(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { search = '' } = req.query as { search?: string };
    const trimmed = search.trim();

    const where: Prisma.PurchaseWhereInput = { ...scope };
    if (trimmed) {
      where.OR = [
        { purchaseId: { contains: trimmed, mode: 'insensitive' } },
        { referenceNo: { contains: trimmed, mode: 'insensitive' } },
      ];
    }

    const purchases = await prisma.purchase.findMany({
      where,
      select: {
        id: true,
        purchaseId: true,
        referenceNo: true,
        purchaseDate: true,
        status: true,
        totalAmount: true,
        supplierId: true,
        contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
        supplier: { select: { id: true, supplier_name: true } },
        billToUser: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: trimmed ? undefined : 20,
    });

    if (purchases.length === 0) {
      res.status(200).json({
        success: true,
        message: 'No pending purchases found',
        data: [],
        meta: {
          count: 0,
          isSearchResult: Boolean(trimmed),
        },
      });
      return;
    }

    const purchaseIds = purchases.map((p) => p.id);
    const payments = await prisma.supplierPayment.findMany({
      where: { purchaseId: { in: purchaseIds }, isDeleted: false, isVoided: false },
      select: {
        purchaseId: true,
        amount: true,
        paidAmount: true,
        dueAmount: true,
      },
    });

    const aggregation: Record<
      string,
      { amount: number; paidAmount: number; dueAmount: number }
    > = {};
    for (const p of payments) {
      if (!aggregation[p.purchaseId]) {
        aggregation[p.purchaseId] = { amount: 0, paidAmount: 0, dueAmount: 0 };
      }
      aggregation[p.purchaseId].amount += Number(p.amount) || 0;
      aggregation[p.purchaseId].paidAmount += Number(p.paidAmount) || 0;
      aggregation[p.purchaseId].dueAmount += Number(p.dueAmount) || 0;
    }

    const formatted = purchases.reduce<Record<string, unknown>[]>((acc, purchase) => {
      const paymentInfo = aggregation[purchase.id];
      const totalAmountNum = Number(purchase.totalAmount);
      const calculatedDueAmount = totalAmountNum - (paymentInfo?.paidAmount ?? 0);

      if (calculatedDueAmount <= 0) return acc;

      const vendorName = purchase.contact
        ? (purchase.contact.organisation?.trim() || `${purchase.contact.firstName || ''} ${purchase.contact.lastName || ''}`.trim())
        : purchase.supplier
          ? (purchase.supplier.supplier_name || '')
          : purchase.billToUser
            ? `${purchase.billToUser.firstName || ''} ${purchase.billToUser.lastName || ''}`.trim()
            : null;

      const vendorId = purchase.contact?.id ?? purchase.supplier?.id ?? purchase.billToUser?.id ?? null;

      acc.push({
        id: purchase.id,
        purchaseId: purchase.purchaseId,
        referenceNo: purchase.referenceNo,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
        totalAmount: Number(purchase.totalAmount),
        vendor: vendorId ? { id: vendorId, name: vendorName } : null,
        payment: paymentInfo
          ? {
              amount: paymentInfo.amount,
              paidAmount: paymentInfo.paidAmount,
              dueAmount: calculatedDueAmount,
              paymentDate: null,
            }
          : {
              amount: 0,
              paidAmount: 0,
              dueAmount: totalAmountNum,
              paymentDate: null,
            },
      });
      return acc;
    }, []);

    res.status(200).json({
      success: true,
      message: trimmed
        ? 'Search results for pending purchases retrieved successfully'
        : 'Pending purchases retrieved successfully',
      data: formatted,
      meta: {
        count: formatted.length,
        isSearchResult: Boolean(trimmed),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List pending purchases error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending purchases',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getPurchaseById
// =============================================================================

export async function getPurchaseById(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const baseUrl = buildBaseUrl(req);

    const purchase = await prisma.purchase.findFirst({
      where: { id, tenantId },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true, vatRegNumber: true, gstin: true, addressLine1: true, addressLine2: true, addressLine3: true, town: true, region: true, postcode: true, country: true },
        },
        supplier: {
          select: { id: true, supplier_name: true, supplier_email: true, supplier_phone: true, profileImage: true },
        },
        tenant: tenantOwnerInclude,
        billFromUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            address: true,
            profileImage: true,
          },
        },
        billToUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            address: true,
            profileImage: true,
          },
        },
        bank: {
          select: {
            id: true,
            bankName: true,
            accountNumber: true,
            accountHoldername: true,
            IFSCCode: true,
            branchName: true,
          },
        },
        paymentMode: {
          select: { id: true, name: true, slug: true, status: true },
        },
        signature: {
          select: { id: true, signatureName: true, signatureImage: true, createdAt: true },
        },
      },
    });

    if (!purchase) {
      res.status(404).json({ success: false, message: 'Purchase not found' });
      return;
    }

    // Custom field values
    const purchaseModule = await prisma.module.findFirst({
      where: { moduleSlug: 'purchases' },
    });
    const customFieldsObject: Record<string, Prisma.JsonValue | null> = {};
    if (purchaseModule) {
      const fields = await prisma.customField.findMany({
        where: { tenantId: requireTenantId(req), moduleId: purchaseModule.id, deletedAt: null },
        select: { id: true, fieldSlug: true, labelName: true },
      });
      const values = await prisma.customFieldValue.findMany({
        where: { tenantId: requireTenantId(req), module: 'purchase', recordId: purchase.id },
      });
      const valueMap: Record<string, Prisma.JsonValue> = {};
      values.forEach((v) => {
        valueMap[v.customFieldId] = v.value;
      });
      fields.forEach((field) => {
        customFieldsObject[field.fieldSlug] = valueMap[field.id] ?? null;
      });
    }

    // Items + tax group enrichment
    const rawItems = Array.isArray(purchase.items)
      ? (purchase.items as unknown as IncomingItem[])
      : [];
    const taxGroupIds = Array.from(
      new Set(
        rawItems
          .map((i) => i.tax_group_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    );
    const taxGroups =
      taxGroupIds.length > 0
        ? await prisma.taxGroup.findMany({
            where: { tenantId: requireTenantId(req), id: { in: taxGroupIds } },
            select: { id: true, tax_name: true },
          })
        : [];
    const taxGroupMap: Record<string, { id: string; name: string }> = {};
    for (const g of taxGroups) {
      taxGroupMap[g.id] = { id: g.id, name: g.tax_name };
    }

    const formattedItems = rawItems.map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      qty: item.qty,
      rate: item.rate,
      discount: item.discount,
      tax: item.tax,
      tax_group: item.tax_group_id && taxGroupMap[item.tax_group_id]
        ? taxGroupMap[item.tax_group_id]
        : null,
      discount_type: item.discount_type,
      discount_value: item.discount_value,
      amount: item.amount,
      taxes: item.taxes ?? [],
      totalTax: item.totalTax,
    }));

    let signatureDetails: Record<string, unknown> | null = null;
    if (purchase.sign_type === 'eSignature') {
      signatureDetails = {
        name: purchase.signatureName || null,
        image: purchase.signatureImage
          ? signedUrlFor(purchase.signatureImage.replace(/\\/g, '/'))
          : null,
        type: 'eSignature',
      };
    } else if (purchase.signature) {
      signatureDetails = {
        id: purchase.signature.id,
        name: purchase.signature.signatureName || null,
        image: purchase.signature.signatureImage
          ? signedUrlFor(purchase.signature.signatureImage.replace(/\\/g, '/'))
          : null,
        createdAt: purchase.signature.createdAt,
        type: 'digitalSignature',
      };
    }

    // Contact-aware party display: prefer contact relation; fall back to legacy supplier.
    const contactVendor = purchase.contact
      ? {
          id: purchase.contact.id,
          name: resolveDisplayName(purchase.contact),
          email: purchase.contact.email ?? null,
          phone: purchase.contact.mobile ?? null,
          vatRegNumber: purchase.contact.vatRegNumber ?? null,
          gstin: purchase.contact.gstin ?? null,
        }
      : null;
    const contactBillTo = purchase.contact
      ? {
          id: purchase.contact.id,
          name: resolveDisplayName(purchase.contact),
          email: purchase.contact.email ?? null,
          phone: purchase.contact.mobile ?? null,
          address: buildContactAddressLine(purchase.contact) || null,
          profileImage: '',
          vatRegNumber: purchase.contact.vatRegNumber ?? null,
          gstin: purchase.contact.gstin ?? null,
        }
      : null;

    // Derive vendor: prefer contact, then legacy supplier
    const vendorFormatted = contactVendor
      ?? (purchase.supplier
        ? { id: purchase.supplier.id, name: purchase.supplier.supplier_name, email: purchase.supplier.supplier_email, phone: purchase.supplier.supplier_phone }
        : null);

    // Derive billTo party: prefer contact, then supplier, then legacy billToUser
    const billToParty = contactBillTo
      ?? (purchase.supplier
        ? formatSupplierParty(purchase.supplier, baseUrl, true)
        : formatPartyDetails(purchase.billToUser, baseUrl, true));

    const responseData = {
      id: purchase.id,
      purchaseId: purchase.purchaseId,
      purchaseOrderId: purchase.purchaseOrderId,
      contactId: purchase.contactId ?? null,
      vendor: vendorFormatted,
      user: formatUser(tenantOwner(purchase.tenant)),
      purchaseDate: purchase.purchaseDate,
      dueDate: purchase.dueDate,
      referenceNo: purchase.referenceNo,
      status: purchase.status,
      paymentMode: formatPaymentMode(purchase.paymentMode),
      taxableAmount: Number(purchase.taxableAmount),
      totalDiscount: Number(purchase.totalDiscount ?? 0),
      totalTax: Number(purchase.totalTax ?? 0),
      totalAmount: Number(purchase.totalAmount),
      paidAmount: Number(purchase.paidAmount ?? 0),
      balanceAmount: Number(purchase.balanceAmount ?? 0),
      items: formattedItems,
      billFrom: formatPartyDetails(purchase.billFromUser, baseUrl, true),
      billTo: billToParty,
      notes: purchase.notes,
      termsAndCondition: purchase.termsAndCondition,
      sign_type: purchase.sign_type,
      signature: signatureDetails,
      bank: formatBank(purchase.bank, true),
      checkNumber: purchase.checkNumber,
      roundOff: purchase.roundOff,

      customFields: customFieldsObject,
      currencyCode: purchase.currencyCode ?? null, // C.1
      taxTreatment: purchase.taxTreatment ?? null, // C.2

      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt,
    };

    res.status(200).json({
      success: true,
      message: 'Purchase retrieved successfully',
      data: responseData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get purchase by ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Error retrieving purchase',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updatePurchaseStatus
// =============================================================================

export async function updatePurchaseStatus(req: Request, res: Response): Promise<void> {
  try {
    const authUserId = requireTenantId(req);
    const {
      status,
      sp_amount,
      sp_paid_amount,
      sp_referenceNumber,
      sp_paymentDate,
      sp_paymentMode,
      sp_notes,
    } = req.body as {
      status?: string;
      sp_amount?: number;
      sp_paid_amount?: number;
      sp_referenceNumber?: string;
      sp_paymentDate?: string;
      sp_paymentMode?: string;
      sp_notes?: string;
    };

    const { id } = req.params as { id: string };

    if (!status || !VALID_STATUSES.has(status as PurchaseStatus)) {
      res.status(400).json({ success: false, message: 'Invalid status value' });
      return;
    }
    const newStatus = status as PurchaseStatus;

    const existing = await prisma.purchase.findFirst({ where: { id, tenantId: authUserId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Purchase not found' });
      return;
    }
    if (existing.approvalStatus === 'PENDING') {
      throw new PendingApprovalError(
        'Purchase is pending approval — approve or reject it first',
      );
    }

    let paidAmount = Number(existing.paidAmount);
    let balanceAmount = Number(existing.balanceAmount);

    if (newStatus === 'paid' || newStatus === 'partially_paid') {
      if (sp_amount && sp_paid_amount) {
        if (sp_paid_amount === sp_amount) {
          paidAmount = sp_paid_amount;
          balanceAmount = 0;
        } else {
          paidAmount = sp_paid_amount;
          balanceAmount = sp_amount - sp_paid_amount;
        }
      } else if (newStatus === 'paid') {
        paidAmount = Number(existing.totalAmount);
        balanceAmount = 0;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.purchase.update({
        where: { id: existing.id },
        data: {
          status: newStatus,
          paidAmount: toDecimal(paidAmount),
          balanceAmount: toDecimal(balanceAmount),
        },
        include: {
          tenant: tenantOwnerInclude,
          billFromUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              profileImage: true,
            },
          },
          billToUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              profileImage: true,
            },
          },
          bank: {
            select: {
              id: true,
              bankName: true,
              accountNumber: true,
              accountHoldername: true,
              IFSCCode: true,
            },
          },
        },
      });

      // Cascade status to linked PurchaseOrder
      if (upd.purchaseOrderId) {
        const poStatus: PurchaseOrderStatus =
          newStatus === 'paid'
            ? 'completed'
            : newStatus === 'cancelled'
              ? 'cancelled'
              : 'pending';
        await tx.purchaseOrder.updateMany({
          where: { id: upd.purchaseOrderId, tenantId: upd.tenantId },
          data: { status: poStatus },
        });
      }

      // Supplier payment upsert (one row per purchase, legacy contract)
      if (newStatus === 'paid' || newStatus === 'partially_paid') {
        const existingSP = await tx.supplierPayment.findFirst({
          where: { purchaseId: upd.id },
        });
        if (existingSP) {
          await tx.supplierPayment.update({
            where: { id: existingSP.id },
            data: {
              referenceNumber: sp_referenceNumber ?? existingSP.referenceNumber,
              paymentDate: safeDate(sp_paymentDate) ?? existingSP.paymentDate,
              paymentModeId: sp_paymentMode ?? existingSP.paymentModeId,
              amount: asNumber(sp_amount, Number(upd.totalAmount)),
              paidAmount: asNumber(sp_paid_amount, paidAmount),
              dueAmount: balanceAmount,
              notes: sp_notes ?? existingSP.notes,
            },
          });
        } else {
          await tx.supplierPayment.create({
            data: {
              tenantId: authUserId,
              purchaseId: upd.id,
              supplierId: (upd.supplierId ?? upd.billTo) as string,
              referenceNumber: sp_referenceNumber ?? '',
              paymentDate: safeDate(sp_paymentDate) ?? new Date(),
              paymentModeId: sp_paymentMode ?? upd.paymentModeId,
              sourceType: 'BANK',
              amount: asNumber(sp_amount, Number(upd.totalAmount)),
              paidAmount: asNumber(sp_paid_amount, paidAmount),
              dueAmount: balanceAmount,
              notes: sp_notes ?? '',
              createdBy: authUserId,
            },
          });
        }
      }

      // P0-4 (Task 6): stock & received-GL transitions must be idempotent and
      // never double-count. createPurchase already stocks goods in for ANY status
      // except new/cancelled, so flipping an already-stocked purchase to `paid`
      // must NOT add stock again. Only two transitions move stock here:
      //   * new (unstocked) -> stocked status: stock IN (mirror createPurchase,
      //     landed-cost aware) via applyStockAdjustment.
      //   * stocked status -> cancelled: stock OUT via applyStockAdjustment AND
      //     void the received GL entry.
      // Same-status calls and stocked<->stocked payment flips are no-ops.
      const prevStatus = existing.status;
      const wasStocked = prevStatus !== 'new' && prevStatus !== 'cancelled';
      const willBeStocked = newStatus !== 'new' && newStatus !== 'cancelled';
      const stItems = Array.isArray(upd.items)
        ? (upd.items as unknown as IncomingItem[])
        : [];

      if (prevStatus !== newStatus && !wasStocked && willBeStocked) {
        // Unstocked -> stocked: stock in, mirroring createPurchase's landed cost.
        const inventoryLineParams = stItems.map((item) => ({
          amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
          qty: asNumber(item.qty, 0),
        }));
        const landedCostNum =
          upd.landedCost != null ? asNumber(upd.landedCost, 0) : null;
        const landedAdditions = computeLandedAdditions(inventoryLineParams, landedCostNum);
        for (let itemIdx = 0; itemIdx < stItems.length; itemIdx++) {
          const item = stItems[itemIdx]!;
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          const qty = asNumber(item.qty, 0);
          if (!qty) continue;
          const landedUnitCost = asNumber(item.rate, 0) + (landedAdditions[itemIdx] ?? 0);
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId: upd.tenantId,
            qtyDelta: qty,
            type: 'stock_in',
            referenceType: 'purchase',
            referenceId: upd.id,
            unitCost: landedUnitCost,
            receiptDate: upd.purchaseDate ?? new Date(),
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock in from purchase ${upd.purchaseId ?? upd.id}`,
              createdBy: authUserId,
            },
          });
        }

        // Fix round 1 (Task 6 review) corrected in round 2: GL posting is gated
        // ONLY by `shouldPostOnCreate(approvalsEnabled)` at create time (see
        // applyPurchaseReceiptEffects above), never by status — a `new` purchase
        // IS GL-posted at creation when approvals are off. Round 1's comment
        // here claiming "a new purchase was never GL-posted in the first place"
        // was wrong, and gating the re-post on `prevStatus === 'cancelled'`
        // alone left a hole: when approvalsEnabled=true, createPurchase defers
        // ALL posting to approvePurchase (gated on approvalStatus==='PENDING').
        // If this endpoint changed a still-PENDING purchase's status straight
        // to a stocked one, stock would move with NO GL entry ever created —
        // the approval gate above now rejects that case outright, but the
        // GL post here must also be unconditional for the remaining case: a
        // `new -> stocked` purchase whose approvalStatus is NOT_REQUIRED/
        // APPROVED (approvals off, or already approved) was never posted by
        // this endpoint at all before. `post()`'s idempotency (matches on
        // isDeleted:false, lib/ledger/postingEngine.ts) makes this a harmless
        // no-op when a JE already exists (default approvals-off path, posted
        // at create) and a correct fresh post when it doesn't (cancelled-origin
        // reactivation after void, or any legacy gap).
        await postPurchaseLedger(tx, upd, upd.tenantId);
      } else if (prevStatus !== newStatus && wasStocked && newStatus === 'cancelled') {
        // Stocked -> cancelled: reverse stock and void the received GL entry.
        for (const item of stItems) {
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          const qty = asNumber(item.qty, 0);
          if (!qty) continue;
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId: upd.tenantId,
            qtyDelta: -qty,
            type: 'stock_out',
            referenceType: 'purchase',
            referenceId: upd.id,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock reversed from purchase cancellation ${upd.purchaseId ?? upd.id}`,
              createdBy: authUserId,
            },
          });
        }
        await voidDocument(tx as unknown as PostingTx, {
          tenantId: authUserId,
          sourceType: 'Purchase',
          sourceId: upd.id,
          event: 'received',
        });
      }

      return upd;
    });

    const items = Array.isArray(updated.items)
      ? (updated.items as unknown as IncomingItem[])
      : [];

    // Hydrate product details for response
    const productIds = Array.from(
      new Set(
        items
          .map((i) => i.productId ?? i.id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    );
    const products =
      productIds.length > 0
        ? await prisma.product.findMany({
            where: { tenantId: requireTenantId(req), id: { in: productIds } },
            select: { id: true, name: true, code: true, description: true },
          })
        : [];
    const productMap: Record<
      string,
      { id: string; name: string; code: string; description: string | null }
    > = {};
    for (const p of products) productMap[p.id] = p;

    const responseData = {
      id: updated.id,
      purchaseId: updated.purchaseId,
      purchaseOrderId: updated.purchaseOrderId,
      purchaseDate: formatDateShort(updated.purchaseDate),
      dueDate: formatDateShort(updated.dueDate),
      referenceNo: updated.referenceNo,
      status: updated.status,
      paymentMode: updated.paymentModeId,
      taxableAmount: Number(updated.taxableAmount),
      totalDiscount: Number(updated.totalDiscount ?? 0),
      totalTax: Number(updated.totalTax ?? 0),
      totalAmount: Number(updated.totalAmount),
      paidAmount: Number(updated.paidAmount ?? 0),
      balanceAmount: Number(updated.balanceAmount ?? 0),
      items: items.map((item) => {
        const pid = item.productId ?? item.id;
        const prod = pid ? productMap[pid] : undefined;
        return {
          id: prod?.id ?? null,
          product: prod
            ? {
                id: prod.id,
                name: prod.name,
                sku: prod.code,
                description: prod.description,
              }
            : null,
          name: item.name,
          unit: item.unit,
          qty: item.qty,
          rate: item.rate,
          discount: item.discount,
          tax: item.tax,
          discount_type: item.discount_type,
          discount_value: item.discount_value,
          amount: item.amount,
        };
      }),
      notes: updated.notes,
      termsAndCondition: updated.termsAndCondition,
      sign_type: updated.sign_type,
      checkNumber: updated.checkNumber,
      createdAt: formatDateShort(updated.createdAt),
      updatedAt: formatDateShort(updated.updatedAt),
    };

    res.status(200).json({
      success: true,
      message: 'Purchase status updated successfully',
      data: responseData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handlePendingApproval(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Update purchase status error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating purchase status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deletePurchase (soft)
// =============================================================================

export async function deletePurchase(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.purchase.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: 'Purchase not found' });
      return;
    }
    const purchase = await prisma.$transaction(async (tx) => {
      // Revert inventory if the purchase was received (any status except
      // new/cancelled) — mirror the update-path revert so deleting a received
      // purchase puts the stock back.
      if (existing.status !== 'new' && existing.status !== 'cancelled') {
        const existingItems = Array.isArray(existing.items)
          ? (existing.items as unknown as IncomingItem[])
          : [];
        for (const item of existingItems) {
          const productId = item.productId ?? item.id;
          if (!productId) continue;
          const qty = asNumber(item.qty, 0);
          if (!qty) continue;
          await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
            productId,
            tenantId,
            qtyDelta: -qty,
            type: 'stock_out',
            referenceType: 'purchase',
            referenceId: id,
            extra: {
              unitId: item.unit ?? null,
              notes: `Stock reverted from purchase delete ${existing.purchaseId ?? id}`,
              createdBy: requireActingUserId(req),
            },
          });
        }
      }

      // Void every non-voided supplier payment recorded against this purchase
      // BEFORE the received reversal. Without this the payment JEs (Dr AP) stay
      // posted and the bank/petty balance stays reduced after the purchase is
      // gone — AP goes negative and cash is understated. reverseSupplierPayment-
      // Effects reverses the exact payment JE + restores the bank/petty balance +
      // writes a reversing txn (the same effects voidSupplierPayment applies).
      // Guard on !isDeleted so re-deleting can't double-void.
      if (!existing.isDeleted) {
        const payments = await tx.supplierPayment.findMany({
          where: { purchaseId: id, isVoided: false, isDeleted: false },
          include: { bank: true },
        });
        for (const payment of payments) {
          await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
            tenantId,
            payment,
            remarks: `Void of supplier payment ${payment.id} (purchase deleted)`,
          });
          await tx.supplierPayment.update({
            where: { id: payment.id },
            data: {
              isVoided: true,
              voidedById: requireActingUserId(req),
              voidedAt: new Date(),
              voidReason: 'Purchase deleted',
            },
          });
        }
      }

      // GL: reverse the posted received entry before soft-deleting
      await reverseDocument(tx as unknown as PostingTx, {
        tenantId,
        sourceType: 'Purchase',
        sourceId: id,
        event: 'received',
      });

      return tx.purchase.update({
        where: { id },
        data: { isDeleted: true },
      });
    });
    res.status(200).json({
      message: 'Purchase deleted successfully',
      data: purchase,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error(err);
    res.status(500).json({
      message: 'Error deleting purchase',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// createSupplierPayment
// =============================================================================

export async function createSupplierPayment(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    // Ownership is derived from the authenticated session, never trusted
    // from the request body — `body.tenantId` was previously used verbatim
    // to load/stamp records, letting a caller act as any tenant.
    const tenantId = requireTenantId(req);
    const {
      purchaseId,
      amount,
      paymentDate,
      paymentMode,
      referenceNumber,
      notes,
      bankId,
    } = req.body as {
      purchaseId?: string;
      amount?: number;
      paymentDate?: string;
      paymentMode?: string;
      referenceNumber?: string;
      notes?: string;
      bankId?: string;
    };

    if (!purchaseId || amount === undefined) {
      res.status(400).json({ message: 'Required fields missing' });
      return;
    }

    const purchase = await prisma.purchase.findFirst({ where: { id: purchaseId, tenantId } });
    if (!purchase) {
      res.status(404).json({ message: 'Purchase not found' });
      return;
    }

    const paymentAmount = asNumber(amount, 0);

    const result = await prisma.$transaction(async (tx) => {
      // Optional bank-balance side effect, mirroring the invoice pattern,
      // when a bankId is supplied.
      let bankTransaction: { id: string } | null = null;
      if (bankId && paymentMode) {
        const bank = await tx.bankDetail.findFirst({ where: { id: bankId, tenantId } });
        const paymentModeDoc = await tx.paymentMode.findUnique({
          where: { id: paymentMode },
        });
        if (bank && paymentModeDoc) {
          const transactionType =
            paymentModeDoc.slug?.toLowerCase() === 'cash'
              ? 'WITHDRAWAL'
              : 'TRANSFER_OUT';
          const balanceBefore = Number(bank.currentBalance ?? 0);
          const newBalance = balanceBefore - paymentAmount;
          await tx.bankDetail.update({
            where: { id: bank.id },
            data: {
              currentBalance: toDecimal(newBalance),
              asOnDate: new Date(),
            },
          });
          bankTransaction = await tx.bankTransaction.create({
            data: {
              tenantId: tenantId,
              bankAccountId: bank.id,
              transactionDate: safeDate(paymentDate) ?? new Date(),
              type: transactionType,
              amount: toDecimal(paymentAmount),
              balanceBefore: toDecimal(balanceBefore),
              balanceAfter: toDecimal(newBalance),
              paymentModeId: paymentModeDoc.id,
              remarks:
                notes ?? `Supplier Payment - ${purchase.purchaseId ?? purchase.id}`,
              relatedType: 'SUPPLIER_PAYMENT',
              // Banking A2: linked to a SupplierPayment → auto-explain. This inline
              // path writes NO GL journal entry, so posted:false (not reconciled).
              // postedSourceId is stamped below once the payment row exists.
              ...explainedBankFields({
                postedSourceType: 'SupplierPayment',
                postedSourceId: null,
                posted: false,
                approvedById: tenantId,
                approvedAt: new Date(),
              }),
            },
          });
        }
      }

      const supplierPayment = await tx.supplierPayment.create({
        data: {
          tenantId: tenantId,
          purchaseId: purchase.id,
          // Same-class fix as supplierPaymentController.createSupplierPayment:
          // inherit the party from the purchase so this path (currently unrouted,
          // but kept for parity) never orphans a payment either.
          contactId: purchase.contactId ?? null,
          supplierId: (purchase.supplierId ?? purchase.billTo) as string,
          paymentDate: safeDate(paymentDate) ?? new Date(),
          paymentModeId: paymentMode ?? null,
          sourceType: bankId ? 'BANK' : 'PETTY_CASH',
          bankId: bankId ?? null,
          amount: paymentAmount,
          paidAmount: paymentAmount,
          dueAmount: 0,
          referenceNumber: referenceNumber ?? null,
          notes: notes ?? null,
          createdBy: requireActingUserId(req),
        },
      });

      // Update purchase totals + status
      const newPaidAmount = Number(purchase.paidAmount) + paymentAmount;
      const newBalanceAmount = Number(purchase.totalAmount) - newPaidAmount;
      let nextStatus: PurchaseStatus = purchase.status;
      if (newBalanceAmount <= 0) nextStatus = 'paid';
      else if (newPaidAmount > 0) nextStatus = 'partially_paid';

      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          paidAmount: toDecimal(newPaidAmount),
          balanceAmount: toDecimal(newBalanceAmount),
          status: nextStatus,
        },
      });

      // Attach bank-transaction relatedId now that we have payment.id
      if (bankTransaction) {
        await tx.bankTransaction.update({
          where: { id: bankTransaction.id },
          // Banking A2: stamp the posted-source pointer alongside relatedId.
          data: { relatedId: supplierPayment.id, postedSourceId: supplierPayment.id },
        });
      }

      return supplierPayment;
    });

    res.status(201).json({
      message: 'Supplier payment created successfully',
      data: result,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error(err);
    res.status(500).json({
      message: 'Error creating supplier payment',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getSupplierPayments (for a given purchase)
// =============================================================================

export async function getSupplierPayments(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { purchaseId } = req.params as { purchaseId: string };

    // SupplierPayment has no direct tenantId column — scope via the owning Purchase.
    const owningPurchase = await prisma.purchase.findFirst({ where: { id: purchaseId, tenantId } });
    if (!owningPurchase) {
      res.status(404).json({ message: 'Purchase not found' });
      return;
    }

    const payments = await prisma.supplierPayment.findMany({
      where: { purchaseId, isDeleted: false, isVoided: false, purchase: { tenantId } },
      include: {
        supplier: {
          select: { id: true, supplier_name: true, supplier_email: true },
        },
        createdByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { paymentDate: 'desc' },
    });

    res.status(200).json({
      message: 'Supplier payments retrieved successfully',
      data: payments,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error(err);
    res.status(500).json({
      message: 'Error retrieving supplier payments',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// -----------------------------------------------------------------------------
// Type hint: keep `Purchase` referenced so type-only imports don't get pruned
// -----------------------------------------------------------------------------
 
type _PurchaseExport = Purchase;

// =============================================================================
// approvePurchase — Spec D maker-checker
// =============================================================================

export async function approvePurchase(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.purchase.findFirst({
      where: { id, tenantId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Purchase not found' });
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
      const approved = await tx.purchase.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedById: tenantId,
          approvedAt: new Date(),
        },
      });
      // Post ledger entries exactly as create would have (shared helper guarantees parity).
      // Split math is recomputed from the persisted items + current product types.
      await postPurchaseLedger(tx, approved, tenantId);
      return approved;
    });

    res.status(200).json({ success: true, message: 'Purchase approved', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('approvePurchase error:', err);
    res.status(500).json({
      success: false,
      message: 'Error approving purchase',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// rejectPurchase — Spec D maker-checker
// =============================================================================

export async function rejectPurchase(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const { reason } = req.body as { reason?: string };

    const existing = await prisma.purchase.findFirst({
      where: { id, tenantId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Purchase not found' });
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

    const updated = await prisma.purchase.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason ?? null,
      },
    });

    void tenantId; // referenced for future audit-log use
    res.status(200).json({ success: true, message: 'Purchase rejected', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('rejectPurchase error:', err);
    res.status(500).json({
      success: false,
      message: 'Error rejecting purchase',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// sendPurchaseEmail (mirrors sendInvoiceEmail; recipient = supplier / billToUser)
// =============================================================================

export async function sendPurchaseEmail(req: Request, res: Response): Promise<void> {
  try {
    const { purchaseId, to, cc, subject, htmlContent, sendAttachment = false } = req.body as {
      purchaseId?: string;
      to?: string;
      cc?: string;
      subject?: string;
      htmlContent?: string;
      sendAttachment?: boolean;
    };

    if (!purchaseId || !to || !subject || !htmlContent) {
      res.status(400).json({ message: 'Required fields missing' });
      return;
    }

    const tenantId = requireTenantId(req);

    // Scope to the authenticated user's purchase (404 if not owned)
    const existing = await prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId },
    });
    if (!existing) {
      res.status(404).json({ message: 'Purchase not found' });
      return;
    }


    const mailOptions: Record<string, unknown> = {
      to,
      cc: cc || undefined,
      subject,
      html: htmlContent,
    };

    // `sendAttachment` used to look for a PDF on local disk. Nothing in the
    // product has ever written one -- PDFs are generated in the browser -- so
    // the lookup could only ever miss, and it was the last filesystem read left
    // after uploads moved to blob storage. The flag is still accepted and still
    // means "attach the document"; wiring it up needs server-side rendering
    // that does not exist yet.

    await sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Purchase email sent successfully",
      data: existing,
    });
  } catch (err) {
    console.error('Failed to send purchase email:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send purchase email',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
