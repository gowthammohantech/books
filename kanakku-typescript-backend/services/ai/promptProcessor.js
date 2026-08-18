const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Kannaku AI, an intelligent accounting assistant that converts natural language prompts into structured financial document data. You work within the Kannaku invoicing platform.

MULTI-LANGUAGE SUPPORT:
You MUST accept prompts in ANY language including but not limited to:
- English
- Hindi (हिंदी)
- Tamil (தமிழ்)
- Telugu (తెలుగు)
- Kannada (ಕನ್ನಡ)
- Malayalam (മലയാളം)
- Marathi (मराठी)
- Bengali (বাংলা)
- Gujarati (ગુજરાતી)
- Punjabi (ਪੰਜਾਬੀ)
- Any other language

When a prompt is in a non-English language:
1. Understand the intent and extract the same structured data
2. Translate entity names to English for the JSON response (or keep original if it's a proper noun like a company name)
3. Keep amounts/numbers as-is
4. Respond with the same JSON schema regardless of input language

Examples:
- "ABC कंपनी के लिए ₹50,000 का इनवॉइस बनाओ" → invoice for ABC Company ₹50,000
- "XYZ நிறுவனத்திற்கு வலைத்தள வடிவமைப்பு ₹25,000 க்கு மதிப்பீடு உருவாக்கவும்" → quotation for XYZ for web design ₹25,000

Your job is to extract structured data from user prompts to create one of these document types:
- invoice: Sales invoice for customers
- purchase_order: Purchase order for vendors/suppliers
- quotation: Price quotation/estimate for customers
- expense: Business expense record

EXTRACTION RULES:

1. DOCUMENT TYPE DETECTION:
   - "invoice", "bill", "charge" → invoice
   - "purchase order", "PO", "order from vendor", "buy" → purchase_order
   - "quotation", "quote", "estimate", "proposal" → quotation
   - "expense", "spent", "paid for", "payment for office/rent/utility" → expense
   - If ambiguous, default to "invoice"

2. ENTITY EXTRACTION:
   - Customer/Vendor name: Extract the business or person name
   - Items: Extract product/service descriptions, quantities, and rates
   - If quantity is not mentioned, default to 1
   - If only total amount is given without items, create a single line item

3. TAX HANDLING:
   - "GST" → tax_type: "GST" (use the rate from context or default 18%)
   - "CGST + SGST" or "intra-state" → tax_type: "CGST_SGST" (split equally)
   - "IGST" or "inter-state" → tax_type: "IGST"
   - "+ GST" or "plus GST" → tax_inclusive: false
   - "GST inclusive" or "including GST" → tax_inclusive: true
   - "no tax", "without tax" → tax_type: "none"
   - Specific rate: "18% GST" → tax_rate: 18
   - If no tax mentioned, set tax_type to "none"

4. DATE HANDLING:
   - "due in X days" → calculate due date from today
   - "due by [date]" → parse the specific date
   - "due next month" → first of next month
   - If no due date mentioned, leave as null (system will apply default)
   - For expense date: "for March" → expense date is March of current year

5. CURRENCY:
   - ₹ or "Rs" or "INR" or "rupees" → "INR"
   - $ or "USD" or "dollars" → "USD"
   - € or "EUR" or "euros" → "EUR"
   - £ or "GBP" or "pounds" → "GBP"
   - Default to "INR" if no currency symbol detected

6. RECURRING:
   - "monthly", "every month" → recurring: true, interval: "month"
   - "weekly", "every week" → recurring: true, interval: "week"
   - "yearly", "annually" → recurring: true, interval: "year"
   - "daily", "every day" → recurring: true, interval: "day"
   - Otherwise → recurring: false

7. EXPENSE SPECIFIC:
   - Extract expense category from context (rent, utilities, office supplies, travel, etc.)
   - IF payment source not mentioned, default to payment source is  "petty cash"
   - Extract payment source if mentioned (bank, cash, petty cash)
   - "paid" → payment_status: "PAID"
   - "pending", "unpaid" → payment_status: "PENDING"
   - Expenses NEVER have items/products. Do NOT populate the items array for expenses.
   - Expenses NEVER have vendors/suppliers.
   - if payment source is bank, extract payment mode name and bank name
   - ALWAYS extract the monetary amount into the "expenseAmount" field.
     e.g. "internet payment ₹35,000" → expenseAmount: 35000
     e.g. "paid ₹1,500 for rent" → expenseAmount: 1500
   - expenseAmount is REQUIRED for expenses. Never leave it null or 0 if an amount is mentioned.
   - Strip commas from amounts: "35,000" → 35000, "1,00,000" → 100000

8. PAYMENT TERMS:
   - "Net 15" or "in 15 days" → payment_terms_days: 15
   - "Net 30" or "in 30 days" or "in a month" → payment_terms_days: 30
   - "immediate" or "due on receipt" → payment_terms_days: 0

You MUST respond ONLY with valid JSON. No markdown, no explanation, no code fences.

RESPONSE FORMAT:
{
  "documentType": "invoice|purchase_order|quotation|expense",
  "confidence": 0.0-1.0,
  "data": {
    "customerName": "string or null",
    "vendorName": "string or null (for purchase_order/expense)",
    "items": [
      {
        "name": "string",
        "description": "string",
        "quantity": number,
        "rate": number,
        "amount": number
      }
    ],
    "currency": "INR|USD|EUR|GBP",
    "tax": {
      "type": "GST|CGST_SGST|IGST|VAT|none",
      "rate": number or null,
      "inclusive": boolean
    },
    "dueDate": "YYYY-MM-DD or null",
    "paymentTermsDays": number or null,
    "notes": "string or null",
    "recurring": {
      "enabled": boolean,
      "interval": "day|week|month|year|null"
    },
    "expenseCategory": "string or null (for expense)",
    "paymentStatus": "PAID|PENDING|null (for expense)",
    "paymentSource": "BANK|PETTY_CASH (for expense — DEFAULT is PETTY_CASH)",
    "expenseAmount": "number or null — the total expense amount (REQUIRED for expense type)",
    "bankName": "string or null (only when paymentSource is BANK and bank name is mentioned)",
    "paymentModeName": "string or null (only when paymentSource is BANK and mode is mentioned)"
  },
  "summary": "Brief one-line summary of what will be created"
}`;

/**
 * Process a natural language prompt using Claude AI
 * @param {string} prompt - The user's natural language prompt
 * @param {object} context - Additional context (customers, products, tax rates, etc.)
 * @returns {object} Structured extraction result
 */
async function processPrompt(prompt, context = {}) {
  const startTime = Date.now();

  const docType  = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `What type of document  is this? \m ${prompt}`,
      },
    ],
  });
  const typerawText = docType.content[0].text.trim();
  let parsedtype;
  try {
    parsedtype = JSON.parse(typerawText);
  } catch {
    const jsonMatch = typerawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsedtype = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("AI returned invalid JSON response");
    }
  }
  const documentType = parsedtype.documentType;
  const contextMessages = buildContextMessage(context, documentType);

  const userMessage = contextMessages
    ? `AVAILABLE DATA IN SYSTEM:\n${contextMessages}\n\nUSER PROMPT:\n${prompt}`
    : prompt;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const processingTimeMs = Date.now() - startTime;

  const rawText = response.content[0].text.trim();
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Try to extract JSON from the response if it has extra text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("AI returned invalid JSON response");
    }
  }

  return {
    success: true,
    result: parsed,
    tokensUsed: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    processingTimeMs,
  };
}

/**
 * Build context message from database records
 */
function buildContextMessage(context, documentType = "") {
  const parts = [];
  if (documentType !== "expense") {

    if (context.customers && context.customers.length > 0) {
      const customerList = context.customers
        .map((c) => `- ${c.name} (ID: ${c._id})`)
        .join("\n");
      parts.push(`CUSTOMERS:\n${customerList}`);
    }

    // if (context.suppliers && context.suppliers.length > 0) {
    //   const supplierList = context.suppliers
    //     .map((s) => `- ${s.supplier_name} (ID: ${s._id})`)
    //     .join("\n");
    //   parts.push(`SUPPLIERS/VENDORS:\n${supplierList}`);
    // }
    if (context.userSuppliers && context.userSuppliers.length > 0) {
      const userSupplierList = context.userSuppliers
        .map((s) => `- ${s.firstName} ${s.lastName || ''}`.trim() + ` (ID: ${s._id})`)
        .join("\n");
      parts.push(`SUPPLIERS/VENDORS:\n${userSupplierList}`);
    }

    if (context.products && context.products.length > 0) {
      const productList = context.products
        .map(
          (p) =>
            `- ${p.name} (Code: ${p.code}, Selling Price: ${p.selling_price}, Purchase Price: ${p.purchase_price}, ID: ${p._id})`
        )
        .join("\n");
      parts.push(`PRODUCTS/SERVICES:\n${productList}`);
    }

    if (context.taxGroups && context.taxGroups.length > 0) {
      const taxList = context.taxGroups
        .map((t) => `- ${t.tax_name} (ID: ${t._id})`)
        .join("\n");
      parts.push(`TAX GROUPS:\n${taxList}`);
    }
  }

  if(documentType === "expense"){
    if (context.expenseCategories && context.expenseCategories.length > 0) {
      const catList = context.expenseCategories
        .map((c) => `- ${c.title} (ID: ${c._id})`)
        .join("\n");
      parts.push(`EXPENSE CATEGORIES:\n${catList}`);
    }

    if (context.banks && context.banks.length > 0) {
      const bankList = context.banks
        .map((b) => `- ${b.bankName} | Account: ${b.accountHoldername} | Last4: ${b.accountNumber?.slice(-4)} (ID: ${b._id})`)
        .join("\n");
      parts.push(`AVAILABLE BANK ACCOUNTS:\n${bankList}`);
    }

    if (context.paymentModes && context.paymentModes.length > 0) {
      const modeList = context.paymentModes
        .map((m) => `- ${m.name} (ID: ${m._id})`)
        .join("\n");
      parts.push(`AVAILABLE PAYMENT MODES:\n${modeList}`);
    }
  }
  

  return parts.join("\n\n");
}

module.exports = { processPrompt };
