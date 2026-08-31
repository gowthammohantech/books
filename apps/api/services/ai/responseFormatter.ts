import dayjs from 'dayjs';

/**
 * Shapes the AI extraction pipeline produces, then formats into the payloads
 * the existing controllers accept.
 *
 * These types describe what the LLM-derived data is *expected* to look like
 * after entity resolution. Everything is optional because the source is model
 * output: the formatter's job is to fill the gaps with defaults, which is why
 * almost every field below has a `||` fallback.
 */
export type AiDocumentType = 'invoice' | 'purchase_order' | 'quotation' | 'expense';

export interface AiTaxInfo {
  type?: string;
  rate?: number;
  inclusive?: boolean;
}

export interface AiSourceItem {
  productId?: string;
  name?: string;
  unit?: string;
  quantity?: number;
  rate?: number;
  amount?: number | string;
  taxGroupId?: string | null;
}

export interface AiResolvedData {
  items?: AiSourceItem[];
  tax?: AiTaxInfo;
  dueDate?: string | number | Date;
  paymentTermsDays?: number | null;
  notes?: string;
  customerId?: string;
  vendorId?: string;
  expenseCategoryId?: string | null;
  expenseAmount?: number | string;
  amount?: number | string;
  paymentSource?: string;
  paymentStatus?: string;
  paymentMode?: string | null;
  bankId?: string | null;
  recurring?: { enabled?: boolean; interval?: string };
}

export interface AiUserContext {
  tenantId: string;
  [key: string]: unknown;
}

export interface FormattedItem {
  id: string;
  name: string;
  unit: string;
  qty: number;
  rate: number;
  discount: number;
  tax: number;
  tax_group_id: string | null;
  discount_type: string;
  discount_value: number;
  amount: number;
}

interface Totals {
  taxableAmount: number;
  vat: number;
  totalDiscount: number;
  TotalAmount: number;
}

export type FormattedPayload = Record<string, unknown>;

/**
 * Format AI-resolved data into the schema expected by existing Elixir Books
 * controllers.
 */
export function formatForController(
  documentType: AiDocumentType,
  // The entity resolver hands back a loosely-typed record (it merges model
  // output with database lookups), so accept that and read the fields this
  // module actually uses off AiResolvedData.
  resolvedData: AiResolvedData & Record<string, unknown>,
  userContext: AiUserContext,
): FormattedPayload {
  switch (documentType) {
    case 'invoice':
      return formatInvoice(resolvedData, userContext);
    case 'purchase_order':
      return formatPurchaseOrder(resolvedData, userContext);
    case 'quotation':
      return formatQuotation(resolvedData, userContext);
    case 'expense':
      return formatExpense(resolvedData, userContext);
    default:
      throw new Error(`Unsupported document type: ${String(documentType)}`);
  }
}

/** Due date: explicit value, else payment terms, else `fallbackDays` out. */
function resolveDueDate(data: AiResolvedData, fallbackDays: number): Date {
  if (data.dueDate) return new Date(data.dueDate);
  if (data.paymentTermsDays != null) return dayjs().add(data.paymentTermsDays, 'day').toDate();
  return dayjs().add(fallbackDays, 'day').toDate();
}

function formatInvoice(data: AiResolvedData, userContext: AiUserContext): FormattedPayload {
  const items = formatItems(data.items, data.tax);
  const { taxableAmount, vat, totalDiscount, TotalAmount } = calculateTotals(items, data.tax);

  const dueDate = resolveDueDate(data, 15);

  const payload: FormattedPayload = {
    customerId: data.customerId || userContext.tenantId,
    invoiceDate: new Date(),
    dueDate,
    referenceNo: '',
    items,
    status: 'DRAFT',
    taxableAmount,
    vat,
    totalDiscount,
    TotalAmount,
    roundOff: false,
    notes: data.notes || '',
    termsAndCondition: '',
    sign_type: 'none',
    tenantId: userContext.tenantId,
    billFrom: userContext.tenantId,
    billTo: data.customerId || userContext.tenantId,
    isRecurring: data.recurring?.enabled || false,
    repeatEvery: data.recurring?.interval || 'month',
  };

  if (data.recurring?.enabled) {
    payload.startOn = new Date();
    payload.neverExpire = true;
  }

  return payload;
}

function formatPurchaseOrder(data: AiResolvedData, userContext: AiUserContext): FormattedPayload {
  const items = formatItems(data.items, data.tax);
  const { taxableAmount, vat, totalDiscount, TotalAmount } = calculateTotals(items, data.tax);

  const dueDate = resolveDueDate(data, 30);

  return {
    vendorId: data.vendorId || userContext.tenantId,
    purchaseOrderDate: new Date(),
    dueDate,
    referenceNo: '',
    items,
    status: 'new',
    taxableAmount,
    vat,
    totalDiscount,
    TotalAmount,
    roundOff: false,
    notes: data.notes || '',
    termsAndCondition: '',
    sign_type: 'none',
    tenantId: userContext.tenantId,
    billFrom: userContext.tenantId,
    billTo: data.vendorId || userContext.tenantId,
  };
}

function formatQuotation(data: AiResolvedData, userContext: AiUserContext): FormattedPayload {
  const items = formatItems(data.items, data.tax);
  const { taxableAmount, vat, totalDiscount, TotalAmount } = calculateTotals(items, data.tax);

  const expiryDate = resolveDueDate(data, 30);

  return {
    customerId: data.customerId || userContext.tenantId,
    quotationDate: new Date(),
    expiryDate,
    referenceNo: '',
    items,
    status: 'draft',
    taxableAmount,
    vat,
    totalDiscount,
    TotalAmount,
    roundOff: false,
    notes: data.notes || '',
    termsAndCondition: '',
    sign_type: 'none',
    tenantId: userContext.tenantId,
    billFrom: userContext.tenantId,
    billTo: data.customerId || userContext.tenantId,
  };
}

function formatExpense(data: AiResolvedData, userContext: AiUserContext): FormattedPayload {
  const parseAmount = (val: unknown): number => {
    if (typeof val === 'number' && val > 0) return val;
    if (typeof val === 'string') {
      const cleaned = parseFloat(val.replace(/,/g, ''));
      if (!isNaN(cleaned) && cleaned > 0) return cleaned;
    }
    return 0;
  };

  const amount =
    parseAmount(data.expenseAmount) ||
    parseAmount(data.amount) ||
    (data.items?.reduce((sum, item) => sum + parseAmount(item.amount), 0) ?? 0);

  if (amount === 0) {
    console.warn('[formatExpense] Amount resolved to 0. Raw data:', JSON.stringify(data));
  }
  const rawSource = (data.paymentSource || 'PETTY_CASH').toString().toUpperCase().trim();
  const sourceType = rawSource === 'BANK' ? 'BANK' : 'PETTY_CASH';
  return {
    amount,
    expenseDate: data.dueDate ? new Date(data.dueDate) : new Date(),
    description: data.notes || data.items?.map((i) => i.name).join(', ') || '',
    expenseCategoryId: data.expenseCategoryId || null,
    sourceType,
    paymentStatus: data.paymentStatus || 'PENDING',
    paymentMode: data.paymentMode || null,
    bankId: data.bankId || null,
    vendorId: data.vendorId || null,
    tenantId: userContext.tenantId,
  };
}

/** Format items array with tax calculations. */
function formatItems(items: AiSourceItem[] | undefined, taxInfo?: AiTaxInfo): FormattedItem[] {
  if (!items || items.length === 0) return [];

  return items.map((item, index) => {
    const qty = item.quantity || 1;
    const rate = item.rate || 0;
    const baseAmount = qty * rate;

    let taxAmount = 0;
    const taxGroupId: string | null = null;

    if (taxInfo && taxInfo.type !== 'none' && taxInfo.rate) {
      if (taxInfo.inclusive) {
        // Tax inclusive: rate already includes tax
        taxAmount = baseAmount - baseAmount / (1 + taxInfo.rate / 100);
      } else {
        // Tax exclusive: add tax on top
        taxAmount = (baseAmount * taxInfo.rate) / 100;
      }
    }

    return {
      id: item.productId || `item-${index + 1}`,
      name: item.name || `Item ${index + 1}`,
      unit: item.unit || '',
      qty,
      rate,
      discount: 0,
      tax: Math.round(taxAmount * 100) / 100,
      tax_group_id: item.taxGroupId || taxGroupId,
      discount_type: 'Fixed',
      discount_value: 0,
      amount: Math.round((baseAmount + (taxInfo?.inclusive ? 0 : taxAmount)) * 100) / 100,
    };
  });
}

/** Calculate totals from formatted items. */
function calculateTotals(items: FormattedItem[], taxInfo?: AiTaxInfo): Totals {
  const taxableAmount = items.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const vat = items.reduce((sum, item) => sum + (item.tax || 0), 0);
  const totalDiscount = items.reduce((sum, item) => sum + (item.discount || 0), 0);

  const TotalAmount = taxInfo?.inclusive
    ? taxableAmount - totalDiscount
    : taxableAmount + vat - totalDiscount;

  return {
    taxableAmount: Math.round(taxableAmount * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    TotalAmount: Math.round(TotalAmount * 100) / 100,
  };
}

// CommonJS interop for the require() call site in aiController.
module.exports = { formatForController };
module.exports.formatForController = formatForController;
