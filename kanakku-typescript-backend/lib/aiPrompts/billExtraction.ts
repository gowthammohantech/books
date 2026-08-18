/**
 * System prompt + JSON schema for the bill extraction task
 * (Cluster H, slice H.2).
 *
 * Both Claude and OpenAI providers ship this prompt verbatim and request
 * a JSON response. The shape is mirrored in the frontend `ScanBillModal`
 * and in `MockProvider.extractDocument()` so all three stay in sync.
 */

export interface BillLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface BillTaxBreakdown {
  label: string;
  rate: number;
  amount: number;
}

export interface BillExtractionResult {
  vendorName: string | null;
  vendorGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  lineItems: BillLineItem[];
  taxBreakdown: BillTaxBreakdown[];
  subtotal: number;
  total: number;
  notes: string | null;
  _confidence: number;
}

export const BILL_EXTRACTION_SYSTEM_PROMPT = `You are an expert at extracting structured data from supplier bills and invoices. You will be given the contents of a bill (PDF or image). Extract the data and return ONLY a single JSON object, with no markdown fencing and no commentary.

Rules:
- Output JSON only. Do not wrap in \`\`\`json fences.
- Use null for fields that are not present (do not guess).
- Currency: use the ISO code if visible (INR, USD, EUR, GBP). Default to "INR".
- Dates: ISO 8601 (YYYY-MM-DD). Leave null if unparseable.
- Amounts: numbers (not strings). Use a dot for decimals.
- vendorGstin: 15-character Indian GSTIN if shown, else null.
- lineItems: one entry per row of goods/services. quantity, unitPrice, amount are required numbers.
- taxBreakdown: each tax row separately (e.g. CGST 9%, SGST 9%, IGST 18%). \`rate\` is the percent as a number.
- subtotal: pre-tax total. total: post-tax grand total.
- _confidence: your overall confidence in the extraction from 0.0 to 1.0.

Return JSON matching exactly this schema (do not add or remove keys):
{
  "vendorName": string | null,
  "vendorGstin": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": string | null,
  "dueDate": string | null,
  "currency": string,
  "lineItems": [ { "description": string, "quantity": number, "unitPrice": number, "amount": number } ],
  "taxBreakdown": [ { "label": string, "rate": number, "amount": number } ],
  "subtotal": number,
  "total": number,
  "notes": string | null,
  "_confidence": number
}`;

export const BILL_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    vendorName: { type: ['string', 'null'] },
    vendorGstin: { type: ['string', 'null'] },
    invoiceNumber: { type: ['string', 'null'] },
    invoiceDate: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] },
    currency: { type: 'string' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          amount: { type: 'number' },
        },
        required: ['description', 'quantity', 'unitPrice', 'amount'],
      },
    },
    taxBreakdown: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          rate: { type: 'number' },
          amount: { type: 'number' },
        },
        required: ['label', 'rate', 'amount'],
      },
    },
    subtotal: { type: 'number' },
    total: { type: 'number' },
    notes: { type: ['string', 'null'] },
    _confidence: { type: 'number' },
  },
  required: [
    'vendorName',
    'currency',
    'lineItems',
    'taxBreakdown',
    'subtotal',
    'total',
    '_confidence',
  ],
} as const;

/**
 * Best-effort parser. Strips common wrappers (markdown fences, leading
 * "Here is the JSON:" prefixes) and JSON.parse-s the result. Throws on
 * unrecoverable input — caller maps to FAILED job status.
 */
export function parseBillExtractionResponse(raw: string): BillExtractionResult {
  let text = (raw ?? '').trim();
  // Strip markdown fences if the model added them.
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  // Some models prefix with "Here is the JSON:" — find the first { and the
  // matching last } to be robust.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  const parsed = JSON.parse(text);
  return normalizeBillExtraction(parsed);
}

/**
 * Normalize loose JSON into the canonical `BillExtractionResult` shape.
 * Defends against missing arrays, string-typed numbers, and stray fields
 * the model may have invented.
 */
export function normalizeBillExtraction(input: unknown): BillExtractionResult {
  const obj = (input ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback = 0): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const cleaned = v.replace(/[^0-9.\-]/g, '');
      const parsed = Number.parseFloat(cleaned);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  const lineItemsRaw = Array.isArray(obj.lineItems) ? (obj.lineItems as unknown[]) : [];
  const taxBreakdownRaw = Array.isArray(obj.taxBreakdown) ? (obj.taxBreakdown as unknown[]) : [];
  return {
    vendorName: str(obj.vendorName),
    vendorGstin: str(obj.vendorGstin),
    invoiceNumber: str(obj.invoiceNumber),
    invoiceDate: str(obj.invoiceDate),
    dueDate: str(obj.dueDate),
    currency: typeof obj.currency === 'string' && obj.currency.trim() ? obj.currency : 'INR',
    lineItems: lineItemsRaw.map((li) => {
      const item = (li ?? {}) as Record<string, unknown>;
      return {
        description: typeof item.description === 'string' ? item.description : '',
        quantity: num(item.quantity),
        unitPrice: num(item.unitPrice),
        amount: num(item.amount),
      };
    }),
    taxBreakdown: taxBreakdownRaw.map((tb) => {
      const item = (tb ?? {}) as Record<string, unknown>;
      return {
        label: typeof item.label === 'string' ? item.label : '',
        rate: num(item.rate),
        amount: num(item.amount),
      };
    }),
    subtotal: num(obj.subtotal),
    total: num(obj.total),
    notes: str(obj.notes),
    _confidence: Math.max(0, Math.min(1, num(obj._confidence, 0.5))),
  };
}
