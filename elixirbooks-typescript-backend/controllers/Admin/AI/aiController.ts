import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type {
  AIDocumentType,
  AIPromptLogStatus,
  AIPromptLogCreatedDocumentType,
  AIPromptTemplateDocumentType,
} from '@prisma/client';

import { prisma } from '../../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../../lib/tenantScope';
import { resolveDisplayName } from '../../../lib/contacts/contactIdentity';

// Legacy JS services — still JS, require via CommonJS shim.
/* eslint-disable @typescript-eslint/no-require-imports */
const { processPrompt } = require('../../../services/ai/promptProcessor') as {
  processPrompt: (
    prompt: string,
    context: unknown,
  ) => Promise<{
    success: boolean;
    result?: {
      documentType: AIDocumentType;
      data: Record<string, unknown>;
      confidence?: number;
      summary?: string;
    };
    processingTimeMs?: number;
    tokensUsed?: { inputTokens?: number; outputTokens?: number };
  }>;
};
const {
  loadContext,
  resolveEntities,
} = require('../../../services/ai/entityResolver') as {
  loadContext: (userId: string) => Promise<unknown>;
  resolveEntities: (
    data: Record<string, unknown>,
    documentType: AIDocumentType,
    context: unknown,
  ) => {
    resolved: Record<string, unknown> & { items?: unknown[] };
    matchDetails: unknown;
    ambiguities: AmbiguitySet;
  };
};
const { formatForController } = require('../../../services/ai/responseFormatter') as {
  formatForController: (
    documentType: AIDocumentType,
    resolved: Record<string, unknown>,
    extras: { userId: string },
  ) => Record<string, unknown>;
};
const { checkDuplicates: checkDuplicatesService } = require('../../../services/ai/duplicateDetector') as {
  checkDuplicates: (
    documentType: string,
    payload: Record<string, unknown>,
    userId: string,
  ) => Promise<{ hasDuplicates: boolean; duplicates: unknown[] } & Record<string, unknown>>;
};
const { processChatMessage } = require('../../../services/ai/chatService') as {
  processChatMessage: (
    history: Array<{ role: string; content: string }>,
    message: string,
    context: unknown,
  ) => Promise<{
    message: string;
    extractedData?: Record<string, unknown>;
    documentType?: AIDocumentType;
    isComplete?: boolean;
    missingFields?: string[];
    confidence?: number;
    summary?: string;
  }>;
};
const {
  getFinancialData,
  generateInsightNarrative,
} = require('../../../services/ai/insightsService') as {
  getFinancialData: (userId: string) => Promise<Record<string, unknown>>;
  generateInsightNarrative: (data: Record<string, unknown>) => Promise<string | null>;
};
const {
  getOverdueInvoices: getOverdueInvoicesService,
  generateFollowupEmail,
} = require('../../../services/ai/paymentFollowup') as {
  getOverdueInvoices: (userId: string) => Promise<unknown[]>;
  generateFollowupEmail: (
    invoiceData: Record<string, unknown>,
    companyName: string,
    tone: string,
  ) => Promise<{ subject?: string; body?: string } & Record<string, unknown>>;
};
const mailerModule = require('../../../utils/mailer') as {
  sendMail: (opts: Record<string, unknown>) => Promise<void>;
};
const sendMail = mailerModule.sendMail;
/* eslint-enable @typescript-eslint/no-require-imports */

type Tx = Prisma.TransactionClient;

interface AmbiguityMatch {
  name?: string;
  price?: number | string;
  accountNumber?: string;
}

interface AmbiguityField {
  searchTerm?: string;
  matches: AmbiguityMatch[];
  optional?: boolean;
}

interface AmbiguitySet {
  customer?: AmbiguityField;
  vendor?: AmbiguityField;
  products?: AmbiguityField[];
  expenseCategory?: AmbiguityField;
  bank?: AmbiguityField;
  paymentMode?: AmbiguityField;
}

interface IncomingItem {
  id?: string;
  productId?: string;
  qty?: number;
}

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function enabledModuleFor(
  cfg: { enabledModulesInvoice: boolean; enabledModulesPurchaseOrder: boolean; enabledModulesQuotation: boolean; enabledModulesExpense: boolean },
  docType: AIDocumentType,
): boolean {
  switch (docType) {
    case 'invoice':
      return cfg.enabledModulesInvoice;
    case 'purchase_order':
      return cfg.enabledModulesPurchaseOrder;
    case 'quotation':
      return cfg.enabledModulesQuotation;
    case 'expense':
      return cfg.enabledModulesExpense;
    default:
      return false;
  }
}

async function getOrCreateConfig(userId: string) {
  let config = await prisma.aIConfiguration.findUnique({ where: { userId } });
  if (!config) {
    config = await prisma.aIConfiguration.create({ data: { userId } });
  }
  return config;
}

/**
 * Process an AI prompt and return structured preview data
 * POST /api/admin/ai/process
 */
export async function processAIPrompt(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { prompt } = req.body as { prompt?: string };

    if (!prompt || prompt.trim().length === 0) {
      res.status(400).json({ success: false, message: 'Prompt is required' });
      return;
    }

    // Check AI configuration and rate limits
    const aiConfig = await getOrCreateConfig(userId);

    if (!aiConfig.aiEnabled) {
      res.status(403).json({
        success: false,
        message: 'AI features are disabled. Enable them in AI Settings.',
      });
      return;
    }

    // Check daily rate limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyCount = await prisma.aIPromptLog.count({
      where: { userId, createdAt: { gte: today } },
    });

    if (dailyCount >= aiConfig.maxPromptsPerDay) {
      res.status(429).json({
        success: false,
        message: `Daily AI prompt limit reached (${aiConfig.maxPromptsPerDay}). Try again tomorrow.`,
      });
      return;
    }

    // Load context data for entity resolution
    const context = await loadContext(userId);

    // Process prompt with AI
    const aiResult = await processPrompt(prompt, context);

    if (!aiResult.success || !aiResult.result) {
      const log = await prisma.aIPromptLog.create({
        data: {
          prompt,
          documentType: 'invoice',
          status: 'failed',
          errorMessage: 'AI processing failed',
          userId,
          processingTimeMs: aiResult.processingTimeMs || 0,
          inputTokens: aiResult.tokensUsed?.inputTokens || 0,
          outputTokens: aiResult.tokensUsed?.outputTokens || 0,
        },
      });

      res.status(422).json({
        success: false,
        message: 'Could not process the prompt. Please try rephrasing.',
        promptId: log.promptId,
      });
      return;
    }

    const { documentType, data, confidence, summary } = aiResult.result;

    // Check if module is enabled
    if (!enabledModuleFor(aiConfig, documentType)) {
      res.status(403).json({
        success: false,
        message: `AI ${documentType} generation is disabled in settings.`,
      });
      return;
    }

    // Resolve entities against database
    const { resolved, matchDetails, ambiguities } = resolveEntities(data, documentType, context);

    const hasAmbiguities =
      ambiguities.customer ||
      (ambiguities.vendor && !ambiguities.vendor.optional) ||
      (ambiguities.products && ambiguities.products.length > 0) ||
      ambiguities.expenseCategory ||
      ambiguities.bank ||
      ambiguities.paymentMode;

    if (hasAmbiguities) {
      const clarifications: string[] = [];

      if (ambiguities.customer) {
        if (ambiguities.customer.matches.length > 1) {
          clarifications.push(
            `Multiple customers match "${ambiguities.customer.searchTerm}":\n` +
              ambiguities.customer.matches.map((m) => `• ${m.name}`).join('\n') +
              `\nWhich one did you mean?`,
          );
        } else {
          clarifications.push(
            `Customer "${ambiguities.customer.searchTerm}" was not found. Please check the name and try again.`,
          );
        }
      }

      if (documentType !== ('expense' as AIDocumentType)) {
        if (ambiguities.vendor) {
          if (ambiguities.vendor.matches.length > 1) {
            clarifications.push(
              `Multiple vendors match "${ambiguities.vendor.searchTerm}":\n` +
                ambiguities.vendor.matches.map((m) => `• ${m.name}`).join('\n') +
                `\nWhich one did you mean?`,
            );
          } else if (
            ambiguities.vendor.matches.length === 0 &&
            !ambiguities.vendor.optional
          ) {
            clarifications.push(
              `Vendor "${ambiguities.vendor.searchTerm}" was not found. Please check the name and try again.`,
            );
          }
        }
      }

      for (const productAmbiguity of ambiguities.products || []) {
        if (productAmbiguity.matches.length > 1) {
          clarifications.push(
            `Multiple products match "${productAmbiguity.searchTerm}":\n` +
              productAmbiguity.matches.map((m) => `• ${m.name} — ₹${m.price}`).join('\n') +
              `\nWhich one did you mean?`,
          );
        } else {
          clarifications.push(
            `Product "${productAmbiguity.searchTerm}" was not found. Please check the name and try again.`,
          );
        }
      }

      if (ambiguities.expenseCategory) {
        if (ambiguities.expenseCategory.matches.length > 1) {
          clarifications.push(
            `Multiple expense categories match "${ambiguities.expenseCategory.searchTerm}":\n` +
              ambiguities.expenseCategory.matches.map((m) => `• ${m.name}`).join('\n') +
              `\nWhich one did you mean?`,
          );
        } else {
          clarifications.push(
            `Expense category "${ambiguities.expenseCategory.searchTerm}" was not found. Please check the category name and try again.`,
          );
        }
      }

      if (ambiguities.bank) {
        if (ambiguities.bank.matches.length > 1) {
          clarifications.push(
            `Multiple bank accounts found${ambiguities.bank.searchTerm ? ` matching "${ambiguities.bank.searchTerm}"` : ''}:\n` +
              ambiguities.bank.matches
                .map((b) => `• ${b.name} (...${b.accountNumber?.slice(-4)})`)
                .join('\n') +
              `\nWhich bank account should this expense be charged to?`,
          );
        } else if (
          ambiguities.bank.matches.length === 0 &&
          ambiguities.bank.searchTerm
        ) {
          clarifications.push(
            `Bank "${ambiguities.bank.searchTerm}" was not found. Please check the bank name and try again.`,
          );
        } else {
          clarifications.push(
            `Multiple bank accounts available:\n` +
              ambiguities.bank.matches
                .map((b) => `• ${b.name} (...${b.accountNumber?.slice(-4)})`)
                .join('\n') +
              `\nWhich bank account should this expense be charged to?`,
          );
        }
      }

      if (ambiguities.paymentMode) {
        if (ambiguities.paymentMode.matches.length > 1) {
          clarifications.push(
            `Multiple payment modes available:\n` +
              ambiguities.paymentMode.matches.map((m) => `• ${m.name}`).join('\n') +
              `\nWhich payment mode was used?`,
          );
        } else if (
          ambiguities.paymentMode.matches.length === 0 &&
          ambiguities.paymentMode.searchTerm
        ) {
          clarifications.push(
            `Payment mode "${ambiguities.paymentMode.searchTerm}" was not found. Please check and try again.`,
          );
        }
      }

      res.status(200).json({
        success: true,
        data: {
          message: clarifications.join('\n\n'),
          isComplete: false,
          missingFields: [
            ambiguities.customer ? 'customer' : null,
            ambiguities.vendor ? 'vendor' : null,
            ...(ambiguities.products?.map(() => 'product') || []),
            ambiguities.expenseCategory ? 'expenseCategory' : null,
            ambiguities.bank ? 'petty_cash' : null,
            ambiguities.paymentMode ? 'paymentMode' : null,
          ].filter(Boolean),
          documentType,
          preview: null,
          matchDetails: null,
        },
      });
      return;
    }

    // Format for the target controller
    const formattedPayload = formatForController(documentType, resolved, { userId });

    if (
      (['purchase_order', 'invoice', 'quotation'] as AIDocumentType[]).includes(documentType) &&
      (!resolved.items || (resolved.items as unknown[]).length === 0)
    ) {
      await prisma.aIPromptLog.create({
        data: {
          prompt,
          documentType,
          status: 'failed',
          errorMessage: 'No items provided',
          userId,
          processingTimeMs: aiResult.processingTimeMs || 0,
          inputTokens: aiResult.tokensUsed?.inputTokens || 0,
          outputTokens: aiResult.tokensUsed?.outputTokens || 0,
        },
      });

      res.status(200).json({
        success: true,
        data: {
          message: `Please specify at least one product with quantity and rate to create a ${documentType.replace('_', ' ')}.`,
          isComplete: false,
          missingFields: ['items'],
          documentType,
          preview: null,
          matchDetails: null,
        },
      });
      return;
    }

    // Save prompt log
    const promptLog = await prisma.aIPromptLog.create({
      data: {
        prompt,
        documentType,
        extractedData: {
          raw: data,
          resolved,
          matchDetails,
          formatted: formattedPayload,
        } as Prisma.InputJsonValue,
        status: 'processed',
        userId,
        processingTimeMs: aiResult.processingTimeMs || 0,
        inputTokens: aiResult.tokensUsed?.inputTokens || 0,
        outputTokens: aiResult.tokensUsed?.outputTokens || 0,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Prompt processed successfully',
      data: {
        promptId: promptLog.promptId,
        promptLogId: promptLog.id,
        documentType,
        confidence,
        summary,
        preview: formattedPayload,
        extracted: data,
        matchDetails,
        missingFields: [],
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI prompt processing error:', err);
    res.status(500).json({
      success: false,
      message: 'Error processing AI prompt',
      error: errorMessage(err),
    });
  }
}

/**
 * Confirm and create a document from AI-processed data
 * POST /api/admin/ai/confirm
 */
export async function confirmAIDocument(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { promptLogId, documentType, payload } = req.body as {
      promptLogId?: string;
      documentType?: AIDocumentType;
      payload?: Record<string, unknown>;
    };

    if (!promptLogId || !documentType || !payload) {
      res.status(400).json({
        success: false,
        message: 'promptLogId, documentType, and payload are required',
      });
      return;
    }

    // Verify prompt log exists and belongs to user
    const promptLog = await prisma.aIPromptLog.findFirst({
      where: { id: promptLogId, userId, status: 'processed' },
    });

    if (!promptLog) {
      res.status(404).json({
        success: false,
        message: 'Prompt log not found or already confirmed',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx: Tx) => {
      let createdDocument: { id: string; [key: string]: unknown };
      let createdDocumentType: AIPromptLogCreatedDocumentType;
      let documentNumber: string | null = null;

      switch (documentType) {
        case 'invoice': {
          if (!payload.customerId && !payload.billTo) {
            throw new Error(
              'Cannot create invoice: customer not found in database. Please add the customer first.',
            );
          }
          const customerId = (payload.customerId || payload.billTo) as string;
          const billTo = (payload.billTo || payload.customerId) as string;
          const billFrom = (payload.billFrom || userId) as string;

          const invoiceData: Prisma.InvoiceUncheckedCreateInput = {
            ...(payload as unknown as Prisma.InvoiceUncheckedCreateInput),
            customerId,
            billTo,
            billFrom,
            userId,
          };
          const invoice = await tx.invoice.create({ data: invoiceData });

          // Update inventory for invoice items
          const items = Array.isArray(payload.items) ? (payload.items as IncomingItem[]) : [];
          for (const item of items) {
            const productId = item.productId || item.id;
            if (!productId) continue;

            const inventory = await tx.inventory.findFirst({
              where: { productId, isDeleted: false },
            });

            if (inventory) {
              const previousQty = inventory.quantity;
              const reduceBy = item.qty || 0;
              const historyEntry = {
                quantity: previousQty,
                notes: `Stock reduced by AI Invoice #${invoice.invoiceNumber}`,
                type: 'stock_out',
                adjustment: -reduceBy,
                referenceId: invoice.id,
                referenceType: 'invoice',
                createdBy: userId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              const existingHistory = Array.isArray(inventory.inventory_history)
                ? (inventory.inventory_history as unknown[])
                : [];

              await tx.inventory.update({
                where: { id: inventory.id },
                data: {
                  quantity: previousQty - reduceBy,
                  inventory_history: [...existingHistory, historyEntry] as Prisma.InputJsonValue,
                },
              });
            }
          }

          createdDocument = invoice as unknown as { id: string; [k: string]: unknown };
          createdDocumentType = 'Invoice';
          documentNumber = invoice.invoiceNumber || null;
          break;
        }

        case 'purchase_order': {
          if (!payload.vendorId && !payload.billTo) {
            throw new Error(
              'Cannot create purchase order: vendor not found. Please add the vendor first.',
            );
          }
          if (!payload.items || (payload.items as unknown[]).length === 0) {
            throw new Error('Cannot create purchase order: at least one item is required.');
          }
          const billTo = (payload.billTo || payload.vendorId || userId) as string;
          const billFrom = (payload.billFrom || userId) as string;

          const poData: Prisma.PurchaseOrderUncheckedCreateInput = {
            ...(payload as unknown as Prisma.PurchaseOrderUncheckedCreateInput),
            billTo,
            billFrom,
            userId,
          };
          const po = await tx.purchaseOrder.create({ data: poData });
          createdDocument = po as unknown as { id: string; [k: string]: unknown };
          createdDocumentType = 'PurchaseOrder';
          documentNumber = po.purchaseOrderId || null;
          break;
        }

        case 'quotation': {
          const billTo = (payload.billTo || payload.customerId || userId) as string;
          const billFrom = (payload.billFrom || userId) as string;

          const quotationData: Prisma.QuotationUncheckedCreateInput = {
            ...(payload as unknown as Prisma.QuotationUncheckedCreateInput),
            billTo,
            billFrom,
            userId,
          };
          const quotation = await tx.quotation.create({ data: quotationData });
          createdDocument = quotation as unknown as { id: string; [k: string]: unknown };
          createdDocumentType = 'Quotation';
          documentNumber = quotation.quotationId || null;
          break;
        }

        case 'expense': {
          const expenseData: Prisma.ExpenseUncheckedCreateInput = {
            ...(payload as unknown as Prisma.ExpenseUncheckedCreateInput),
            userId,
          };
          const expense = await tx.expense.create({ data: expenseData });
          createdDocument = expense as unknown as { id: string; [k: string]: unknown };
          createdDocumentType = 'Expense';
          documentNumber = expense.expenseId || null;
          break;
        }

        default:
          throw new Error(`Unsupported document type: ${documentType as string}`);
      }

      // Update prompt log
      const existingExtracted = (promptLog.extractedData ?? {}) as Record<string, unknown>;
      await tx.aIPromptLog.update({
        where: { id: promptLog.id },
        data: {
          status: 'confirmed',
          createdDocumentId: createdDocument.id,
          createdDocumentType,
          extractedData: {
            ...existingExtracted,
            finalPayload: payload,
          } as Prisma.InputJsonValue,
        },
      });

      return { createdDocument, createdDocumentType, documentNumber };
    });

    res.status(201).json({
      success: true,
      message: `${result.createdDocumentType} created successfully via AI`,
      data: {
        documentType: result.createdDocumentType,
        documentId: result.createdDocument.id,
        documentNumber: result.documentNumber,
        promptId: promptLog.promptId,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    const msg = errorMessage(err);
    // Mirror the original "user-facing validation" responses that JS code returned
    // before commit. They map to 400 in the legacy controller.
    if (
      msg.startsWith('Cannot create invoice') ||
      msg.startsWith('Cannot create purchase order') ||
      msg.startsWith('Unsupported document type')
    ) {
      res.status(400).json({ success: false, message: msg });
      return;
    }
    console.error('AI confirm error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating document from AI data',
      error: msg,
    });
  }
}

/**
 * Get AI prompt history
 * GET /api/admin/ai/history
 */
export async function getAIHistory(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '20',
      status,
      documentType,
    } = req.query as {
      page?: string;
      limit?: string;
      status?: AIPromptLogStatus;
      documentType?: AIDocumentType;
    };
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.AIPromptLogWhereInput = { userId, isDeleted: false };
    if (status) where.status = status;
    if (documentType) where.documentType = documentType;

    const [total, logs] = await Promise.all([
      prisma.aIPromptLog.count({ where }),
      prisma.aIPromptLog.findMany({
        where,
        select: {
          id: true,
          promptId: true,
          prompt: true,
          documentType: true,
          status: true,
          createdDocumentType: true,
          createdDocumentId: true,
          processingTimeMs: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'AI history fetched successfully',
      data: {
        logs,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI history error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching AI history',
      error: errorMessage(err),
    });
  }
}

/**
 * Get a specific AI prompt log detail
 * GET /api/admin/ai/history/:id
 */
export async function getAIPromptDetail(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const log = await prisma.aIPromptLog.findFirst({ where: { id, userId } });
    if (!log) {
      res.status(404).json({ success: false, message: 'AI prompt log not found' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'AI prompt detail fetched successfully',
      data: log,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI prompt detail error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching AI prompt detail',
      error: errorMessage(err),
    });
  }
}

/**
 * Get AI Configuration
 * GET /api/admin/ai/config
 */
export async function getAIConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const config = await getOrCreateConfig(userId);

    res.status(200).json({
      success: true,
      message: 'AI configuration fetched successfully',
      data: config,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI config error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching AI configuration',
      error: errorMessage(err),
    });
  }
}

/**
 * Update AI Configuration
 * PUT /api/admin/ai/config
 */
export async function updateAIConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const updates = req.body as Record<string, unknown>;

    const filtered: Prisma.AIConfigurationUpdateInput = {};
    if (updates.aiEnabled !== undefined) filtered.aiEnabled = Boolean(updates.aiEnabled);
    if (updates.defaultCurrency !== undefined) filtered.defaultCurrency = String(updates.defaultCurrency);
    if (updates.defaultTaxType !== undefined) {
      filtered.defaultTaxType = updates.defaultTaxType as Prisma.AIConfigurationUpdateInput['defaultTaxType'];
    }
    if (updates.autoApplyTax !== undefined) filtered.autoApplyTax = Boolean(updates.autoApplyTax);
    if (updates.defaultPaymentTermsDays !== undefined) {
      filtered.defaultPaymentTermsDays = Number(updates.defaultPaymentTermsDays);
    }
    if (updates.maxPromptsPerDay !== undefined) {
      filtered.maxPromptsPerDay = Number(updates.maxPromptsPerDay);
    }

    // enabledModules object → split into per-module booleans
    if (updates.enabledModules && typeof updates.enabledModules === 'object') {
      const em = updates.enabledModules as Record<string, unknown>;
      if (em.invoice !== undefined) filtered.enabledModulesInvoice = Boolean(em.invoice);
      if (em.purchase_order !== undefined) filtered.enabledModulesPurchaseOrder = Boolean(em.purchase_order);
      if (em.quotation !== undefined) filtered.enabledModulesQuotation = Boolean(em.quotation);
      if (em.expense !== undefined) filtered.enabledModulesExpense = Boolean(em.expense);
    }

    // upsert: create payload uses the unchecked variant so we can pass userId directly.
    const createPayload: Prisma.AIConfigurationUncheckedCreateInput = { userId };
    if (filtered.aiEnabled !== undefined) createPayload.aiEnabled = filtered.aiEnabled as boolean;
    if (filtered.defaultCurrency !== undefined) createPayload.defaultCurrency = filtered.defaultCurrency as string;
    if (filtered.defaultTaxType !== undefined) createPayload.defaultTaxType = filtered.defaultTaxType as Prisma.AIConfigurationUncheckedCreateInput['defaultTaxType'];
    if (filtered.autoApplyTax !== undefined) createPayload.autoApplyTax = filtered.autoApplyTax as boolean;
    if (filtered.defaultPaymentTermsDays !== undefined) createPayload.defaultPaymentTermsDays = filtered.defaultPaymentTermsDays as number;
    if (filtered.maxPromptsPerDay !== undefined) createPayload.maxPromptsPerDay = filtered.maxPromptsPerDay as number;
    if (filtered.enabledModulesInvoice !== undefined) createPayload.enabledModulesInvoice = filtered.enabledModulesInvoice as boolean;
    if (filtered.enabledModulesPurchaseOrder !== undefined) createPayload.enabledModulesPurchaseOrder = filtered.enabledModulesPurchaseOrder as boolean;
    if (filtered.enabledModulesQuotation !== undefined) createPayload.enabledModulesQuotation = filtered.enabledModulesQuotation as boolean;
    if (filtered.enabledModulesExpense !== undefined) createPayload.enabledModulesExpense = filtered.enabledModulesExpense as boolean;

    const config = await prisma.aIConfiguration.upsert({
      where: { userId },
      create: createPayload,
      update: filtered,
    });

    res.status(200).json({
      success: true,
      message: 'AI configuration updated successfully',
      data: config,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI config update error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating AI configuration',
      error: errorMessage(err),
    });
  }
}

/**
 * Delete an AI prompt log
 * DELETE /api/admin/ai/history/:id
 */
export async function deleteAIPromptLog(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.aIPromptLog.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'AI prompt log not found' });
      return;
    }

    await prisma.aIPromptLog.update({ where: { id }, data: { isDeleted: true } });

    res.status(200).json({
      success: true,
      message: 'AI prompt log deleted successfully',
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI delete error:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting AI prompt log',
      error: errorMessage(err),
    });
  }
}

/**
 * Get AI usage statistics
 * GET /api/admin/ai/stats
 */
export async function getAIStats(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayCount, monthCount, totalCount, byTypeRows, byStatusRows, recentLogs, config] =
      await Promise.all([
        prisma.aIPromptLog.count({ where: { userId, createdAt: { gte: today } } }),
        prisma.aIPromptLog.count({ where: { userId, createdAt: { gte: thisMonth } } }),
        prisma.aIPromptLog.count({ where: { userId } }),
        prisma.aIPromptLog.groupBy({
          by: ['documentType'],
          where: { userId },
          _count: { _all: true },
        }),
        prisma.aIPromptLog.groupBy({
          by: ['status'],
          where: { userId },
          _count: { _all: true },
        }),
        prisma.aIPromptLog.findMany({
          where: { userId, isDeleted: false },
          select: {
            id: true,
            promptId: true,
            prompt: true,
            documentType: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.aIConfiguration.findUnique({ where: { userId } }),
      ]);

    const byDocumentType = byTypeRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.documentType] = row._count._all;
      return acc;
    }, {});
    const byStatus = byStatusRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      message: 'AI stats fetched successfully',
      data: {
        usage: {
          today: todayCount,
          dailyLimit: config?.maxPromptsPerDay || 100,
          thisMonth: monthCount,
          total: totalCount,
        },
        byDocumentType,
        byStatus,
        recentPrompts: recentLogs,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI stats error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching AI stats',
      error: errorMessage(err),
    });
  }
}

// ============================================================
// SMART SUGGESTIONS
// ============================================================

/**
 * Get real-time suggestions for AI prompt typeahead
 * GET /api/admin/ai/suggestions?q=abc&type=all
 */
export async function getSuggestions(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { q = '', type = 'all' } = req.query as { q?: string; type?: string };

    if (q.length < 2) {
      res.status(200).json({
        success: true,
        data: { customers: [], suppliers: [], products: [], expenseCategories: [] },
      });
      return;
    }

    const results: {
      customers?: unknown[];
      suppliers?: unknown[];
      products?: unknown[];
      expenseCategories?: unknown[];
    } = {};

    if (type === 'all' || type === 'customer') {
      results.customers = await prisma.customer.findMany({
        where: {
          userId,
          isDeleted: false,
          name: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, name: true, email: true },
        take: 5,
      });
    }

    if (type === 'all' || type === 'supplier') {
      results.suppliers = await prisma.supplier.findMany({
        where: {
          user_id: userId,
          isDeleted: false,
          supplier_name: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, supplier_name: true, supplier_email: true },
        take: 5,
      });
    }

    if (type === 'all' || type === 'product') {
      results.products = await prisma.product.findMany({
        where: {
          status: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, code: true, selling_price: true, item_type: true },
        take: 8,
      });
    }

    if (type === 'all' || type === 'category') {
      results.expenseCategories = await prisma.expenseCategory.findMany({
        where: {
          isDeleted: false,
          status: true,
          title: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, title: true },
        take: 5,
      });
    }

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI suggestions error:', err);
    res.status(500).json({ success: false, message: 'Error fetching suggestions' });
  }
}

// ============================================================
// BATCH PROCESSING
// ============================================================

/**
 * Process multiple prompts in batch
 * POST /api/admin/ai/batch
 */
export async function processBatch(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { prompts } = req.body as { prompts?: string[] };

    if (!Array.isArray(prompts) || prompts.length === 0) {
      res.status(400).json({ success: false, message: 'prompts must be a non-empty array' });
      return;
    }

    if (prompts.length > 20) {
      res.status(400).json({ success: false, message: 'Maximum 20 prompts per batch' });
      return;
    }

    const aiConfig = await getOrCreateConfig(userId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyCount = await prisma.aIPromptLog.count({
      where: { userId, createdAt: { gte: today } },
    });

    if (dailyCount + prompts.length > aiConfig.maxPromptsPerDay) {
      res.status(429).json({
        success: false,
        message: `Batch would exceed daily limit. Used: ${dailyCount}, Limit: ${aiConfig.maxPromptsPerDay}, Requested: ${prompts.length}`,
      });
      return;
    }

    const context = await loadContext(userId);
    const results: Array<Record<string, unknown>> = [];

    for (const promptText of prompts) {
      try {
        const aiResult = await processPrompt(promptText, context);

        if (aiResult.success && aiResult.result) {
          const { documentType, data, confidence, summary } = aiResult.result;
          const { resolved, matchDetails } = resolveEntities(data, documentType, context);
          const formattedPayload = formatForController(documentType, resolved, { userId });

          const promptLog = await prisma.aIPromptLog.create({
            data: {
              prompt: promptText,
              documentType,
              extractedData: {
                raw: data,
                resolved,
                matchDetails,
                formatted: formattedPayload,
              } as Prisma.InputJsonValue,
              status: 'processed',
              userId,
              processingTimeMs: aiResult.processingTimeMs || 0,
              inputTokens: aiResult.tokensUsed?.inputTokens || 0,
              outputTokens: aiResult.tokensUsed?.outputTokens || 0,
            },
          });

          results.push({
            success: true,
            prompt: promptText,
            promptLogId: promptLog.id,
            promptId: promptLog.promptId,
            documentType,
            confidence,
            summary,
            preview: formattedPayload,
          });
        } else {
          results.push({
            success: false,
            prompt: promptText,
            error: 'Failed to process',
          });
        }
      } catch (batchErr) {
        results.push({
          success: false,
          prompt: promptText,
          error: errorMessage(batchErr),
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    res.status(200).json({
      success: true,
      message: `Batch processed: ${successCount}/${prompts.length} successful`,
      data: { results, total: prompts.length, successful: successCount },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI batch error:', err);
    res.status(500).json({
      success: false,
      message: 'Error processing batch',
      error: errorMessage(err),
    });
  }
}

// ============================================================
// AI INSIGHTS
// ============================================================

/**
 * Get AI-powered financial insights
 * GET /api/admin/ai/insights
 */
export async function getInsights(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const financialData = await getFinancialData(userId);

    let narrative: string | null = null;
    if (req.query.withNarrative === 'true') {
      try {
        narrative = await generateInsightNarrative(financialData);
      } catch (aiErr) {
        console.error('Insight narrative generation failed:', errorMessage(aiErr));
        narrative = null;
      }
    }

    res.status(200).json({
      success: true,
      message: 'Financial insights fetched successfully',
      data: {
        ...financialData,
        narrative,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('AI insights error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching insights',
      error: errorMessage(err),
    });
  }
}

// ============================================================
// CHAT CONVERSATIONAL MODE
// ============================================================

interface ChatMessage {
  role: string;
  content: string;
  extractedData?: Record<string, unknown>;
  isComplete?: boolean;
  timestamp?: string;
}

/**
 * Start a new chat session
 * POST /api/admin/ai/chat/start
 */
export async function startChatSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const session = await prisma.aIChatSession.create({
      data: { userId, messages: [] as Prisma.InputJsonValue },
    });

    res.status(201).json({
      success: true,
      message: 'Chat session started',
      data: {
        sessionId: session.sessionId,
        id: session.id,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Chat start error:', err);
    res.status(500).json({ success: false, message: 'Error starting chat session' });
  }
}

/**
 * Send a message in a chat session
 * POST /api/admin/ai/chat/:sessionId/message
 */
export async function sendChatMessage(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { sessionId } = req.params as { sessionId: string };
    const { message } = req.body as { message?: string };

    if (!message || message.trim().length === 0) {
      res.status(400).json({ success: false, message: 'Message is required' });
      return;
    }

    const session = await prisma.aIChatSession.findFirst({
      where: { id: sessionId, userId, status: 'active' },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Chat session not found or closed' });
      return;
    }

    // Load context
    const context = await loadContext(userId);

    const existingMessages = Array.isArray(session.messages)
      ? (session.messages as unknown as ChatMessage[])
      : [];

    // Build history for AI
    const messageHistory = existingMessages.map((m) => ({ role: m.role, content: m.content }));

    // Process with AI
    const aiResponse = await processChatMessage(messageHistory, message.trim(), context);

    const updatedMessages: ChatMessage[] = [
      ...existingMessages,
      { role: 'user', content: message.trim() },
      {
        role: 'assistant',
        content: aiResponse.message,
        extractedData: aiResponse.extractedData,
        isComplete: aiResponse.isComplete,
      },
    ];

    const updateData: Prisma.AIChatSessionUpdateInput = {
      messages: updatedMessages as unknown as Prisma.InputJsonValue,
    };
    if (aiResponse.documentType) updateData.documentType = aiResponse.documentType;
    if (aiResponse.extractedData) {
      updateData.currentExtractedData = aiResponse.extractedData as Prisma.InputJsonValue;
    }

    await prisma.aIChatSession.update({
      where: { id: session.id },
      data: updateData,
    });

    // If complete, resolve entities and format
    let preview: Record<string, unknown> | null = null;
    let matchDetails: unknown = null;
    if (aiResponse.isComplete && aiResponse.extractedData) {
      const { resolved, matchDetails: md } = resolveEntities(
        aiResponse.extractedData,
        aiResponse.documentType as AIDocumentType,
        context,
      );
      matchDetails = md;
      const docType = (aiResponse.documentType || session.documentType) as AIDocumentType;
      const resolvedTyped = resolved as Record<string, unknown> & {
        customerId?: string;
        customerName?: string;
        vendorId?: string;
        vendorName?: string;
      };

      if (docType === 'invoice' || docType === 'quotation') {
        if (!resolvedTyped.customerId) {
          res.status(200).json({
            success: true,
            data: {
              message: `Customer "${resolvedTyped.customerName}" was not found in your database. Please add this customer first or choose an existing one.`,
              documentType: docType,
              isComplete: false,
              missingFields: ['valid customer'],
              confidence: 0.5,
              summary: null,
              preview: null,
              matchDetails: null,
              sessionId: session.sessionId,
            },
          });
          return;
        }
      }

      if (docType === 'purchase_order') {
        if (!resolvedTyped.vendorId) {
          res.status(200).json({
            success: true,
            data: {
              message: `Vendor "${resolvedTyped.vendorName}" was not found in your database. Please add this vendor first or choose an existing one.`,
              documentType: docType,
              isComplete: false,
              missingFields: ['valid vendor'],
              confidence: 0.5,
              summary: null,
              preview: null,
              matchDetails: null,
              sessionId: session.sessionId,
            },
          });
          return;
        }
      }
      preview = formatForController(docType, resolved, { userId });
    }

    res.status(200).json({
      success: true,
      data: {
        message: aiResponse.message,
        documentType: aiResponse.documentType || session.documentType,
        isComplete: aiResponse.isComplete,
        missingFields: aiResponse.missingFields || [],
        confidence: aiResponse.confidence || 0,
        summary: aiResponse.summary,
        preview,
        matchDetails,
        sessionId: session.sessionId,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Chat message error:', err);
    res.status(500).json({
      success: false,
      message: 'Error processing chat message',
      error: errorMessage(err),
    });
  }
}

/**
 * Get chat session history
 * GET /api/admin/ai/chat/:sessionId
 */
export async function getChatSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { sessionId } = req.params as { sessionId: string };

    const session = await prisma.aIChatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Chat session not found' });
      return;
    }

    res.status(200).json({ success: true, data: session });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Error fetching chat session' });
  }
}

/**
 * List chat sessions
 * GET /api/admin/ai/chat
 */
export async function listChatSessions(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { page = '1', limit = '10' } = req.query as { page?: string; limit?: string };
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;

    const [total, sessions] = await Promise.all([
      prisma.aIChatSession.count({ where: { userId, isDeleted: false } }),
      prisma.aIChatSession.findMany({
        where: { userId, isDeleted: false },
        select: {
          id: true,
          sessionId: true,
          documentType: true,
          status: true,
          messages: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    const formatted = sessions.map((s) => {
      const msgs = Array.isArray(s.messages) ? (s.messages as unknown as ChatMessage[]) : [];
      return {
        id: s.id,
        sessionId: s.sessionId,
        documentType: s.documentType,
        status: s.status,
        messageCount: msgs.length,
        firstMessage: msgs.find((m) => m.role === 'user')?.content || '',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        sessions: formatted,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Error listing chat sessions' });
  }
}

// ============================================================
// DUPLICATE DETECTION
// ============================================================

/**
 * Check for duplicate documents before creation
 * POST /api/admin/ai/check-duplicates
 */
export async function checkDuplicates(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { documentType, payload } = req.body as {
      documentType?: string;
      payload?: Record<string, unknown>;
    };

    if (!documentType || !payload) {
      res.status(400).json({
        success: false,
        message: 'documentType and payload are required',
      });
      return;
    }

    const result = await checkDuplicatesService(documentType, payload, userId);

    res.status(200).json({
      success: true,
      message: result.hasDuplicates
        ? `Found ${result.duplicates.length} potential duplicate(s)`
        : 'No duplicates found',
      data: result,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Duplicate check error:', err);
    res.status(500).json({ success: false, message: 'Error checking duplicates' });
  }
}

// ============================================================
// PAYMENT FOLLOW-UP
// ============================================================

/**
 * Get overdue invoices for follow-up
 * GET /api/admin/ai/overdue-invoices
 */
export async function getOverdueInvoices(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const invoices = await getOverdueInvoicesService(userId);

    res.status(200).json({
      success: true,
      message: `Found ${invoices.length} overdue invoice(s)`,
      data: invoices,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Overdue invoices error:', err);
    res.status(500).json({ success: false, message: 'Error fetching overdue invoices' });
  }
}

/**
 * Generate AI follow-up email for an overdue invoice
 * POST /api/admin/ai/generate-followup
 */
export async function generateFollowup(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { invoiceId, tone = 'professional' } = req.body as {
      invoiceId?: string;
      tone?: string;
    };

    if (!invoiceId) {
      res.status(400).json({ success: false, message: 'invoiceId is required' });
      return;
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, userId, isDeleted: false },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        billToCustomer: { select: { id: true, name: true, email: true, phone: true } },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          },
        },
        billToContact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          },
        },
      },
    });

    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const daysOverdue = invoice.dueDate
      ? Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    // Contact-first party resolution (matches getPurchaseReport / getIncomeStats):
    // new-flow invoices set contactId but leave the legacy `customer` null, so
    // reading only `customer` produced the 'Customer' placeholder in the email.
    const party = invoice.contact ?? invoice.billToContact ?? null;
    const legacy = invoice.customer ?? invoice.billToCustomer;
    const customerName =
      (party ? resolveDisplayName(party) : '') || legacy?.name || 'Customer';
    const customerEmail =
      party?.email || legacy?.email || null;

    const invoiceData = {
      ...invoice,
      daysOverdue,
      customerName,
      customerEmail,
    };

    const company = await prisma.companySettings.findFirst();
    const email = await generateFollowupEmail(
      invoiceData as unknown as Record<string, unknown>,
      company?.companyName || 'Our Company',
      tone,
    );

    res.status(200).json({
      success: true,
      message: 'Follow-up email generated',
      data: {
        email,
        invoice: {
          id: invoice.id,
          number: invoice.invoiceNumber,
          amount: invoice.TotalAmount,
          dueDate: invoice.dueDate,
          daysOverdue,
          customerName,
          customerEmail,
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Follow-up generation error:', err);
    res.status(500).json({ success: false, message: 'Error generating follow-up email' });
  }
}

/**
 * Send AI-generated follow-up email
 * POST /api/admin/ai/send-followup
 */
export async function sendFollowup(req: Request, res: Response): Promise<void> {
  try {
    const { to, subject, body, invoiceId: _invoiceId } = req.body as {
      to?: string;
      subject?: string;
      body?: string;
      invoiceId?: string;
    };

    if (!to || !subject || !body) {
      res.status(400).json({
        success: false,
        message: 'to, subject, and body are required',
      });
      return;
    }

    await sendMail({
      to,
      subject,
      html: body,
    });

    res.status(200).json({
      success: true,
      message: `Follow-up email sent to ${to}`,
    });
  } catch (err) {
    console.error('Send follow-up error:', err);
    res.status(500).json({
      success: false,
      message: 'Error sending follow-up email',
      error: errorMessage(err),
    });
  }
}

// ============================================================
// PROMPT TEMPLATES
// ============================================================

/**
 * Create a prompt template
 * POST /api/admin/ai/templates
 */
export async function createTemplate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { name, prompt, documentType, category } = req.body as {
      name?: string;
      prompt?: string;
      documentType?: AIPromptTemplateDocumentType;
      category?: string;
    };

    if (!name || !prompt) {
      res.status(400).json({
        success: false,
        message: 'name and prompt are required',
      });
      return;
    }

    const template = await prisma.aIPromptTemplate.create({
      data: {
        name,
        prompt,
        documentType: documentType || 'any',
        category: category || 'General',
        userId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Template create error:', err);
    res.status(500).json({ success: false, message: 'Error creating template' });
  }
}

/**
 * Get all templates
 * GET /api/admin/ai/templates
 */
export async function getTemplates(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { documentType, search } = req.query as {
      documentType?: string;
      search?: string;
    };

    const where: Prisma.AIPromptTemplateWhereInput = { userId, isDeleted: false };
    if (documentType && documentType !== 'all') {
      where.documentType = documentType as AIPromptTemplateDocumentType;
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const templates = await prisma.aIPromptTemplate.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
    });

    res.status(200).json({
      success: true,
      message: 'Templates fetched successfully',
      data: templates,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Error fetching templates' });
  }
}

/**
 * Update a template
 * PUT /api/admin/ai/templates/:id
 */
export async function updateTemplate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const { name, prompt, documentType, category } = req.body as {
      name?: string;
      prompt?: string;
      documentType?: AIPromptTemplateDocumentType;
      category?: string;
    };

    const existing = await prisma.aIPromptTemplate.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Template not found' });
      return;
    }

    const data: Prisma.AIPromptTemplateUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (prompt !== undefined) data.prompt = prompt;
    if (documentType !== undefined) data.documentType = documentType;
    if (category !== undefined) data.category = category;

    const template = await prisma.aIPromptTemplate.update({ where: { id }, data });

    res.status(200).json({
      success: true,
      message: 'Template updated successfully',
      data: template,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Error updating template' });
  }
}

/**
 * Delete a template
 * DELETE /api/admin/ai/templates/:id
 */
export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.aIPromptTemplate.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Template not found' });
      return;
    }

    await prisma.aIPromptTemplate.update({ where: { id }, data: { isDeleted: true } });

    res.status(200).json({ success: true, message: 'Template deleted successfully' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Error deleting template' });
  }
}

/**
 * Use a template (increment usage count)
 * POST /api/admin/ai/templates/:id/use
 */
export async function useTemplate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.aIPromptTemplate.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Template not found' });
      return;
    }

    const template = await prisma.aIPromptTemplate.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });

    res.status(200).json({
      success: true,
      data: { prompt: template.prompt, name: template.name },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({ success: false, message: 'Error using template' });
  }
}

// CommonJS interop for legacy JS routes
module.exports = {
  processAIPrompt,
  confirmAIDocument,
  getAIHistory,
  getAIPromptDetail,
  getAIConfig,
  updateAIConfig,
  deleteAIPromptLog,
  getAIStats,
  getSuggestions,
  processBatch,
  getInsights,
  startChatSession,
  sendChatMessage,
  getChatSession,
  listChatSessions,
  checkDuplicates,
  getOverdueInvoices,
  generateFollowup,
  sendFollowup,
  createTemplate,
  getTemplates,
  updateTemplate,
  deleteTemplate,
  useTemplate,
};
module.exports.processAIPrompt = processAIPrompt;
module.exports.confirmAIDocument = confirmAIDocument;
module.exports.getAIHistory = getAIHistory;
module.exports.getAIPromptDetail = getAIPromptDetail;
module.exports.getAIConfig = getAIConfig;
module.exports.updateAIConfig = updateAIConfig;
module.exports.deleteAIPromptLog = deleteAIPromptLog;
module.exports.getAIStats = getAIStats;
module.exports.getSuggestions = getSuggestions;
module.exports.processBatch = processBatch;
module.exports.getInsights = getInsights;
module.exports.startChatSession = startChatSession;
module.exports.sendChatMessage = sendChatMessage;
module.exports.getChatSession = getChatSession;
module.exports.listChatSessions = listChatSessions;
module.exports.checkDuplicates = checkDuplicates;
module.exports.getOverdueInvoices = getOverdueInvoices;
module.exports.generateFollowup = generateFollowup;
module.exports.sendFollowup = sendFollowup;
module.exports.createTemplate = createTemplate;
module.exports.getTemplates = getTemplates;
module.exports.updateTemplate = updateTemplate;
module.exports.deleteTemplate = deleteTemplate;
module.exports.useTemplate = useTemplate;
