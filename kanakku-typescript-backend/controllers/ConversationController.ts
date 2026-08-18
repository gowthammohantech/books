// services/ConversationalAIService.ts
import { Prisma } from '@prisma/client';
import type { Conversation as ConversationModel, ConversationDocumentType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { prisma } from '../lib/prisma';

// utils/openai is still JS — require via CommonJS shim.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openaiModule = require('../utils/openai') as {
  openai: {
    chat: {
      completions: {
        create: (opts: {
          model: string;
          messages: Array<{ role: string; content: string }>;
          temperature?: number;
          response_format?: { type: string };
        }) => Promise<{ choices: Array<{ message: { content: string } }> }>;
      };
    };
  };
};
const openai = openaiModule.openai;

type Tx = Prisma.TransactionClient;

// ----- Context / shared shapes (Conversation.context is Json in Prisma) -----

interface PendingSelections {
  type: 'none' | 'customer' | 'product' | 'category';
  options: Record<string, unknown>[];
  selectedId?: string | null;
  field?: string | null;
}

interface EditMode {
  active: boolean;
  documentId?: string | null;
  documentType?: 'invoice' | 'quotation' | 'expense' | null;
  originalData?: unknown;
}

interface ConversationHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date | string;
}

interface ExtractedCustomer {
  identifier?: string | null;
  id?: string | null;
}

interface ExtractedItem {
  name?: string;
  quantity?: number;
  id?: string;
  rate?: number;
}

interface ExtractedData {
  customer?: ExtractedCustomer;
  items?: ExtractedItem[];
  amount?: number | null;
  dueDate?: string | null;
  invoiceDate?: string | null;
  quotationDate?: string | null;
  expenseDate?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  taxInfo?: { type: string; rate: number | null };
  isRecurring?: boolean;
  paymentMethod?: string | null;
  sourceType?: 'BANK' | 'PETTY_CASH' | null;
  paymentMode?: string | null;
  bankId?: string | null;
  expenseCategory?: string | null;
  paymentStatus?: string | null;
  description?: string | null;
  neverExpire?: boolean;
}

interface ValidationResult {
  customer?: Record<string, unknown> | null;
  products?: Array<Record<string, unknown>>;
  missingFields: string[];
  canCreate: boolean;
  needsCustomerSelection?: boolean;
  needsProductSelection?: boolean;
  needsCategorySelection?: boolean;
  customerOptions?: Record<string, unknown>[];
  productOptions?: Record<string, unknown>[];
  categoryOptions?: Record<string, unknown>[];
  pendingProductField?: string | null;
  customerNotFound?: boolean;
  customerSearchTerm?: string | null;
  documentFields?: Record<string, unknown>;
  missingRequiredFields: string[];
  invalidItems?: Array<{ index: number; item: string; missing: string[] }>;
  conditionalRequirements: string[];
  // expense-specific
  expenseCategory?: Record<string, unknown> | null;
  amount?: number;
  sourceType?: string;
  paymentMode?: string;
  paymentStatus?: string;
  expenseDate?: string;
  description?: string;
  dueDate?: string;
  invoiceDate?: string;
}

interface ConversationContext {
  step:
    | 'initial'
    | 'collecting_missing_fields'
    | 'confirming'
    | 'edit_document'
    | 'delete_confirm';
  extractedData: ExtractedData | null;
  validationResults: ValidationResult | null;
  missingFields: string[];
  collectedData: Record<string, unknown>;
  pendingSelections: PendingSelections;
  editMode: EditMode;
  lastPrompt: string | null;
  conversationHistory: ConversationHistoryEntry[];
}

interface ProcessResponse {
  type: string;
  message?: string;
  data?: Record<string, unknown>;
  sessionId?: string;
  step?: string;
  documentType?: ConversationDocumentType | null;
}

interface InvoiceItemPreview {
  name: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface DocumentPreview {
  customer?: Record<string, unknown> | null;
  items?: InvoiceItemPreview[];
  subtotal?: number;
  total?: number;
  dueDate?: Date | string;
  invoiceDate?: Date | string;
  amount?: number;
  category?: Record<string, unknown> | null;
  paymentMode?: string;
  sourceType?: string;
  description?: string;
  expenseDate?: Date | string;
}

// ----- The class -----

class ConversationalAIController {
  userId: string;
  sessionId: string;
  conversation: ConversationModel | null;

  constructor(userId: string, sessionId: string | null = null) {
    this.userId = userId;
    this.sessionId = sessionId || uuidv4();
    this.conversation = null;
  }

  /** Convenience accessor that asserts conversation is initialized. */
  private requireConversation(): ConversationModel {
    if (!this.conversation) {
      throw new Error('Conversation not initialized');
    }
    return this.conversation;
  }

  /** Read the typed context; create a fresh one if missing. */
  private getContext(): ConversationContext {
    const conv = this.requireConversation();
    const raw = (conv.context ?? {}) as Partial<ConversationContext>;
    return {
      step: raw.step || 'initial',
      extractedData: raw.extractedData ?? null,
      validationResults: raw.validationResults ?? null,
      missingFields: raw.missingFields ?? [],
      collectedData: raw.collectedData ?? {},
      pendingSelections: raw.pendingSelections ?? {
        type: 'none',
        options: [],
        selectedId: null,
        field: null,
      },
      editMode: raw.editMode ?? {
        active: false,
        documentId: null,
        documentType: null,
        originalData: null,
      },
      lastPrompt: raw.lastPrompt ?? null,
      conversationHistory: raw.conversationHistory ?? [],
    };
  }

  private async saveConversation(
    context: ConversationContext,
    overrides: Partial<{ documentType: ConversationDocumentType | null; status: 'active' | 'completed' | 'expired' }> = {},
  ): Promise<void> {
    const conv = this.requireConversation();
    const data: Prisma.ConversationUpdateInput = {
      context: context as unknown as Prisma.InputJsonValue,
    };
    if (overrides.documentType !== undefined) data.documentType = overrides.documentType;
    if (overrides.status !== undefined) data.status = overrides.status;

    this.conversation = await prisma.conversation.update({
      where: { id: conv.id },
      data,
    });
  }

  async initializeConversation(): Promise<ConversationModel> {
    let conv = await prisma.conversation.findFirst({
      where: {
        userId: this.userId,
        sessionId: this.sessionId,
        status: 'active',
      },
    });

    if (!conv) {
      const defaultContext: ConversationContext = {
        step: 'initial',
        extractedData: null,
        validationResults: null,
        missingFields: [],
        collectedData: {},
        pendingSelections: {
          type: 'none',
          options: [],
          selectedId: null,
          field: null,
        },
        editMode: {
          active: false,
          documentId: null,
          documentType: null,
          originalData: null,
        },
        lastPrompt: null,
        conversationHistory: [],
      };
      conv = await prisma.conversation.create({
        data: {
          userId: this.userId,
          sessionId: this.sessionId,
          context: defaultContext as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      // Heal missing fields in the existing context blob.
      const ctx = (conv.context ?? {}) as Partial<ConversationContext>;
      const healed: ConversationContext = {
        step: ctx.step || 'initial',
        extractedData: ctx.extractedData ?? null,
        validationResults: ctx.validationResults ?? null,
        missingFields: ctx.missingFields ?? [],
        collectedData: ctx.collectedData ?? {},
        pendingSelections: ctx.pendingSelections ?? {
          type: 'none',
          options: [],
          selectedId: null,
          field: null,
        },
        editMode: ctx.editMode ?? {
          active: false,
          documentId: null,
          documentType: null,
          originalData: null,
        },
        lastPrompt: ctx.lastPrompt ?? null,
        conversationHistory: ctx.conversationHistory ?? [],
      };
      conv = await prisma.conversation.update({
        where: { id: conv.id },
        data: { context: healed as unknown as Prisma.InputJsonValue },
      });
    }

    this.conversation = conv;
    return conv;
  }

  async processMessage(message: string): Promise<ProcessResponse> {
    await this.initializeConversation();
    const conv = this.requireConversation();
    const context = this.getContext();

    console.log('Current step:', context.step);
    console.log('Document type:', conv.documentType);

    // Add message to history
    context.conversationHistory.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    let response: ProcessResponse;
    try {
      // Check if user wants to create a new customer
      if (
        message.toLowerCase().includes('create new customer') ||
        message.toLowerCase().includes('add new customer')
      ) {
        response = await this.handleCustomerCreation(message, context);
      } else if (context.pendingSelections.type !== 'none') {
        response = await this.handleSelection(message, context);
      } else if (context.editMode.active) {
        response = await this.handleEdit(message);
      } else {
        switch (context.step) {
          case 'initial':
            response = await this.handleInitialPrompt(message, context);
            break;
          case 'collecting_missing_fields':
            response = await this.handleMissingFields(message, context);
            break;
          case 'confirming':
            response = await this.handleConfirmation(message, context);
            break;
          case 'edit_document':
            response = await this.handleEditCommand(message, context);
            break;
          case 'delete_confirm':
            response = await this.handleDeleteConfirm(message, context);
            break;
          default:
            response = await this.handleInitialPrompt(message, context);
        }
      }

      // Add AI response to history
      if (response) {
        context.conversationHistory.push({
          role: 'assistant',
          content: response.message || '',
          timestamp: new Date(),
        });
      }

      context.lastPrompt = message;
      await this.saveConversation(context);

      return {
        ...response,
        sessionId: this.sessionId,
        step: this.getContext().step,
        documentType: this.requireConversation().documentType,
      };
    } catch (error) {
      console.error('Error in processMessage:', error);
      throw error;
    }
  }

  async handleInitialPrompt(prompt: string, context: ConversationContext): Promise<ProcessResponse> {
    try {
      const { documentType, extractedData } = await this.understandIntent(prompt);

      const docTypeEnum: ConversationDocumentType | null =
        documentType === 'invoice' || documentType === 'quotation' || documentType === 'expense'
          ? (documentType as ConversationDocumentType)
          : null;

      // Persist documentType on the row
      if (docTypeEnum) {
        const conv = this.requireConversation();
        this.conversation = await prisma.conversation.update({
          where: { id: conv.id },
          data: { documentType: docTypeEnum },
        });
      }

      context.extractedData = extractedData;

      let validationResults: ValidationResult;
      switch (documentType) {
        case 'invoice':
          validationResults = await this.validateInvoiceData(extractedData);
          break;
        case 'quotation':
          validationResults = await this.validateQuotationData(extractedData);
          break;
        case 'expense':
          validationResults = await this.validateExpenseData(extractedData);
          break;
        default:
          return {
            type: 'error',
            message:
              "I couldn't determine what you want to create. Please specify invoice, quotation, or expense.",
          };
      }

      context.validationResults = validationResults;

      if (validationResults.needsCustomerSelection) {
        context.pendingSelections = {
          type: 'customer',
          options: validationResults.customerOptions || [],
          field: 'customer',
        };
        return {
          type: 'selection',
          message: this.formatCustomerSelectionMessage(validationResults.customerOptions || []),
          data: { options: validationResults.customerOptions },
        };
      }

      if (validationResults.needsProductSelection) {
        context.pendingSelections = {
          type: 'product',
          options: validationResults.productOptions || [],
          field: validationResults.pendingProductField || null,
        };
        return {
          type: 'selection',
          message: this.formatProductSelectionMessage(validationResults.productOptions || []),
          data: { options: validationResults.productOptions },
        };
      }

      if (validationResults.canCreate) {
        context.step = 'confirming';
        const preview = await this.previewDocument(validationResults, docTypeEnum);
        return {
          type: 'confirmation',
          message: this.formatConfirmationMessage(preview, docTypeEnum || documentType),
          data: { preview, validationResults },
        };
      } else {
        context.step = 'collecting_missing_fields';
        context.missingFields = validationResults.missingFields;

        let offerCreation = false;
        if (validationResults.customerNotFound) offerCreation = true;

        return {
          type: 'missing_info',
          message: this.formatMissingInfoMessage(validationResults, docTypeEnum || documentType),
          data: {
            missingFields: validationResults.missingFields,
            customerNotFound: validationResults.customerNotFound,
            customerSearchTerm: validationResults.customerSearchTerm,
            offerCreation,
            missingRequiredFields: validationResults.missingRequiredFields,
            conditionalRequirements: validationResults.conditionalRequirements,
            invalidItems: validationResults.invalidItems,
          },
        };
      }
    } catch (error) {
      console.error('Error in handleInitialPrompt:', error);
      return {
        type: 'error',
        message: "I couldn't process your request. Please try again.",
      };
    }
  }

  async understandIntent(
    prompt: string,
  ): Promise<{ documentType: string; extractedData: ExtractedData }> {
    const systemPrompt = `
        You are an AI assistant for a business management system. Analyze the user's prompt and determine:
        1. What document type they want to create (invoice, quotation, or expense)
        2. Extract relevant information based on document type

        Return a JSON object with this structure:
        {
            "documentType": "invoice" | "quotation" | "expense",
            "extractedData": {
                // For invoices and quotations:
                "customer": { "identifier": "customer name/email" },
                "items": [{ "name": "product name", "quantity": number }],
                "amount": number | null,
                "dueDate": "YYYY-MM-DD" | null,
                "notes": string | null,
                "isRecurring": boolean | null,
                "paymentMethod": string | null,

                // For expenses:
                "expenseCategory": "category name" | null,
                "paymentMode": "payment mode" | null,
                "description": string | null,
                "sourceType": "BANK" | "PETTY_CASH" | null,
                "bankId": string | null
            }
        }
        `;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_DEPLOYMENT_NAME || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0].message.content) as {
      documentType: string;
      extractedData: ExtractedData;
    };
  }

  getRequiredFields(
    documentType: string,
  ): {
    base: string[];
    itemFields?: string[];
    conditional?: Record<string, string[]>;
    optional?: string[];
  } {
    const requiredFields: Record<
      string,
      { base: string[]; itemFields?: string[]; conditional?: Record<string, string[]>; optional?: string[] }
    > = {
      invoice: {
        base: ['customerId', 'invoiceDate', 'items', 'userId', 'billFrom', 'billTo'],
        itemFields: ['id', 'name', 'qty', 'rate', 'amount'],
        conditional: {
          bank: ['bankId', 'payment_method'],
          recurring: ['repeatEvery', 'startOn'],
        },
        optional: [
          'dueDate',
          'referenceNo',
          'notes',
          'termsAndCondition',
          'totalDiscount',
          'vat',
          'roundOff',
        ],
      },
      quotation: {
        base: ['quotationDate', 'items', 'userId', 'billFrom', 'billTo'],
        itemFields: ['id', 'name', 'qty', 'rate', 'amount'],
        optional: ['expiryDate', 'referenceNo', 'notes', 'paymentTerms', 'totalDiscount', 'vat'],
      },
      expense: {
        base: ['amount', 'expenseDate', 'paymentStatus', 'expenseCategoryId', 'sourceType', 'userId'],
        conditional: { bank: ['bankId', 'paymentMode'] },
        optional: ['referenceNo', 'description', 'attachment'],
      },
    };

    return requiredFields[documentType] || requiredFields.invoice;
  }

  checkRequiredFields(
    obj: Record<string, unknown> | null | undefined,
    requiredFields: { base?: string[]; itemFields?: string[] },
    type: 'base' | 'itemFields' = 'base',
  ): { isValid: boolean; missing: string[] } {
    if (!obj) return { isValid: false, missing: [] };

    const missing: string[] = [];
    const fieldsToCheck = requiredFields[type] || [];

    for (const field of fieldsToCheck) {
      if (field.includes('.')) {
        const parts = field.split('.');
        let value: unknown = obj;
        for (const part of parts) {
          if (
            !value ||
            typeof value !== 'object' ||
            (value as Record<string, unknown>)[part] === undefined ||
            (value as Record<string, unknown>)[part] === null ||
            (value as Record<string, unknown>)[part] === ''
          ) {
            missing.push(field);
            break;
          }
          value = (value as Record<string, unknown>)[part];
        }
      } else {
        if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
          missing.push(field);
        }
      }
    }

    return { isValid: missing.length === 0, missing };
  }

  checkItemFields(
    items: Array<Record<string, unknown>> | undefined,
    requiredFields: { itemFields?: string[] },
  ): { isValid: boolean; missing?: string[]; missingItems?: Array<{ index: number; item: string; missing: string[] }> } {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { isValid: false, missing: ['items'] };
    }

    const missingItems: Array<{ index: number; item: string; missing: string[] }> = [];

    items.forEach((item, index) => {
      const itemCheck = this.checkRequiredFields(item, requiredFields, 'itemFields');
      if (!itemCheck.isValid) {
        missingItems.push({
          index: index + 1,
          item: (item.name as string) || `Item ${index + 1}`,
          missing: itemCheck.missing,
        });
      }
    });

    return { isValid: missingItems.length === 0, missingItems };
  }

  async validateInvoiceData(extractedData: ExtractedData): Promise<ValidationResult> {
    const validationResult: ValidationResult = {
      customer: null,
      products: [],
      missingFields: [],
      canCreate: false,
      needsCustomerSelection: false,
      needsProductSelection: false,
      customerOptions: [],
      productOptions: [],
      pendingProductField: null,
      customerNotFound: false,
      customerSearchTerm: null,
      documentFields: {},
      missingRequiredFields: [],
      invalidItems: [],
      conditionalRequirements: [],
    };

    const requiredFields = this.getRequiredFields('invoice');

    // Validate customer
    if (extractedData.customer?.identifier) {
      const searchTerm = extractedData.customer.identifier;
      validationResult.customerSearchTerm = searchTerm;

      const customers = await this.findCustomers(searchTerm);

      if (customers.length === 1) {
        validationResult.customer = customers[0];
        validationResult.documentFields!.customerId = customers[0].id;
        console.log('Customer found:', customers[0].name);
      } else if (customers.length > 1) {
        validationResult.needsCustomerSelection = true;
        validationResult.customerOptions = customers;
        console.log('Multiple customers found:', customers.length);
      } else {
        validationResult.customerNotFound = true;
        validationResult.missingFields.push('customer');
        validationResult.missingRequiredFields.push('customerId');
        console.log('No customer found for:', searchTerm);
      }
    } else {
      validationResult.missingFields.push('customer');
      validationResult.missingRequiredFields.push('customerId');
      console.log('No customer identifier in extractedData');
    }

    if (!extractedData.invoiceDate) {
      validationResult.missingRequiredFields.push('invoiceDate');
    }

    if (extractedData.items && extractedData.items.length > 0) {
      const validProducts: Array<Record<string, unknown>> = [];

      for (const item of extractedData.items) {
        const products = await this.findProducts(item.name || '');

        if (products.length === 1) {
          const product = products[0];
          validProducts.push({
            ...product,
            requestedQuantity: item.quantity || 1,
            id: product.id,
            name: product.name,
            qty: item.quantity || 1,
            rate: Number(product.selling_price),
            amount: Number(product.selling_price) * (item.quantity || 1),
          });
          console.log('Product found:', product.name);
        } else if (products.length > 1) {
          validationResult.needsProductSelection = true;
          validationResult.productOptions = products;
          validationResult.pendingProductField = item.name || null;
          console.log('Multiple products found for:', item.name);
          break;
        } else {
          validationResult.missingFields.push(`product:${item.name}`);
          validationResult.missingRequiredFields.push(`product:${item.name}`);
          console.log('No product found for:', item.name);
        }
      }

      if (validProducts.length > 0 && !validationResult.needsProductSelection) {
        validationResult.products = validProducts;

        const itemCheck = this.checkItemFields(validProducts, requiredFields);
        if (!itemCheck.isValid) {
          validationResult.invalidItems = itemCheck.missingItems || [];
          validationResult.missingRequiredFields.push('invalid_items');
        }
      }
    } else {
      validationResult.missingFields.push('items');
      validationResult.missingRequiredFields.push('items');
      console.log('No items in extractedData');
    }

    if (
      extractedData.paymentMethod === 'bank' ||
      extractedData.sourceType === 'BANK'
    ) {
      validationResult.conditionalRequirements.push('bankId');
      validationResult.conditionalRequirements.push('payment_method');
      validationResult.missingFields.push('bankDetails');
    }

    if (extractedData.isRecurring) {
      validationResult.conditionalRequirements.push('repeatEvery');
      validationResult.conditionalRequirements.push('startOn');
      if (!extractedData.neverExpire) {
        validationResult.conditionalRequirements.push('endsOn');
      }
    }

    validationResult.missingFields = [
      ...new Set([
        ...validationResult.missingFields,
        ...validationResult.missingRequiredFields,
        ...validationResult.conditionalRequirements,
      ]),
    ];

    validationResult.canCreate =
      validationResult.customer !== null &&
      (validationResult.products?.length || 0) > 0 &&
      (validationResult.invalidItems?.length || 0) === 0 &&
      !validationResult.needsCustomerSelection &&
      !validationResult.needsProductSelection &&
      validationResult.missingRequiredFields.length === 0;

    console.log('Enhanced Validation result:', {
      canCreate: validationResult.canCreate,
      hasCustomer: validationResult.customer !== null,
      productsCount: validationResult.products?.length || 0,
      missingRequiredFields: validationResult.missingRequiredFields,
      conditionalRequirements: validationResult.conditionalRequirements,
      invalidItems: validationResult.invalidItems?.length || 0,
    });

    return validationResult;
  }

  async validateQuotationData(extractedData: ExtractedData): Promise<ValidationResult> {
    const validationResult = await this.validateInvoiceData(extractedData);

    if (!extractedData.quotationDate) {
      validationResult.missingRequiredFields.push('quotationDate');
    }

    if (extractedData.expiryDate) {
      const expiryDate = new Date(extractedData.expiryDate);
      if (isNaN(expiryDate.getTime())) {
        validationResult.missingFields.push('valid_expiryDate');
      }
    }

    return validationResult;
  }

  async validateExpenseData(extractedData: ExtractedData): Promise<ValidationResult> {
    const validationResult: ValidationResult = {
      expenseCategory: null,
      missingFields: [],
      canCreate: false,
      needsCategorySelection: false,
      categoryOptions: [],
      missingRequiredFields: [],
      conditionalRequirements: [],
    };

    // Validate amount
    if (!extractedData.amount) {
      validationResult.missingFields.push('amount');
      validationResult.missingRequiredFields.push('amount');
    } else {
      validationResult.amount = extractedData.amount;
    }

    // Validate expense date
    if (!extractedData.expenseDate) {
      validationResult.missingRequiredFields.push('expenseDate');
    }

    // Validate category
    if (extractedData.expenseCategory) {
      const categories = await this.findExpenseCategories(extractedData.expenseCategory);
      if (categories.length === 1) {
        validationResult.expenseCategory = categories[0];
      } else if (categories.length > 1) {
        validationResult.needsCategorySelection = true;
        validationResult.categoryOptions = categories;
      } else {
        validationResult.missingFields.push('expenseCategory');
        validationResult.missingRequiredFields.push('expenseCategoryId');
      }
    } else {
      validationResult.missingFields.push('expenseCategory');
      validationResult.missingRequiredFields.push('expenseCategoryId');
    }

    // Validate source type
    if (!extractedData.sourceType) {
      validationResult.missingFields.push('sourceType');
      validationResult.missingRequiredFields.push('sourceType');
    } else {
      validationResult.sourceType = extractedData.sourceType;
    }

    // Validate payment status
    if (!extractedData.paymentStatus) {
      validationResult.missingRequiredFields.push('paymentStatus');
    }

    // Conditional requirements based on source type
    if (extractedData.sourceType === 'BANK') {
      if (!extractedData.paymentMode) {
        validationResult.conditionalRequirements.push('paymentMode');
        validationResult.missingFields.push('paymentMode');
      }
      if (!extractedData.bankId) {
        validationResult.conditionalRequirements.push('bankId');
        validationResult.missingFields.push('bankId');
      }
    }

    validationResult.canCreate =
      !!validationResult.expenseCategory &&
      !validationResult.needsCategorySelection &&
      validationResult.missingRequiredFields.length === 0;

    return validationResult;
  }

  async handleSelection(message: string, context: ConversationContext): Promise<ProcessResponse> {
    console.log('Handling selection with message:', message);
    console.log('Current pending selection:', context.pendingSelections);

    const selection = context.pendingSelections;

    if (!selection || selection.type === 'none') {
      return { type: 'error', message: 'No pending selection found.' };
    }

    const selectedIndex = parseInt(message, 10) - 1;

    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= selection.options.length
    ) {
      return {
        type: 'selection',
        message: `Please select a valid option (1-${selection.options.length})`,
        data: { options: selection.options },
      };
    }

    const itemObject = { ...selection.options[selectedIndex] };
    console.log('Selected item type:', selection.type);
    console.log('Selected item:', (itemObject as { name?: string }).name || (itemObject as { id?: string }).id);

    if (selection.type === 'customer') {
      if (!context.validationResults) {
        context.validationResults = {
          missingFields: [],
          canCreate: false,
          missingRequiredFields: [],
          conditionalRequirements: [],
        };
      }
      context.validationResults.customer = itemObject;

      if (!context.extractedData) context.extractedData = {};
      if (!context.extractedData.customer) context.extractedData.customer = {};
      context.extractedData.customer.identifier = (itemObject as { name?: string }).name || null;
      context.extractedData.customer.id = ((itemObject as { id?: string }).id) || null;

      console.log('Customer set to:', (itemObject as { name?: string }).name);
    } else if (selection.type === 'product') {
      if (!context.validationResults) {
        context.validationResults = {
          products: [],
          missingFields: [],
          canCreate: false,
          missingRequiredFields: [],
          conditionalRequirements: [],
        };
      }
      if (!context.validationResults.products) context.validationResults.products = [];

      const itemId = String((itemObject as { id?: string }).id || '');
      const itemPrice = Number((itemObject as { selling_price?: number }).selling_price || 0);
      context.validationResults.products.push({
        ...itemObject,
        requestedQuantity: 1,
        id: itemId,
        qty: 1,
        rate: itemPrice,
        amount: itemPrice,
      });

      if (!context.extractedData) context.extractedData = { items: [] };
      if (!context.extractedData.items) context.extractedData.items = [];

      const itemName = (itemObject as { name?: string }).name || '';
      const existingItemIndex = context.extractedData.items.findIndex(
        (it) => it.name && it.name.toLowerCase() === itemName.toLowerCase(),
      );

      if (existingItemIndex >= 0) {
        context.extractedData.items[existingItemIndex].quantity =
          (context.extractedData.items[existingItemIndex].quantity || 0) + 1;
      } else {
        context.extractedData.items.push({
          name: itemName,
          quantity: 1,
          id: itemId,
          rate: itemPrice,
        });
      }

      console.log('Product added:', itemName);
    }

    context.pendingSelections = {
      type: 'none',
      options: [],
      selectedId: null,
      field: null,
    };

    console.log(
      'Before re-validation - extractedData:',
      JSON.stringify(context.extractedData, null, 2),
    );

    const conv = this.requireConversation();
    let newValidationResult: ValidationResult;
    switch (conv.documentType) {
      case 'invoice':
        newValidationResult = await this.validateInvoiceData(context.extractedData || {});
        break;
      case 'quotation':
        newValidationResult = await this.validateQuotationData(context.extractedData || {});
        break;
      case 'expense':
        newValidationResult = await this.validateExpenseData(context.extractedData || {});
        break;
      default:
        newValidationResult = await this.validateInvoiceData(context.extractedData || {});
    }

    context.validationResults = newValidationResult;
    console.log(
      'After re-validation - newValidationResult:',
      JSON.stringify(newValidationResult, null, 2),
    );

    if (newValidationResult.canCreate) {
      console.log('Can create document, moving to confirmation step');
      context.step = 'confirming';
      const preview = await this.previewDocument(newValidationResult, conv.documentType);

      await this.saveConversation(context);

      return {
        type: 'confirmation',
        message: this.formatConfirmationMessage(preview, conv.documentType),
        data: {
          preview,
          validationResults: newValidationResult,
          extractedData: context.extractedData,
        },
      };
    } else {
      console.log('Cannot create document, staying in collecting_missing_fields');
      context.step = 'collecting_missing_fields';
      context.missingFields = newValidationResult.missingFields || [];

      await this.saveConversation(context);

      return {
        type: 'missing_info',
        message: this.formatMissingInfoMessage(newValidationResult, conv.documentType),
        data: {
          missingFields: newValidationResult.missingFields,
          customerNotFound: newValidationResult.customerNotFound,
          customerSearchTerm: newValidationResult.customerSearchTerm,
          missingRequiredFields: newValidationResult.missingRequiredFields,
          conditionalRequirements: newValidationResult.conditionalRequirements,
          invalidItems: newValidationResult.invalidItems,
        },
      };
    }
  }

  async handleMissingFields(message: string, context: ConversationContext): Promise<ProcessResponse> {
    console.log('Handling missing fields');

    const missingFields = context.missingFields || [];
    const extractedData: ExtractedData = context.extractedData || {
      customer: { identifier: null },
      items: [],
      amount: null,
      dueDate: null,
      invoiceDate: null,
      notes: null,
      taxInfo: { type: 'none', rate: null },
      isRecurring: false,
      paymentMethod: null,
      sourceType: null,
    };

    const lowerMessage = message.toLowerCase();

    // Customer detection
    if (missingFields.includes('customer') || missingFields.includes('customerId')) {
      const customerMatch = lowerMessage.match(/(?:customer(?:\s+is)?\s+)(.+)/i);
      let customerIdentifier: string | null = null;

      if (customerMatch) {
        customerIdentifier = customerMatch[1].trim();
      } else if (
        !lowerMessage.includes('item') &&
        !lowerMessage.includes('product') &&
        !lowerMessage.match(/\d+\s+/)
      ) {
        customerIdentifier = message.trim();
      }

      if (customerIdentifier) {
        console.log('Looking for customer:', customerIdentifier);

        const customers = await this.findCustomers(customerIdentifier);

        if (customers.length === 1) {
          extractedData.customer = {
            identifier: customers[0].name as string,
            id: customers[0].id as string,
          };
          console.log('Found single customer:', customers[0].name);
        } else if (customers.length > 1) {
          context.pendingSelections = {
            type: 'customer',
            options: customers,
            field: 'customer',
          };

          await this.saveConversation(context);

          return {
            type: 'selection',
            message: this.formatCustomerSelectionMessage(customers),
            data: { options: customers },
          };
        } else {
          const validationResults: ValidationResult =
            context.validationResults || {
              missingFields: [],
              canCreate: false,
              missingRequiredFields: [],
              conditionalRequirements: [],
            };
          validationResults.customerNotFound = true;
          validationResults.customerSearchTerm = customerIdentifier;
          context.validationResults = validationResults;

          await this.saveConversation(context);

          return {
            type: 'missing_info',
            message: `❌ **Customer "${customerIdentifier}" not found**\n\nPlease check the spelling or provide a different customer name/email.\n\n💡 **Tip**: You can create a new customer by saying 'create new customer ${customerIdentifier}'`,
            data: {
              customerNotFound: true,
              customerSearchTerm: customerIdentifier,
            },
          };
        }
      }
    }

    // Date detection
    if (
      missingFields.includes('invoiceDate') ||
      missingFields.includes('dueDate') ||
      missingFields.includes('expenseDate')
    ) {
      const dateMatch = message.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})|today|tomorrow|next week/i);
      if (dateMatch) {
        if (missingFields.includes('invoiceDate')) {
          extractedData.invoiceDate = new Date().toISOString().split('T')[0];
        }
        if (missingFields.includes('dueDate')) {
          extractedData.dueDate = this.parseDate(dateMatch[0]);
        }
        if (missingFields.includes('expenseDate')) {
          extractedData.expenseDate = this.parseDate(dateMatch[0]);
        }
      }
    }

    // Product info
    if (
      missingFields.includes('items') ||
      message.match(/\d+\s+[a-zA-Z]/) ||
      lowerMessage.includes(' with ')
    ) {
      try {
        const productInfo = await this.extractProductInfo(message);
        if (productInfo && productInfo.items && productInfo.items.length > 0) {
          extractedData.items = [...(extractedData.items || []), ...productInfo.items];
        }
      } catch (error) {
        console.error('Error extracting product info:', error);
      }
    }

    // Amount
    if (missingFields.includes('amount')) {
      const amountMatch = message.match(
        /(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d+)?)|\b(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rs\.?|inr|₹)/i,
      );
      if (amountMatch) {
        const amount = amountMatch[1] || amountMatch[2];
        extractedData.amount = parseFloat(amount.replace(/,/g, ''));
      }
    }

    // Source type
    if (missingFields.includes('sourceType')) {
      if (lowerMessage.includes('bank')) {
        extractedData.sourceType = 'BANK';
      } else if (lowerMessage.includes('petty') || lowerMessage.includes('cash')) {
        extractedData.sourceType = 'PETTY_CASH';
      }
    }

    // OpenAI fallback extraction
    try {
      const newInfo = await this.extractInfoFromMessage(message, missingFields);
      console.log('New info extracted:', newInfo);

      if (newInfo.customer && !extractedData.customer?.identifier) {
        extractedData.customer = {
          identifier:
            typeof newInfo.customer === 'string'
              ? newInfo.customer
              : (newInfo.customer as { identifier?: string }).identifier,
        };
      }

      if (newInfo.items && Array.isArray(newInfo.items) && newInfo.items.length > 0) {
        extractedData.items = [...(extractedData.items || []), ...newInfo.items];
      }
      if (newInfo.dueDate) extractedData.dueDate = newInfo.dueDate as string;
      if (newInfo.invoiceDate) extractedData.invoiceDate = newInfo.invoiceDate as string;
      if (newInfo.amount) extractedData.amount = newInfo.amount as number;
      if (newInfo.sourceType) extractedData.sourceType = newInfo.sourceType as 'BANK' | 'PETTY_CASH';
      if (newInfo.paymentMode) extractedData.paymentMode = newInfo.paymentMode as string;
      if (newInfo.isRecurring !== undefined) {
        extractedData.isRecurring = newInfo.isRecurring as boolean;
      }
    } catch (error) {
      console.error('Error extracting info with OpenAI:', error);
    }

    context.extractedData = extractedData;

    const conv = this.requireConversation();
    let newValidationResult: ValidationResult;
    switch (conv.documentType) {
      case 'invoice':
        newValidationResult = await this.validateInvoiceData(extractedData);
        break;
      case 'quotation':
        newValidationResult = await this.validateQuotationData(extractedData);
        break;
      case 'expense':
        newValidationResult = await this.validateExpenseData(extractedData);
        break;
      default:
        newValidationResult = await this.validateInvoiceData(extractedData);
    }

    console.log('New validation results:', JSON.stringify(newValidationResult, null, 2));

    context.validationResults = newValidationResult;

    if (newValidationResult.needsProductSelection) {
      context.pendingSelections = {
        type: 'product',
        options: newValidationResult.productOptions || [],
        field: newValidationResult.pendingProductField || null,
      };

      await this.saveConversation(context);

      return {
        type: 'selection',
        message: this.formatProductSelectionMessage(newValidationResult.productOptions || []),
        data: { options: newValidationResult.productOptions },
      };
    }

    if (newValidationResult.canCreate) {
      context.step = 'confirming';
      const preview = await this.previewDocument(newValidationResult, conv.documentType);

      await this.saveConversation(context);

      return {
        type: 'confirmation',
        message: this.formatConfirmationMessage(preview, conv.documentType),
        data: {
          preview,
          extractedData,
          validationResult: newValidationResult,
        },
      };
    } else {
      context.missingFields = newValidationResult.missingFields || [];

      await this.saveConversation(context);

      return {
        type: 'missing_info',
        message: this.formatMissingInfoMessage(newValidationResult, conv.documentType),
        data: {
          missingFields: newValidationResult.missingFields,
          customerNotFound: newValidationResult.customerNotFound,
          customerSearchTerm: newValidationResult.customerSearchTerm,
          missingRequiredFields: newValidationResult.missingRequiredFields,
          conditionalRequirements: newValidationResult.conditionalRequirements,
          invalidItems: newValidationResult.invalidItems,
        },
      };
    }
  }

  async handleConfirmation(message: string, context: ConversationContext): Promise<ProcessResponse> {
    const confirmation = message.toLowerCase();
    const conv = this.requireConversation();

    if (
      confirmation.includes('yes') ||
      confirmation.includes('create') ||
      confirmation.includes('confirm')
    ) {
      try {
        const validationResults = context.validationResults;
        if (!validationResults) {
          return { type: 'error', message: 'No validation data available.' };
        }
        let document: Record<string, unknown> & { id: string };

        switch (conv.documentType) {
          case 'invoice':
            document = await this.createInvoice(validationResults, context);
            break;
          case 'quotation':
            document = await this.createQuotation(validationResults, context);
            break;
          case 'expense':
            document = await this.createExpense(validationResults);
            break;
          default:
            return { type: 'error', message: 'Unknown document type.' };
        }

        // Mark conversation completed
        this.conversation = await prisma.conversation.update({
          where: { id: conv.id },
          data: { status: 'completed' },
        });

        const docTypeKey =
          conv.documentType === 'invoice'
            ? 'invoiceNumber'
            : conv.documentType === 'quotation'
              ? 'quotationId'
              : 'expenseId';

        return {
          type: 'success',
          message: `✅ ${conv.documentType} ${document[docTypeKey] as string} has been created successfully!`,
          data: { document },
        };
      } catch (error) {
        console.error('Error creating document:', error);
        const msg = error instanceof Error ? error.message : String(error);
        return {
          type: 'error',
          message: `Failed to create ${conv.documentType}: ${msg}`,
        };
      }
    } else if (confirmation.includes('no') || confirmation.includes('cancel')) {
      return this.resetConversation();
    } else if (confirmation.includes('edit')) {
      context.step = 'collecting_missing_fields';
      return {
        type: 'missing_info',
        message: 'What would you like to change? Please provide the corrected information.',
        data: { missingFields: context.missingFields },
      };
    } else {
      return {
        type: 'confirmation',
        message: "Please confirm with 'yes' to create, 'no' to cancel, or 'edit' to make changes.",
      };
    }
  }

  async handleEditCommand(message: string, context: ConversationContext): Promise<ProcessResponse> {
    const { field, value } = await this.extractEditInfo(message);

    if (field && value !== undefined && value !== null) {
      const updated = await this.updateDocument(
        context.editMode.documentId || '',
        context.editMode.documentType || 'invoice',
        field,
        value,
      );

      if (updated) {
        context.editMode.active = false;
        return {
          type: 'success',
          message: `✅ ${field} has been updated successfully!`,
          data: { document: updated as unknown as Record<string, unknown> },
        };
      }
    }

    return {
      type: 'error',
      message: "I couldn't understand what you want to edit. Please specify the field and new value.",
    };
  }

  async handleDeleteConfirm(message: string, context: ConversationContext): Promise<ProcessResponse> {
    const confirmation = message.toLowerCase();

    if (confirmation.includes('yes') || confirmation.includes('delete')) {
      const deleted = await this.softDeleteDocument(
        context.editMode.documentId || '',
        context.editMode.documentType || 'invoice',
      );

      if (deleted) {
        const conv = this.requireConversation();
        this.conversation = await prisma.conversation.update({
          where: { id: conv.id },
          data: { status: 'completed' },
        });
        return {
          type: 'success',
          message: `✅ ${context.editMode.documentType} has been deleted successfully.`,
        };
      }
    }

    context.editMode.active = false;
    return {
      type: 'info',
      message: 'Delete operation cancelled.',
    };
  }

  async previewDocument(
    validationResults: ValidationResult,
    documentType: ConversationDocumentType | null,
  ): Promise<DocumentPreview> {
    switch (documentType) {
      case 'invoice':
      case 'quotation':
        return this.previewInvoiceOrQuotation(validationResults);
      case 'expense':
        return this.previewExpense(validationResults);
      default:
        return this.previewInvoiceOrQuotation(validationResults);
    }
  }

  async previewInvoiceOrQuotation(validationResults: ValidationResult): Promise<DocumentPreview> {
    let subtotal = 0;

    const items = (validationResults.products || []).map((product) => {
      const rate = Number((product as { selling_price?: number }).selling_price || 0);
      const qty = Number((product as { requestedQuantity?: number }).requestedQuantity || 1);
      const amount = rate * qty;

      subtotal += amount;

      return {
        name: (product as { name?: string }).name || '',
        quantity: qty,
        rate,
        amount,
      };
    });

    return {
      customer: validationResults.customer,
      items,
      subtotal,
      total: subtotal,
      dueDate:
        validationResults.dueDate ||
        new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      invoiceDate: validationResults.invoiceDate || new Date(),
    };
  }

  async previewExpense(validationResults: ValidationResult): Promise<DocumentPreview> {
    return {
      amount: validationResults.amount,
      category: validationResults.expenseCategory,
      paymentMode: validationResults.paymentMode,
      sourceType: validationResults.sourceType,
      description: validationResults.description,
      expenseDate: validationResults.expenseDate || new Date(),
    };
  }

  async createInvoice(
    validationResults: ValidationResult,
    context: ConversationContext,
  ): Promise<Record<string, unknown> & { id: string }> {
    const preview = await this.previewInvoiceOrQuotation(validationResults);
    const customerId = (validationResults.customer as { id?: string } | null)?.id;
    if (!customerId) throw new Error('Customer ID missing');

    const itemsJson = (preview.items || []).map((item) => ({
      id: uuidv4(),
      name: item.name,
      unit: 'pcs',
      qty: item.quantity,
      rate: item.rate,
      discount: 0,
      tax: 0,
      amount: item.amount,
    }));

    const invoice = await prisma.invoice.create({
      data: {
        customerId,
        invoiceDate: new Date(preview.invoiceDate || Date.now()),
        dueDate: new Date(preview.dueDate || Date.now()),
        items: itemsJson as unknown as Prisma.InputJsonValue,
        taxableAmount: new Prisma.Decimal(preview.subtotal || 0),
        TotalAmount: new Prisma.Decimal(preview.total || 0),
        vat: new Prisma.Decimal(0),
        notes: context.extractedData?.notes || '',
        status: 'DRAFT',
        userId: this.userId,
        billFrom: this.userId,
        billTo: customerId,
      },
    });

    return invoice as unknown as Record<string, unknown> & { id: string };
  }

  async createQuotation(
    validationResults: ValidationResult,
    context: ConversationContext,
  ): Promise<Record<string, unknown> & { id: string }> {
    const preview = await this.previewInvoiceOrQuotation(validationResults);
    const customerId = (validationResults.customer as { id?: string } | null)?.id;
    if (!customerId) throw new Error('Customer ID missing');

    const itemsJson = (preview.items || []).map((item) => ({
      id: uuidv4(),
      name: item.name,
      unit: 'pcs',
      qty: item.quantity,
      rate: item.rate,
      discount: 0,
      tax: 0,
      amount: item.amount,
    }));

    const quotation = await prisma.quotation.create({
      data: {
        customerId,
        quotationDate: new Date(preview.invoiceDate || Date.now()),
        expiryDate: new Date(
          validationResults.dueDate || Date.now() + 30 * 24 * 60 * 60 * 1000,
        ),
        items: itemsJson as unknown as Prisma.InputJsonValue,
        taxableAmount: new Prisma.Decimal(preview.subtotal || 0),
        TotalAmount: new Prisma.Decimal(preview.total || 0),
        vat: new Prisma.Decimal(0),
        notes: context.extractedData?.notes || '',
        status: 'draft',
        userId: this.userId,
        billFrom: this.userId,
        billTo: customerId,
      },
    });

    return quotation as unknown as Record<string, unknown> & { id: string };
  }

  async createExpense(
    validationResults: ValidationResult,
  ): Promise<Record<string, unknown> & { id: string }> {
    const categoryId = (validationResults.expenseCategory as { id?: string } | null)?.id;
    if (!categoryId) throw new Error('Expense category ID missing');
    if (!validationResults.sourceType) throw new Error('Source type missing');

    const expense = await prisma.expense.create({
      data: {
        amount: new Prisma.Decimal(validationResults.amount || 0),
        expenseDate: new Date(validationResults.expenseDate || Date.now()),
        paymentStatus: 'PENDING',
        description: validationResults.description || '',
        expenseCategoryId: categoryId,
        sourceType: validationResults.sourceType as 'BANK' | 'PETTY_CASH',
        userId: this.userId,
      },
    });

    return expense as unknown as Record<string, unknown> & { id: string };
  }

  async findCustomers(identifier: string): Promise<Array<Record<string, unknown>>> {
    return prisma.customer.findMany({
      where: {
        userId: this.userId,
        isDeleted: false,
        OR: [
          { email: { contains: identifier, mode: 'insensitive' } },
          { name: { contains: identifier, mode: 'insensitive' } },
        ],
      },
      take: 5,
    }) as unknown as Promise<Array<Record<string, unknown>>>;
  }

  async findProducts(productName: string): Promise<Array<Record<string, unknown>>> {
    return prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: productName, mode: 'insensitive' } },
          { code: { contains: productName, mode: 'insensitive' } },
        ],
        status: true,
      },
      include: { taxGroup: true },
      take: 5,
    }) as unknown as Promise<Array<Record<string, unknown>>>;
  }

  async findExpenseCategories(categoryName: string): Promise<Array<Record<string, unknown>>> {
    return prisma.expenseCategory.findMany({
      where: {
        isDeleted: false,
        status: true,
        title: { contains: categoryName, mode: 'insensitive' },
      },
      take: 5,
    }) as unknown as Promise<Array<Record<string, unknown>>>;
  }

  async extractInfoFromMessage(
    message: string,
    missingFields: string[],
  ): Promise<Record<string, unknown>> {
    const systemPrompt = `
        Extract information from the user's message for missing fields: ${JSON.stringify(missingFields)}

        Return a JSON object with only the fields that are provided.
        For dates, use YYYY-MM-DD format.
        For amounts, use numbers.

        Possible fields:
        - customer: string or object with identifier
        - items: array of {name, quantity}
        - dueDate: string (YYYY-MM-DD)
        - invoiceDate: string (YYYY-MM-DD)
        - amount: number
        - sourceType: "BANK" or "PETTY_CASH"
        - paymentMode: string
        - isRecurring: boolean
        `;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_DEPLOYMENT_NAME || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0].message.content) as Record<string, unknown>;
  }

  async extractProductInfo(message: string): Promise<{ items: ExtractedItem[] }> {
    const systemPrompt = `
        Extract product information from the user's message.
        Return a JSON object with items array containing name and quantity.

        Example: "2 PS5 and 1 Monitor" -> {"items": [{"name": "PS5", "quantity": 2}, {"name": "Monitor", "quantity": 1}]}
        Example: "with 3 Samsung TVs" -> {"items": [{"name": "Samsung TV", "quantity": 3}]}
        Example: "add 5 keyboards" -> {"items": [{"name": "keyboards", "quantity": 5}]}

        If no products are mentioned, return {"items": []}
        `;

    try {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_DEPLOYMENT_NAME || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      return JSON.parse(response.choices[0].message.content) as { items: ExtractedItem[] };
    } catch (error) {
      console.error('Error extracting product info:', error);
      return { items: [] };
    }
  }

  async extractEditInfo(
    message: string,
  ): Promise<{ field: string | null; value: string | number | null }> {
    const systemPrompt = `
        Extract edit information from the user's message.
        Return a JSON object with field and value.

        Example: "change customer to John" -> {"field": "customer", "value": "John"}
        Example: "update amount to 5000" -> {"field": "amount", "value": 5000}
        Example: "change due date to 2026-04-01" -> {"field": "dueDate", "value": "2026-04-01"}
        `;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_DEPLOYMENT_NAME || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0].message.content) as {
      field: string | null;
      value: string | number | null;
    };
  }

  async updateDocument(
    documentId: string,
    documentType: 'invoice' | 'quotation' | 'expense',
    field: string,
    value: string | number,
  ): Promise<Record<string, unknown> | null> {
    if (!documentId) return null;

    // Build a generic update payload mirroring the original JS branch logic.
    const invoiceUpdate: Prisma.InvoiceUpdateInput = {};
    const quotationUpdate: Prisma.QuotationUpdateInput = {};
    const expenseUpdate: Prisma.ExpenseUpdateInput = {};

    switch (field) {
      case 'customer': {
        const customer = await prisma.customer.findFirst({
          where: { name: { contains: String(value), mode: 'insensitive' }, userId: this.userId },
        });
        if (customer) {
          if (documentType === 'invoice') {
            invoiceUpdate.customer = { connect: { id: customer.id } };
            invoiceUpdate.billToCustomer = { connect: { id: customer.id } };
          } else if (documentType === 'quotation') {
            quotationUpdate.customer = { connect: { id: customer.id } };
            quotationUpdate.billToCustomer = { connect: { id: customer.id } };
          }
        }
        break;
      }
      case 'amount': {
        const amount = new Prisma.Decimal(parseFloat(String(value)) || 0);
        if (documentType === 'invoice') {
          invoiceUpdate.TotalAmount = amount;
          invoiceUpdate.taxableAmount = amount;
        } else if (documentType === 'quotation') {
          quotationUpdate.TotalAmount = amount;
          quotationUpdate.taxableAmount = amount;
        } else if (documentType === 'expense') {
          expenseUpdate.amount = amount;
        }
        break;
      }
      case 'dueDate':
        if (documentType === 'invoice') invoiceUpdate.dueDate = new Date(String(value));
        break;
      case 'invoiceDate':
        if (documentType === 'invoice') invoiceUpdate.invoiceDate = new Date(String(value));
        break;
      case 'quotationDate':
        if (documentType === 'quotation') quotationUpdate.quotationDate = new Date(String(value));
        break;
      case 'description':
      case 'notes':
        if (documentType === 'invoice') invoiceUpdate.notes = String(value);
        else if (documentType === 'quotation') quotationUpdate.notes = String(value);
        else if (documentType === 'expense') expenseUpdate.description = String(value);
        break;
      case 'sourceType':
        if (documentType === 'expense') {
          expenseUpdate.sourceType = String(value) as 'BANK' | 'PETTY_CASH';
        }
        break;
      case 'paymentMode':
        if (documentType === 'expense') {
          expenseUpdate.paymentMode = { connect: { id: String(value) } };
        }
        break;
    }

    if (documentType === 'invoice') {
      if (Object.keys(invoiceUpdate).length === 0) return null;
      return prisma.invoice.update({ where: { id: documentId }, data: invoiceUpdate }) as unknown as Promise<Record<string, unknown>>;
    }
    if (documentType === 'quotation') {
      if (Object.keys(quotationUpdate).length === 0) return null;
      return prisma.quotation.update({ where: { id: documentId }, data: quotationUpdate }) as unknown as Promise<Record<string, unknown>>;
    }
    if (documentType === 'expense') {
      if (Object.keys(expenseUpdate).length === 0) return null;
      return prisma.expense.update({ where: { id: documentId }, data: expenseUpdate }) as unknown as Promise<Record<string, unknown>>;
    }
    return null;
  }

  async softDeleteDocument(
    documentId: string,
    documentType: 'invoice' | 'quotation' | 'expense',
  ): Promise<Record<string, unknown> | null> {
    if (!documentId) return null;
    if (documentType === 'invoice') {
      return prisma.invoice.update({
        where: { id: documentId },
        data: { isDeleted: true },
      }) as unknown as Promise<Record<string, unknown>>;
    }
    if (documentType === 'quotation') {
      return prisma.quotation.update({
        where: { id: documentId },
        data: { isDeleted: true },
      }) as unknown as Promise<Record<string, unknown>>;
    }
    if (documentType === 'expense') {
      return prisma.expense.update({
        where: { id: documentId },
        data: { isDeleted: true },
      }) as unknown as Promise<Record<string, unknown>>;
    }
    return null;
  }

  formatCustomerSelectionMessage(customers: Array<Record<string, unknown>>): string {
    let message = 'I found multiple customers with that name. Please select one:\n\n';
    customers.forEach((customer, index) => {
      message += `${index + 1}. ${(customer as { name?: string }).name} (${(customer as { email?: string }).email})\n`;
    });
    return message;
  }

  formatProductSelectionMessage(products: Array<Record<string, unknown>>): string {
    let message = 'I found multiple products. Please select one:\n\n';
    products.forEach((product, index) => {
      const p = product as { name?: string; selling_price?: number };
      message += `${index + 1}. ${p.name} - ₹${p.selling_price}\n`;
    });
    return message;
  }

  formatMissingInfoMessage(
    validationResult: ValidationResult,
    documentType: ConversationDocumentType | string | null,
  ): string {
    let message = `I need more information to create this ${documentType}:\n\n`;

    if (validationResult.customerNotFound) {
      message += `❌ **Customer "${validationResult.customerSearchTerm}" not found**\n`;
      message += '   Please check the spelling or provide a different customer name/email.\n\n';
    }

    if (
      validationResult.missingRequiredFields &&
      validationResult.missingRequiredFields.length > 0
    ) {
      message += '**Required Information:**\n';
      validationResult.missingRequiredFields.forEach((field) => {
        if (field.startsWith('product:')) {
          const productName = field.replace('product:', '');
          message += `   • Product "${productName}" not found in database\n`;
        } else if (field === 'invalid_items') {
          // Handled separately
        } else {
          message += `   • ${this.formatFieldName(field)}\n`;
        }
      });
      message += '\n';
    }

    if (
      validationResult.conditionalRequirements &&
      validationResult.conditionalRequirements.length > 0
    ) {
      message += '**Additional Required Information (based on your selections):**\n';
      validationResult.conditionalRequirements.forEach((field) => {
        message += `   • ${this.formatFieldName(field)}\n`;
      });
      message += '\n';
    }

    if (validationResult.invalidItems && validationResult.invalidItems.length > 0) {
      message += '**Items with missing information:**\n';
      validationResult.invalidItems.forEach((item) => {
        message += `   • ${item.item} is missing: ${item.missing.join(', ')}\n`;
      });
      message += '\n';
    }

    validationResult.missingFields.forEach((field) => {
      if (
        !field.startsWith('product:') &&
        !validationResult.missingRequiredFields?.includes(field) &&
        !validationResult.conditionalRequirements?.includes(field) &&
        field !== 'customer' &&
        field !== 'items'
      ) {
        message += `   • ${this.formatFieldName(field)}\n`;
      }
    });

    if (validationResult.customerNotFound) {
      message += "\n💡 **Tip**: You can create a new customer by saying 'create new customer [name]'\n";
    }

    if (validationResult.missingRequiredFields?.includes('items')) {
      message += "\n💡 **Tip**: You can add items by saying 'add 2 [product name]' or 'with 3 [product]'\n";
    }

    if (validationResult.missingRequiredFields?.includes('invoiceDate')) {
      message += "\n💡 **Tip**: You can set the invoice date by saying 'date is today' or 'date is 2026-03-20'\n";
    }

    if (validationResult.missingRequiredFields?.includes('dueDate')) {
      message += "\n💡 **Tip**: You can set the due date by saying 'due in 15 days' or 'due on 2026-04-01'\n";
    }

    return message;
  }

  formatConfirmationMessage(
    preview: DocumentPreview,
    documentType: ConversationDocumentType | string | null,
  ): string {
    if (documentType === 'expense') {
      return (
        `📋 **Expense Preview**\n\n` +
        `Amount: ₹${preview.amount}\n` +
        `Date: ${new Date(preview.expenseDate || Date.now()).toLocaleDateString()}\n` +
        `Category: ${(preview.category as { name?: string } | null | undefined)?.name || 'N/A'}\n` +
        `Payment Mode: ${preview.paymentMode}\n` +
        `Source: ${preview.sourceType}\n\n` +
        `Should I create this expense? (yes/no/edit)`
      );
    } else {
      const dt = String(documentType || 'invoice');
      return (
        `📋 **${dt.charAt(0).toUpperCase() + dt.slice(1)} Preview**\n\n` +
        `Customer: ${(preview.customer as { name?: string } | null | undefined)?.name}\n` +
        `Date: ${new Date(preview.invoiceDate || Date.now()).toLocaleDateString()}\n` +
        `Items:\n${(preview.items || [])
          .map((i) => `  • ${i.name} x${i.quantity} - ₹${i.amount}`)
          .join('\n')}\n\n` +
        `Subtotal: ₹${preview.subtotal}\n` +
        `**Total: ₹${preview.total}**\n` +
        `Due Date: ${new Date(preview.dueDate || Date.now()).toLocaleDateString()}\n\n` +
        `Should I create this ${dt}? (yes/no/edit)`
      );
    }
  }

  formatFieldName(field: string): string {
    const fieldMap: Record<string, string> = {
      customerId: '👤 Customer selection',
      customer: '👤 Customer name or email',
      billTo: '👤 Billing customer',
      billFrom: '👤 Bill from (your company)',

      items: '📦 Products or services',
      itemFields: '📦 Complete item details',
      qty: '🔢 Item quantity',
      rate: '💰 Item rate/price',

      invoiceDate: '📅 Invoice date',
      dueDate: '📅 Due date',
      expiryDate: '📅 Expiry date',
      quotationDate: '📅 Quotation date',
      expenseDate: '📅 Expense date',
      startOn: '📅 Start date',
      endsOn: '📅 End date',

      amount: '💰 Amount',
      taxableAmount: '💰 Taxable amount',
      TotalAmount: '💰 Total amount',
      vat: '💰 VAT/GST amount',
      discount: '💰 Discount',
      totalDiscount: '💰 Total discount',

      expenseCategory: '📂 Expense category',
      expenseCategoryId: '📂 Expense category',
      paymentMode: '💳 Payment mode',
      paymentStatus: '💳 Payment status',
      sourceType: '🏦 Source type (BANK/PETTY_CASH)',
      bankId: '🏦 Bank account',

      isRecurring: '🔄 Recurring invoice',
      repeatEvery: '🔄 Recurring frequency',
      neverExpire: '🔄 Never expire',

      referenceNo: '📄 Reference number',
      notes: '📝 Notes',
      termsAndCondition: '📜 Terms and conditions',
      description: '📝 Description',
      payment_method: '💳 Payment method',

      bankDetails: '🏦 Bank details',
      bank: '🏦 Bank information',

      userId: '👤 User',
      status: '📊 Status',
      roundOff: '🔄 Round off',
    };

    return fieldMap[field] || field.replace(/([A-Z])/g, ' $1').trim();
  }

  parseDate(dateStr: string): string | null {
    if (!dateStr) return null;
    dateStr = dateStr.toLowerCase();

    if (dateStr === 'today') {
      return new Date().toISOString().split('T')[0];
    } else if (dateStr === 'tomorrow') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    } else if (dateStr === 'next week') {
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      return nextWeek.toISOString().split('T')[0];
    } else {
      const parts = dateStr.split(/[\/-]/);
      if (parts.length === 3) {
        let year: string;
        let month: string;
        let day: string;

        if (parts[0].length === 4) {
          year = parts[0];
          month = parts[1].padStart(2, '0');
          day = parts[2].padStart(2, '0');
        } else {
          day = parts[0].padStart(2, '0');
          month = parts[1].padStart(2, '0');
          year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        }

        return `${year}-${month}-${day}`;
      }
    }

    return null;
  }

  async getConversationHistory(): Promise<ConversationHistoryEntry[]> {
    await this.initializeConversation();
    return this.getContext().conversationHistory;
  }

  async resetConversation(): Promise<ProcessResponse> {
    if (this.conversation) {
      await prisma.conversation.update({
        where: { id: this.conversation.id },
        data: { status: 'expired' },
      });
    }
    this.conversation = null;
    this.sessionId = uuidv4();
    await this.initializeConversation();
    return {
      type: 'reset',
      message: 'Conversation reset. How can I help you?',
      sessionId: this.sessionId,
    };
  }

  async handleCustomerCreation(
    message: string,
    context: ConversationContext,
  ): Promise<ProcessResponse> {
    try {
      const systemPrompt = `
        Extract customer information from the user's message.
        Return a JSON object with name, email, and phone if available.

        Example: "Create new customer John Doe, email john@email.com, phone 1234567890"
        -> {"name": "John Doe", "email": "john@email.com", "phone": "1234567890"}
        `;

      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_DEPLOYMENT_NAME || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const customerData = JSON.parse(response.choices[0].message.content) as {
        name: string;
        email?: string;
        phone?: string;
      };

      const newCustomer = await prisma.customer.create({
        data: {
          name: customerData.name,
          email:
            customerData.email ||
            `${customerData.name.replace(/\s+/g, '.').toLowerCase()}@temp.com`,
          phone: customerData.phone || '',
          userId: this.userId,
          status: 'Active',
        },
      });

      if (!context.validationResults) {
        context.validationResults = {
          missingFields: [],
          canCreate: false,
          missingRequiredFields: [],
          conditionalRequirements: [],
        };
      }
      context.validationResults.customer = newCustomer as unknown as Record<string, unknown>;

      if (!context.extractedData) context.extractedData = {};
      if (!context.extractedData.customer) context.extractedData.customer = {};
      context.extractedData.customer.identifier = newCustomer.name;
      context.extractedData.customer.id = newCustomer.id;

      const validationResults = context.validationResults;
      const conv = this.requireConversation();

      if (validationResults.canCreate) {
        context.step = 'confirming';
        const preview = await this.previewDocument(validationResults, conv.documentType);
        return {
          type: 'confirmation',
          message: this.formatConfirmationMessage(preview, conv.documentType),
          data: { preview, validationResults },
        };
      } else {
        context.step = 'collecting_missing_fields';
        return {
          type: 'missing_info',
          message: this.formatMissingInfoMessage(validationResults, conv.documentType),
          data: {
            missingFields: validationResults.missingFields,
            missingRequiredFields: validationResults.missingRequiredFields,
          },
        };
      }
    } catch (error) {
      console.error('Error creating customer:', error);
      return {
        type: 'error',
        message: 'Failed to create customer. Please provide name, email, and phone.',
      };
    }
  }

  async handleEdit(_message: string): Promise<ProcessResponse> {
    return {
      type: 'info',
      message: 'Edit mode activated. What would you like to change?',
    };
  }
}

export default ConversationalAIController;

// CommonJS interop for legacy JS routes
module.exports = ConversationalAIController;
module.exports.default = ConversationalAIController;
