import Anthropic from '@anthropic-ai/sdk';

/**
 * Multi-turn conversational document building, via Claude.
 *
 * The model is asked to answer in JSON; when it does not, the raw text is
 * returned as the message and the structured fields are left empty (see the
 * fallback in processChatMessage). That is why every field on
 * ChatMessageResult below is optional — it describes what the model is asked
 * for, not a guarantee.
 */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContextEntity {
  _id?: string;
  [key: string]: unknown;
}

export interface ChatContext {
  customers?: Array<ChatContextEntity & { name?: string }>;
  suppliers?: Array<ChatContextEntity & { supplier_name?: string }>;
  products?: Array<ChatContextEntity & { name?: string; selling_price?: number | string }>;
  expenseCategories?: Array<ChatContextEntity & { title?: string }>;
  banks?: Array<ChatContextEntity & { bankName?: string; accountNumber?: string }>;
  paymentModes?: Array<ChatContextEntity & { name?: string }>;
}

export interface ChatMessageResult {
  message: string;
  documentType?: string | null;
  extractedData?: Record<string, unknown> | null;
  isComplete?: boolean;
  missingFields?: string[];
  confidence?: number;
  summary?: string | null;
  tokensUsed: { inputTokens: number; outputTokens: number };
  processingTimeMs: number;
  [key: string]: unknown;
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CHAT_SYSTEM_PROMPT = `You are Elixir Books AI, a conversational accounting assistant. You help users create financial documents (invoices, purchase orders, quotations, expenses) through multi-turn conversation.

BEHAVIOR:
1. When the user describes a transaction, extract whatever information you can.
2. If critical information is missing, ask for it conversationally. Never ask more than 2 questions at once.
3. Once you have enough information, present a summary and ask for confirmation.

REQUIRED FIELDS BY DOCUMENT TYPE:
- Invoice: customer name (MUST exist in database), at least one item with rate, (optional: tax, due date)
- Purchase Order: vendor name (MUST exist in database), at least one item with rate, (optional: due date)
- Quotation: customer name (MUST exist in database), at least one item with rate, (optional: expiry date)
- Expense: amount, category, (optional: vendor, payment status)

RESPONSE FORMAT:
You MUST respond with valid JSON only. No markdown, no code fences.

{
  "message": "Your conversational response to the user",
  "documentType": "invoice|purchase_order|quotation|expense|null",
  "extractedData": {
    "customerName": "string or null",
    "vendorName": "string or null",
    "items": [{"name": "string", "quantity": number, "rate": number, "amount": number}],
    "currency": "INR|USD|EUR|GBP",
    "tax": {"type": "GST|CGST_SGST|IGST|VAT|none", "rate": number|null, "inclusive": false},
    "dueDate": "YYYY-MM-DD or null",
    "paymentTermsDays": number|null,
    "notes": "string or null",
    "recurring": {"enabled": false, "interval": null},
    "expenseCategory": "string or null",
    "paymentStatus": "PAID|PENDING|null",
    "paymentSource": "bank|petty_cash|null",
    "expenseAmount": "number or null — REQUIRED for expense: total expense amount",
    "paymentModeName": "string or null (for BANK expenses)",
    "bankName": "string or null (for BANK expenses)"
  },
  "isComplete": false,
  "missingFields": ["list of fields still needed"],
  "confidence": 0.0-1.0,
  "summary": "One line summary of what will be created, or null if not ready"
}

RULES:
- extractedData should accumulate across turns - include ALL previously gathered data plus new data.
- isComplete = true ONLY when you have all required fields and the user confirms.
- Start with isComplete = false and missing fields.
- If user says "yes", "confirm", "looks good", "create it" - set isComplete = true.
- If user wants to change something, update the relevant field and keep isComplete = false.
- Be friendly and concise. Don't repeat information unnecessarily.

CRITICAL - CUSTOMER/VENDOR/PRODUCT VALIDATION:
Every name the user provides MUST be validated against the DATABASE CONTEXT lists before proceeding.

=== CUSTOMER VALIDATION ===
Check the user's customer name against AVAILABLE CUSTOMERS using these rules:

MATCHING LOGIC:
- First, check for an EXACT case-insensitive match (e.g. "james" matches "James").
- If no exact match, check for PARTIAL matches (e.g. "james" partially matches both "James" AND "james johnn").
- If MULTIPLE entries match (exact OR partial), treat it as a MULTIPLE MATCH — do NOT pick one automatically.

- NOT FOUND (zero matches): Simply tell the user that customer was not found. Ask them to check the name and try again. Set customerName = null, isComplete = false, missingFields includes "customer". DO NOT list available customers.
- MULTIPLE MATCHES: Tell the user "Multiple customers found matching '[name]'", list ONLY the matching options exactly as they appear in the database, ask them to choose one. Set customerName = null, isComplete = false, missingFields includes "customer".
- SINGLE MATCH (only one result): Use that exact name from the database. Proceed normally.

IMPORTANT: "james" matches BOTH "James" AND "james johnn" — this is a MULTIPLE MATCH. Never silently pick one.

=== VENDOR VALIDATION ===
Check the user's vendor name against AVAILABLE VENDORS using the same matching logic above:

- NOT FOUND (zero matches): Simply tell the user that vendor was not found. Ask them to check the name and try again. Set vendorName = null, isComplete = false, missingFields includes "vendor". DO NOT list available vendors.
- MULTIPLE MATCHES: Tell the user "Multiple vendors found matching '[name]'", list ONLY the matching options exactly as they appear in the database, ask them to choose one. Set vendorName = null, isComplete = false, missingFields includes "vendor".
- SINGLE MATCH (only one result): Use that exact name from the database. Proceed normally.

=== PRODUCT VALIDATION ===
Check each item the user mentions against AVAILABLE PRODUCTS using the same matching logic above:

- NOT FOUND (zero matches): Simply tell the user that product was not found. Ask them to check the name and try again. Remove that item from the items array. DO NOT list available products.
- MULTIPLE MATCHES: Tell the user "Multiple products found matching '[name]'", list ONLY the matching options with their prices, ask them to choose one. Do not add the item to the items array until resolved.
- SINGLE MATCH (only one result): Use that product's name and price from the database as the rate. Proceed normally.
- If the user provides a custom rate for a matched product, use their rate instead of the database rate.

=== EXPENSE CATEGORY VALIDATION ===
For expense documents, check the expenseCategory against AVAILABLE EXPENSE CATEGORIES:
- NOT FOUND: Tell user the category was not found. Ask them to check and retry. Set expenseCategory = null. DO NOT list all categories.
- MULTIPLE MATCHES: List only the matching categories, ask user to choose one.
- SINGLE MATCH: Use that exact category name. Proceed normally.

=== EXPENSE SOURCE & BANK VALIDATION ===
For expense documents:
- Always ask or extract paymentSource: "BANK" or "PETTY_CASH".
- If paymentSource is "BANK", check AVAILABLE BANKS in context:
  - SINGLE BANK AVAILABLE: Auto-select it. No need to ask.
  - MULTIPLE BANKS: List only bank names with last 4 digits of account number. Ask which one.
  - If user mentions a bank name, match it against AVAILABLE BANKS using the same matching logic.
- If paymentSource is "PETTY_CASH", no bank selection needed.

EXPENSE REQUIRED FIELDS: amount, expenseCategory (must exist in database), paymentSource (BANK or PETTY_CASH), and bankId if BANK.
- If sourceType is BANK: also required — bankId (from AVAILABLE BANKS) and paymentMode (from AVAILABLE PAYMENT MODES).
- vendorName is OPTIONAL for expenses — validate against AVAILABLE VENDORS if provided, but do not require it.

=== PAYMENT MODE VALIDATION (only when sourceType = BANK) ===
Check the user's payment mode against AVAILABLE PAYMENT MODES:
- SINGLE MATCH: Use it. Proceed.
- MULTIPLE MATCHES: List only matching options, ask user to choose.
- NOT FOUND: Tell user it was not found, ask to retry. Do NOT list all modes.
- AUTO-SELECT: If only one payment mode exists, select it automatically without asking.

HARD RULES (apply to all three):
- NEVER suggest creating a new customer, vendor, or product.
- NEVER proceed or set isComplete = true with any unresolved name.
- NEVER offer "proceed anyway" or "add as new" options. Only names from the lists are accepted.
- NEVER partially validate — every customer, vendor, and product in the document must be confirmed from the list before isComplete = true.
- NEVER dump the full list on NOT FOUND — only show matches when there are multiple matches.`;

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Pull the text out of a Claude response. `content[0]` is a union of block
 * types and only a text block carries `.text`; the JS original read it
 * unconditionally.
 */
function extractText(message: Anthropic.Message): string {
  const block = message.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('AI returned no text content');
  }
  return block.text.trim();
}

/** Process a chat message in a conversational session. */
export async function processChatMessage(
  messageHistory: ChatHistoryMessage[],
  userMessage: string,
  context: ChatContext,
): Promise<ChatMessageResult> {
  const startTime = Date.now();

  // Build context string
  let contextStr = '';
  if (context.customers?.length) {
    contextStr += `\nAVAILABLE CUSTOMERS: ${context.customers.map((c) => c.name).join(', ')}`;
  }
  if (context.suppliers?.length) {
    contextStr += `\nAVAILABLE VENDORS: ${context.suppliers.map((s) => s.supplier_name).join(', ')}`;
  }
  if (context.products?.length) {
    contextStr += `\nAVAILABLE PRODUCTS: ${context.products
      .map((p) => `${p.name} (₹${p.selling_price})`)
      .join(', ')}`;
  }

  if (context.expenseCategories?.length) {
    contextStr += `\nAVAILABLE EXPENSE CATEGORIES: ${context.expenseCategories
      .map((c) => c.title)
      .join(', ')}`;
  }
  if (context.banks?.length) {
    contextStr += `\nAVAILABLE BANKS: ${context.banks
      .map((b) => `${b.bankName} (Account: ...${b.accountNumber?.slice(-4)})`)
      .join(', ')}`;
  }

  if (context.paymentModes?.length) {
    contextStr += `\nAVAILABLE PAYMENT MODES: ${context.paymentModes.map((m) => m.name).join(', ')}`;
  }

  const systemPrompt = contextStr
    ? `${CHAT_SYSTEM_PROMPT}\n\nDATABASE CONTEXT:${contextStr}`
    : CHAT_SYSTEM_PROMPT;

  // Build messages for Claude
  const messages: Anthropic.MessageParam[] = messageHistory.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
  messages.push({ role: 'user', content: userMessage });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1536,
    system: systemPrompt,
    messages,
  });

  const processingTimeMs = Date.now() - startTime;
  const rawText = extractText(response);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } else {
      parsed = {
        message: rawText,
        documentType: null,
        extractedData: null,
        isComplete: false,
        missingFields: [],
        confidence: 0,
        summary: null,
      };
    }
  }

  return {
    message: '',
    ...parsed,
    tokensUsed: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    processingTimeMs,
  } as ChatMessageResult;
}

// CommonJS interop for the require() call site in aiController.
module.exports = { processChatMessage };
module.exports.processChatMessage = processChatMessage;
