import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { ReminderStatus, ReminderType, ReminderTiming, ReminderEvent } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';
import { sendReminderEmail } from '../lib/reminderMailer';

// invoiceReminderCron.ts is required extensionless (ts-node/register resolves
// it, same as recurringInvoicesCron.ts elsewhere) so a static require is fine here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cronModule: { runReminderCron: (scopeUserId?: string) => Promise<unknown> } = require('../invoiceReminderCron');

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

/**
 * remindDays is an Int column but clients/validators send it as a string ("10");
 * express-validator's .isInt() validates without coercing. Parse to a finite
 * integer so Prisma doesn't reject with "Expected Int, provided String".
 * Non-numeric input yields undefined (field left unchanged) rather than NaN.
 */
function toOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

const VALID_REMINDER_TYPES = new Set<ReminderType>([
  'automatic',
  'manual',
  'automatic_Purchase',
  'manual_purchase',
  'automatic_quotation',
  'manual_quotation',
]);

const REMINDER_BY_TYPE_ALLOWED = new Set<ReminderType>([
  'automatic',
  'manual',
  'automatic_Purchase',
  'manual_purchase',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Standard include sets matching the original .populate(...) calls.
// Note: the Prisma Invoice/Quotation models do not have flat `customerName` or
// `totalAmount` fields the way the Mongoose schema did — `customerName` is
// reached through `customer.name` and the column is `TotalAmount`. We pull the
// customer relation alongside so callers can read the same data.
// Unified Contact fields needed for contact-first party-name resolution
// (see lib/contacts/contactIdentity#resolveDisplayName). Kept minimal/select-only
// so it stays cheap to include alongside the legacy relations below.
const partyContactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  organisation: true,
  email: true,
  mobile: true,
  telephone: true,
  image: true,
} satisfies Prisma.ContactSelect;

const listInclude = {
  targetInvoiceRel: {
    select: {
      invoiceNumber: true,
      TotalAmount: true,
      customer: { select: { name: true } },
      contact: { select: partyContactSelect },
      billToContact: { select: partyContactSelect },
    },
  },
  targetCustomerRel: { select: { name: true, email: true } },
  targetContactRel: { select: partyContactSelect },
  createdByUser: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.ReminderInclude;

const detailInclude = {
  targetInvoiceRel: {
    select: {
      invoiceNumber: true,
      TotalAmount: true,
      dueDate: true,
      customer: { select: { name: true } },
      contact: { select: partyContactSelect },
      billToContact: { select: partyContactSelect },
    },
  },
  targetCustomerRel: { select: { name: true, email: true, phone: true } },
  targetContactRel: { select: partyContactSelect },
  createdByUser: { select: { firstName: true, lastName: true, email: true } },
  company: { select: { companyName: true } },
} satisfies Prisma.ReminderInclude;

const quotationCreateInclude = {
  targetInvoiceRel: {
    select: {
      invoiceNumber: true,
      TotalAmount: true,
      customer: { select: { name: true } },
    },
  },
  targetQuotationRel: {
    select: {
      quotationId: true,
      TotalAmount: true,
      customer: { select: { name: true } },
    },
  },
  targetCustomerRel: { select: { name: true, email: true } },
  createdByUser: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.ReminderInclude;

const quotationUpdateInclude = {
  targetQuotationRel: {
    select: {
      quotationId: true,
      TotalAmount: true,
      customer: { select: { name: true } },
    },
  },
  targetCustomerRel: { select: { name: true, email: true } },
  createdByUser: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.ReminderInclude;

const manualReminderInclude = {
  targetInvoiceRel: true,
  targetCustomerRel: true,
  createdByUser: true,
} satisfies Prisma.ReminderInclude;

type PartyContact = Prisma.ContactGetPayload<{ select: typeof partyContactSelect }>;

function resolveContactName(contact: PartyContact | null | undefined): string {
  return contact ? resolveDisplayName(contact) : '';
}

// Contact-first party synthesis for reminder responses — DISPLAY ONLY.
// Reminders/invoices/quotations created via the unified-contact flow can carry
// a contactId (targetContactId, or Invoice/Quotation contactId) with no legacy
// Customer row, which previously left targetCustomerRel/customer null and the
// UI rendered "Deleted User". These only fill in when the legacy relation is
// null; an existing legacy name is never overridden.
// NOTE: reminder create/update (createReminder, createReminderQuotation,
// updateReminder) never set targetContactId — that linkage gap is a separate,
// deeper limitation left untouched here.
function synthesizeCustomer(
  contact: PartyContact | null | undefined,
): { name: string; email: string | null } | null {
  const name = resolveContactName(contact);
  return name ? { name, email: contact?.email ?? null } : null;
}

function synthesizeCustomerWithPhone(
  contact: PartyContact | null | undefined,
): { name: string; email: string | null; phone: string | null } | null {
  const name = resolveContactName(contact);
  return name
    ? { name, email: contact?.email ?? null, phone: (contact?.mobile || contact?.telephone) ?? null }
    : null;
}

function synthesizeCustomerNameOnly(
  contact: PartyContact | null | undefined,
): { name: string } | null {
  const name = resolveContactName(contact);
  return name ? { name } : null;
}

// =============================================================================
// getReminders
// =============================================================================

export async function getReminders(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { search = '', type = '', status = '' } = req.query as {
      search?: string;
      type?: string;
      status?: string;
    };

    const where: Prisma.ReminderWhereInput = { createdBy: userId };
    if (type) where.type = type as ReminderType;
    if (status) where.status = status as ReminderStatus;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        {
          emailConfig: {
            path: ['subject'],
            string_contains: search,
            mode: 'insensitive',
          } as unknown as Prisma.JsonFilter,
        },
      ];
    }

    const reminders = await prisma.reminder.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
    });

    // Contact-first party-name resolution (display only) — see synthesizeCustomer above.
    const resolvedReminders = reminders.map((r) => ({
      ...r,
      targetCustomerRel: r.targetCustomerRel ?? synthesizeCustomer(r.targetContactRel),
      targetInvoiceRel: r.targetInvoiceRel
        ? {
            ...r.targetInvoiceRel,
            customer:
              r.targetInvoiceRel.customer ??
              synthesizeCustomerNameOnly(r.targetInvoiceRel.contact ?? r.targetInvoiceRel.billToContact),
          }
        : r.targetInvoiceRel,
    }));

    res.status(200).json({
      success: true,
      message: 'Reminders fetched successfully',
      data: {
        reminders: resolvedReminders,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminders',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getReminderById
// =============================================================================

export async function getReminderById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const reminder = await prisma.reminder.findUnique({
      where: { id },
      include: detailInclude,
    });

    if (!reminder) {
      res.status(404).json({
        success: false,
        message: 'Reminder not found',
      });
      return;
    }

    // Check if user has access to this reminder
    if (reminder.createdBy !== requireUserId(req)) {
      res.status(403).json({
        success: false,
        message: 'Access denied',
      });
      return;
    }

    // Contact-first party-name resolution (display only) — see synthesizeCustomer above.
    const resolvedReminder = {
      ...reminder,
      targetCustomerRel: reminder.targetCustomerRel ?? synthesizeCustomerWithPhone(reminder.targetContactRel),
      targetInvoiceRel: reminder.targetInvoiceRel
        ? {
            ...reminder.targetInvoiceRel,
            customer:
              reminder.targetInvoiceRel.customer ??
              synthesizeCustomerNameOnly(
                reminder.targetInvoiceRel.contact ?? reminder.targetInvoiceRel.billToContact,
              ),
          }
        : reminder.targetInvoiceRel,
    };

    res.status(200).json({
      success: true,
      message: 'Reminder fetched successfully',
      data: resolvedReminder,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminder',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// createReminder
// =============================================================================

export async function createReminder(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      name,
      type,
      remindDays,
      remindTiming,
      remindEvent,
      isEnabled,
      emailConfig,
      targetInvoice,
      targetCustomer,
      manualReminderData,
    } = req.body as {
      name?: string;
      type?: ReminderType;
      remindDays?: number;
      remindTiming?: ReminderTiming;
      remindEvent?: ReminderEvent;
      isEnabled?: boolean;
      emailConfig?: unknown;
      targetInvoice?: string;
      targetCustomer?: string;
      manualReminderData?: unknown;
    };

    // Validate user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    // Get user's company
    const company = await prisma.companySettings.findFirst({ where: { userId } });
    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company settings not found',
      });
      return;
    }

    // For manual reminders, validate target invoice and customer
    if (type === 'manual') {
      if (targetInvoice) {
        const invoice = await prisma.invoice.findUnique({ where: { id: targetInvoice } });
        if (!invoice) {
          res.status(404).json({
            success: false,
            message: 'Target invoice not found',
          });
          return;
        }
      }

      if (targetCustomer) {
        const customer = await prisma.customer.findUnique({ where: { id: targetCustomer } });
        if (!customer) {
          res.status(404).json({
            success: false,
            message: 'Target customer not found',
          });
          return;
        }
      }
    }

    // Create reminder data
    const data: Prisma.ReminderCreateInput = {
      name: name ?? '',
      type: (type ?? 'automatic') as ReminderType,
      isEnabled: isEnabled ?? true,
      emailConfig: (emailConfig ?? {}) as Prisma.InputJsonValue,
      createdByUser: { connect: { id: userId } },
      company: { connect: { id: company.id } },
    };

    // Add type-specific fields
    if (type === 'automatic' || type === 'automatic_Purchase') {
      if (remindDays !== undefined) data.remindDays = toOptionalInt(remindDays);
      if (remindTiming !== undefined) data.remindTiming = remindTiming;
      if (remindEvent !== undefined) data.remindEvent = remindEvent;
    } else if (type === 'manual' || type === 'manual_purchase') {
      if (targetInvoice) data.targetInvoiceRel = { connect: { id: targetInvoice } };
      if (targetCustomer) data.targetCustomerRel = { connect: { id: targetCustomer } };
      if (manualReminderData !== undefined) {
        data.manualReminderData = manualReminderData as Prisma.InputJsonValue;
      }
    }

    const created = await prisma.reminder.create({ data });

    // Populate the created reminder
    const reminder = await prisma.reminder.findUnique({
      where: { id: created.id },
      include: listInclude,
    });

    res.status(201).json({
      success: true,
      message: 'Reminder created successfully',
      data: reminder,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to create reminder',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// createReminderQuotation
// =============================================================================

export async function createReminderQuotation(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      name,
      type,
      remindDays,
      remindTiming,
      remindEvent,
      isEnabled,
      emailConfig,
      targetInvoice,
      targetQuotation,
      targetCustomer,
      manualReminderData,
    } = req.body as {
      name?: string;
      type?: ReminderType;
      remindDays?: number;
      remindTiming?: ReminderTiming;
      remindEvent?: ReminderEvent;
      isEnabled?: boolean;
      emailConfig?: unknown;
      targetInvoice?: string;
      targetQuotation?: string;
      targetCustomer?: string;
      manualReminderData?: unknown;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const company = await prisma.companySettings.findFirst({ where: { userId } });
    if (!company) {
      res.status(404).json({ success: false, message: 'Company not found' });
      return;
    }

    // Validate targets for manual reminders
    if (type === 'manual' || type === 'manual_purchase' || type === 'manual_quotation') {
      if (targetInvoice) {
        const invoice = await prisma.invoice.findUnique({ where: { id: targetInvoice } });
        if (!invoice) {
          res.status(404).json({ success: false, message: 'Target invoice not found' });
          return;
        }
      }

      if (targetQuotation) {
        const quotation = await prisma.quotation.findUnique({ where: { id: targetQuotation } });
        if (!quotation) {
          res.status(404).json({ success: false, message: 'Target quotation not found' });
          return;
        }
      }

      if (targetCustomer) {
        const customer = await prisma.customer.findUnique({ where: { id: targetCustomer } });
        if (!customer) {
          res.status(404).json({ success: false, message: 'Target customer not found' });
          return;
        }
      }
    }

    // Construct reminder data
    const data: Prisma.ReminderCreateInput = {
      name: name ?? '',
      type: (type ?? 'automatic') as ReminderType,
      isEnabled: isEnabled ?? true,
      emailConfig: (emailConfig ?? {}) as Prisma.InputJsonValue,
      createdByUser: { connect: { id: userId } },
      company: { connect: { id: company.id } },
    };

    // Add specific fields
    if (
      type === 'automatic' ||
      type === 'automatic_Purchase' ||
      type === 'automatic_quotation'
    ) {
      if (remindDays !== undefined) data.remindDays = toOptionalInt(remindDays);
      if (remindTiming !== undefined) data.remindTiming = remindTiming;
      if (remindEvent !== undefined) data.remindEvent = remindEvent;
    } else {
      if (targetInvoice) data.targetInvoiceRel = { connect: { id: targetInvoice } };
      if (targetQuotation) data.targetQuotationRel = { connect: { id: targetQuotation } };
      if (targetCustomer) data.targetCustomerRel = { connect: { id: targetCustomer } };
      if (manualReminderData !== undefined) {
        data.manualReminderData = manualReminderData as Prisma.InputJsonValue;
      }
    }

    const created = await prisma.reminder.create({ data });

    const reminder = await prisma.reminder.findUnique({
      where: { id: created.id },
      include: quotationCreateInclude,
    });

    res.status(201).json({
      success: true,
      message: 'Reminder created successfully',
      data: reminder,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to create reminder',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateReminder
// =============================================================================

export async function updateReminder(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id: reminderId } = req.params as { id: string };
    const updateBody = req.body as Record<string, unknown>;

    // Find the reminder
    const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) {
      res.status(404).json({
        success: false,
        message: 'Reminder not found',
      });
      return;
    }

    // Check if user has access to this reminder
    if (reminder.createdBy !== userId) {
      res.status(403).json({
        success: false,
        message: 'Access denied',
      });
      return;
    }

    const data: Prisma.ReminderUpdateInput = {};
    if (updateBody.name !== undefined) data.name = updateBody.name as string;
    if (updateBody.type !== undefined) data.type = updateBody.type as ReminderType;
    if (updateBody.isEnabled !== undefined) data.isEnabled = Boolean(updateBody.isEnabled);
    if (updateBody.emailConfig !== undefined) {
      data.emailConfig = updateBody.emailConfig as Prisma.InputJsonValue;
    }
    if (updateBody.remindDays !== undefined) data.remindDays = toOptionalInt(updateBody.remindDays);
    if (updateBody.remindTiming !== undefined) {
      data.remindTiming = updateBody.remindTiming as ReminderTiming;
    }
    if (updateBody.remindEvent !== undefined) {
      data.remindEvent = updateBody.remindEvent as ReminderEvent;
    }
    if (updateBody.status !== undefined) data.status = updateBody.status as ReminderStatus;
    if (updateBody.manualReminderData !== undefined) {
      data.manualReminderData = updateBody.manualReminderData as Prisma.InputJsonValue;
    }
    if (updateBody.targetInvoice !== undefined) {
      if (updateBody.targetInvoice) {
        data.targetInvoiceRel = { connect: { id: updateBody.targetInvoice as string } };
      } else {
        data.targetInvoiceRel = { disconnect: true };
      }
    }
    if (updateBody.targetCustomer !== undefined) {
      if (updateBody.targetCustomer) {
        data.targetCustomerRel = { connect: { id: updateBody.targetCustomer as string } };
      } else {
        data.targetCustomerRel = { disconnect: true };
      }
    }
    if (updateBody.targetQuotation !== undefined) {
      if (updateBody.targetQuotation) {
        data.targetQuotationRel = { connect: { id: updateBody.targetQuotation as string } };
      } else {
        data.targetQuotationRel = { disconnect: true };
      }
    }

    // Update the reminder
    const updatedReminder = await prisma.reminder.update({
      where: { id: reminderId },
      data,
      include: listInclude,
    });

    res.status(200).json({
      success: true,
      message: 'Reminder updated successfully',
      data: updatedReminder,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to update reminder',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateReminderQuotation
// =============================================================================

export async function updateReminderQuotation(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id: reminderId } = req.params as { id: string };
    const updateBody = req.body as Record<string, unknown>;

    // Find the reminder
    const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) {
      res.status(404).json({
        success: false,
        message: 'Quotation reminder not found',
      });
      return;
    }

    // Ensure the reminder is a quotation-type reminder
    if (!(['manual_quotation', 'automatic_quotation'] as ReminderType[]).includes(reminder.type)) {
      res.status(400).json({
        success: false,
        message: 'This reminder is not a quotation reminder',
      });
      return;
    }

    // Verify user access
    if (reminder.createdBy !== userId) {
      res.status(403).json({
        success: false,
        message: 'Access denied',
      });
      return;
    }

    // Validate targetQuotation if included
    if (updateBody.targetQuotation) {
      const quotation = await prisma.quotation.findUnique({
        where: { id: updateBody.targetQuotation as string },
      });
      if (!quotation) {
        res.status(404).json({
          success: false,
          message: 'Target quotation not found',
        });
        return;
      }
    }

    // Validate targetCustomer if included
    if (updateBody.targetCustomer) {
      const customer = await prisma.customer.findUnique({
        where: { id: updateBody.targetCustomer as string },
      });
      if (!customer) {
        res.status(404).json({
          success: false,
          message: 'Target customer not found',
        });
        return;
      }
    }

    // If updating emailConfig, validate fields
    if (updateBody.emailConfig) {
      const { fromEmail, cc, bcc } = updateBody.emailConfig as {
        fromEmail?: string;
        cc?: string[];
        bcc?: string[];
      };

      if (fromEmail && !EMAIL_REGEX.test(fromEmail)) {
        res.status(400).json({
          success: false,
          message: 'Invalid "fromEmail" format',
        });
        return;
      }

      if (cc && !cc.every((email) => EMAIL_REGEX.test(email))) {
        res.status(400).json({
          success: false,
          message: 'Invalid "cc" email format',
        });
        return;
      }

      if (bcc && !bcc.every((email) => EMAIL_REGEX.test(email))) {
        res.status(400).json({
          success: false,
          message: 'Invalid "bcc" email format',
        });
        return;
      }
    }

    const data: Prisma.ReminderUpdateInput = {};
    if (updateBody.name !== undefined) data.name = updateBody.name as string;
    if (updateBody.type !== undefined) data.type = updateBody.type as ReminderType;
    if (updateBody.isEnabled !== undefined) data.isEnabled = Boolean(updateBody.isEnabled);
    if (updateBody.emailConfig !== undefined) {
      data.emailConfig = updateBody.emailConfig as Prisma.InputJsonValue;
    }
    if (updateBody.remindDays !== undefined) data.remindDays = toOptionalInt(updateBody.remindDays);
    if (updateBody.remindTiming !== undefined) {
      data.remindTiming = updateBody.remindTiming as ReminderTiming;
    }
    if (updateBody.remindEvent !== undefined) {
      data.remindEvent = updateBody.remindEvent as ReminderEvent;
    }
    if (updateBody.status !== undefined) data.status = updateBody.status as ReminderStatus;
    if (updateBody.manualReminderData !== undefined) {
      data.manualReminderData = updateBody.manualReminderData as Prisma.InputJsonValue;
    }
    if (updateBody.targetQuotation !== undefined) {
      if (updateBody.targetQuotation) {
        data.targetQuotationRel = { connect: { id: updateBody.targetQuotation as string } };
      } else {
        data.targetQuotationRel = { disconnect: true };
      }
    }
    if (updateBody.targetCustomer !== undefined) {
      if (updateBody.targetCustomer) {
        data.targetCustomerRel = { connect: { id: updateBody.targetCustomer as string } };
      } else {
        data.targetCustomerRel = { disconnect: true };
      }
    }
    if (updateBody.targetInvoice !== undefined) {
      if (updateBody.targetInvoice) {
        data.targetInvoiceRel = { connect: { id: updateBody.targetInvoice as string } };
      } else {
        data.targetInvoiceRel = { disconnect: true };
      }
    }

    // Perform the update
    const updatedReminder = await prisma.reminder.update({
      where: { id: reminderId },
      data,
      include: quotationUpdateInclude,
    });

    res.status(200).json({
      success: true,
      message: 'Quotation reminder updated successfully',
      data: updatedReminder,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to update quotation reminder',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteReminder
// =============================================================================

export async function deleteReminder(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id: reminderId } = req.params as { id: string };

    // Find the reminder
    const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) {
      res.status(404).json({
        success: false,
        message: 'Reminder not found',
      });
      return;
    }

    // Check if user has access to this reminder
    if (reminder.createdBy !== userId) {
      res.status(403).json({
        success: false,
        message: 'Access denied',
      });
      return;
    }

    // Hard delete - permanently remove from database
    await prisma.reminder.delete({ where: { id: reminderId } });

    res.status(200).json({
      success: true,
      message: 'Reminder deleted successfully',
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to delete reminder',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// toggleReminderStatus
// =============================================================================

export async function toggleReminderStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id: reminderId } = req.params as { id: string };
    const { isEnabled } = req.body as { isEnabled?: boolean };

    // Find the reminder
    const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) {
      res.status(404).json({
        success: false,
        message: 'Reminder not found',
      });
      return;
    }

    // Check if user has access to this reminder
    if (reminder.createdBy !== userId) {
      res.status(403).json({
        success: false,
        message: 'Access denied',
      });
      return;
    }

    // Update the reminder status
    const updatedReminder = await prisma.reminder.update({
      where: { id: reminderId },
      data: { isEnabled: Boolean(isEnabled) },
      include: listInclude,
    });

    res.status(200).json({
      success: true,
      message: `Reminder ${isEnabled ? 'enabled' : 'disabled'} successfully`,
      data: updatedReminder,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to toggle reminder status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// sendManualReminder
// =============================================================================

export async function sendManualReminder(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id: reminderId } = req.params as { id: string };

    // Find the reminder
    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
      include: manualReminderInclude,
    });

    if (!reminder) {
      res.status(404).json({
        success: false,
        message: 'Reminder not found',
      });
      return;
    }

    // Check if user has access to this reminder
    if (reminder.createdBy !== userId) {
      res.status(403).json({
        success: false,
        message: 'Access denied',
      });
      return;
    }

    // Check if it's a manual reminder
    if (reminder.type !== 'manual') {
      res.status(400).json({
        success: false,
        message: 'This endpoint is only for manual reminders',
      });
      return;
    }

    // Check if reminder is already sent
    const manualData = (reminder.manualReminderData ?? {}) as Record<string, unknown>;
    if (manualData.status === 'sent') {
      res.status(400).json({
        success: false,
        message: 'Reminder has already been sent',
      });
      return;
    }

    // Actually send the email before touching any bookkeeping. The reminder
    // must never be marked sent — nor return success — unless the mailer
    // really accepted the send (see lib/reminderMailer.ts).
    const result = await sendReminderEmail({ reminderId });
    if (!result.sent) {
      res.status(502).json({
        success: false,
        message: 'Failed to send reminder email',
        error: result.error ?? 'Unknown error',
      });
      return;
    }

    const nextManualData = { ...manualData, status: 'sent' };
    const updated = await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        manualReminderData: nextManualData as Prisma.InputJsonValue,
        lastSent: new Date(),
      },
      include: manualReminderInclude,
    });

    res.status(200).json({
      success: true,
      message: 'Manual reminder sent successfully',
      data: updated,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to send manual reminder',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getRemindersByType
// =============================================================================

export async function getRemindersByType(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { type } = req.params as { type: string };
    const { page = '1', limit = '10', search = '' } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    if (!REMINDER_BY_TYPE_ALLOWED.has(type as ReminderType)) {
      res.status(400).json({
        success: false,
        message: 'Invalid reminder type',
      });
      return;
    }

    const pageN = Number(page);
    const limitN = Number(limit);

    // Build search query
    const where: Prisma.ReminderWhereInput = {
      createdBy: userId,
      type: type as ReminderType,
      status: { not: 'archived' },
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        {
          emailConfig: {
            path: ['subject'],
            string_contains: search,
            mode: 'insensitive',
          } as unknown as Prisma.JsonFilter,
        },
      ];
    }

    // Get total count for pagination
    const total = await prisma.reminder.count({ where });

    // Get paginated results
    const reminders = await prisma.reminder.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
      skip: (pageN - 1) * limitN,
      take: limitN,
    });

    // Contact-first party-name resolution (display only) — see synthesizeCustomer above.
    const resolvedReminders = reminders.map((r) => ({
      ...r,
      targetCustomerRel: r.targetCustomerRel ?? synthesizeCustomer(r.targetContactRel),
      targetInvoiceRel: r.targetInvoiceRel
        ? {
            ...r.targetInvoiceRel,
            customer:
              r.targetInvoiceRel.customer ??
              synthesizeCustomerNameOnly(r.targetInvoiceRel.contact ?? r.targetInvoiceRel.billToContact),
          }
        : r.targetInvoiceRel,
    }));

    res.status(200).json({
      success: true,
      message: `${type} reminders fetched successfully`,
      data: {
        reminders: resolvedReminders,
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminders by type',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getReminderStats
// =============================================================================

export async function getReminderStats(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const reminders = await prisma.reminder.findMany({
      where: { createdBy: userId },
      select: { type: true, status: true, isEnabled: true },
    });

    const result = {
      totalReminders: reminders.length,
      automaticReminders: reminders.filter((r) =>
        (['automatic', 'automatic_Purchase'] as ReminderType[]).includes(r.type),
      ).length,
      manualReminders: reminders.filter((r) =>
        (['manual', 'manual_purchase'] as ReminderType[]).includes(r.type),
      ).length,
      activeReminders: reminders.filter((r) => r.status === 'active').length,
      enabledReminders: reminders.filter((r) => r.isEnabled).length,
    };

    res.status(200).json({
      success: true,
      message: 'Reminder statistics fetched successfully',
      data: result,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminder statistics',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getInvoicePlaceholders
// =============================================================================

export async function getInvoicePlaceholders(_req: Request, res: Response): Promise<void> {
  try {
    const placeholders = [
      {
        key: 'CustomerName',
        label: 'Customer Name',
        description: 'The name of the customer',
        category: 'INVOICE',
      },
      {
        key: 'CustomerEmail',
        label: 'Customer Email',
        description: 'The email address of the customer',
        category: 'INVOICE',
      },
      {
        key: 'InvoiceNumber',
        label: 'Invoice Number',
        description: 'The unique invoice number',
        category: 'INVOICE',
      },
      {
        key: 'InvoiceDate',
        label: 'Invoice Date',
        description: 'The date when the invoice was created',
        category: 'INVOICE',
      },
      {
        key: 'DueDate',
        label: 'Due Date',
        description: 'The due date for payment',
        category: 'INVOICE',
      },
      {
        key: 'OverdueDays',
        label: 'Overdue Days',
        description: 'Number of days the invoice is overdue',
        category: 'INVOICE',
      },
      {
        key: 'Balance',
        label: 'Balance',
        description: 'The outstanding balance amount',
        category: 'INVOICE',
      },
      {
        key: 'Total',
        label: 'Total Amount',
        description: 'The total invoice amount',
        category: 'INVOICE',
      },
      {
        key: 'Subject',
        label: 'Subject',
        description: 'Invoice subject/reference',
        category: 'INVOICE',
      },
      {
        key: 'ReferenceNo',
        label: 'P.O. Number',
        description: 'Reference or PO number',
        category: 'INVOICE',
      },
      {
        key: 'Vat',
        label: 'VAT/Tax',
        description: 'Total VAT or tax amount',
        category: 'INVOICE',
      },
      {
        key: 'TotalDiscount',
        label: 'Total Discount',
        description: 'Total discount applied',
        category: 'INVOICE',
      },
      {
        key: 'TaxableAmount',
        label: 'Taxable Amount',
        description: 'Amount before tax',
        category: 'INVOICE',
      },
      {
        key: 'PaymentMethod',
        label: 'Payment Method',
        description: 'Preferred payment method',
        category: 'INVOICE',
      },
      {
        key: 'Notes',
        label: 'Notes',
        description: 'Additional notes on the invoice',
        category: 'INVOICE',
      },
      {
        key: 'TermsAndCondition',
        label: 'Terms & Conditions',
        description: 'Invoice terms and conditions',
        category: 'INVOICE',
      },
      {
        key: 'CreatedBy',
        label: 'Created By',
        description: 'Name of the user who created the invoice',
        category: 'INVOICE',
      },
      {
        key: 'InvoiceUrl',
        label: 'Invoice URL',
        description: 'Link to view the invoice online',
        category: 'INVOICE',
      },
      {
        key: 'InvoicePaymentLink',
        label: 'Invoice Payment Link',
        description: 'Direct link to make payment',
        category: 'INVOICE',
      },
    ];

    res.status(200).json({
      success: true,
      message: 'Invoice placeholders fetched successfully',
      data: {
        placeholders,
        usage: 'Use %PlaceholderName% in email templates to insert dynamic content',
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice placeholders',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getQuotationPlaceholders
// =============================================================================

export async function getQuotationPlaceholders(_req: Request, res: Response): Promise<void> {
  try {
    const placeholders = [
      {
        key: 'CustomerName',
        label: 'Customer Name',
        description: 'The name of the customer',
        category: 'QUOTATION',
      },
      {
        key: 'CustomerEmail',
        label: 'Customer Email',
        description: 'The email address of the customer',
        category: 'QUOTATION',
      },
      {
        key: 'QuotationNumber',
        label: 'Quotation Number',
        description: 'The unique quotation number',
        category: 'QUOTATION',
      },
      {
        key: 'QuotationDate',
        label: 'Quotation Date',
        description: 'The date when the quotation was created',
        category: 'QUOTATION',
      },
      {
        key: 'ExpiryDate',
        label: 'Expiry Date',
        description: 'The date when the quotation expires',
        category: 'QUOTATION',
      },
      {
        key: 'Total',
        label: 'Total Amount',
        description: 'The total quotation amount',
        category: 'QUOTATION',
      },
      {
        key: 'SubTotal',
        label: 'Sub Total',
        description: 'The total amount before taxes and discounts',
        category: 'QUOTATION',
      },
      {
        key: 'Discount',
        label: 'Discount',
        description: 'Total discount applied to the quotation',
        category: 'QUOTATION',
      },
      {
        key: 'Tax',
        label: 'Tax / VAT',
        description: 'Total tax applied to the quotation',
        category: 'QUOTATION',
      },
      {
        key: 'Subject',
        label: 'Subject',
        description: 'Quotation subject or reference',
        category: 'QUOTATION',
      },
      {
        key: 'ReferenceNo',
        label: 'Reference Number',
        description: 'Reference or P.O. number for the quotation',
        category: 'QUOTATION',
      },
      {
        key: 'TermsAndCondition',
        label: 'Terms & Conditions',
        description: 'Quotation terms and conditions',
        category: 'QUOTATION',
      },
      {
        key: 'Notes',
        label: 'Notes',
        description: 'Additional notes on the quotation',
        category: 'QUOTATION',
      },
      {
        key: 'CreatedBy',
        label: 'Created By',
        description: 'Name of the user who created the quotation',
        category: 'QUOTATION',
      },
      {
        key: 'QuotationStatus',
        label: 'Quotation Status',
        description: 'Current status of the quotation (e.g., Draft, Sent, Approved, Rejected)',
        category: 'QUOTATION',
      },
      {
        key: 'CompanyName',
        label: 'Company Name',
        description: 'The name of the company',
        category: 'QUOTATION',
      },
    ];

    res.status(200).json({
      success: true,
      message: 'Quotation placeholders fetched successfully',
      data: {
        placeholders,
        usage: 'Use %PlaceholderName% in email templates to insert dynamic content',
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quotation placeholders',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// triggerReminderCron
// =============================================================================

export async function triggerReminderCron(req: Request, res: Response): Promise<void> {
  try {
    // Wave-1 final review (Important finding): this HTTP path used to call
    // runReminderCron() unscoped, so any authenticated user could trigger a
    // GLOBAL reminder run (real emails, publicViewEnabled flips, lastSent
    // bumps for every tenant). Mirror the same ownership boundary
    // sendManualReminder uses (`reminder.createdBy !== requireUserId(req)`)
    // by passing the caller's scope through to the cron.
    const userId = requireUserId(req);
    console.log(`Manual trigger of invoice reminder cron requested (scoped to user ${userId})`);

    // Run the cron job, scoped to the caller.
    await cronModule.runReminderCron(userId);

    res.status(200).json({
      success: true,
      message: 'Invoice reminder cron job executed successfully',
      data: {
        executedAt: new Date().toISOString(),
        note: 'Check server logs for detailed execution results',
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Failed to execute invoice reminder cron',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

void VALID_REMINDER_TYPES; // referenced for completeness; suppresses unused warnings

// CommonJS interop for legacy JS routes
module.exports = {
  getReminders,
  getReminderById,
  createReminder,
  createReminderQuotation,
  updateReminder,
  updateReminderQuotation,
  deleteReminder,
  toggleReminderStatus,
  sendManualReminder,
  getRemindersByType,
  getReminderStats,
  getInvoicePlaceholders,
  getQuotationPlaceholders,
  triggerReminderCron,
};
module.exports.getReminders = getReminders;
module.exports.getReminderById = getReminderById;
module.exports.createReminder = createReminder;
module.exports.createReminderQuotation = createReminderQuotation;
module.exports.updateReminder = updateReminder;
module.exports.updateReminderQuotation = updateReminderQuotation;
module.exports.deleteReminder = deleteReminder;
module.exports.toggleReminderStatus = toggleReminderStatus;
module.exports.sendManualReminder = sendManualReminder;
module.exports.getRemindersByType = getRemindersByType;
module.exports.getReminderStats = getReminderStats;
module.exports.getInvoicePlaceholders = getInvoicePlaceholders;
module.exports.getQuotationPlaceholders = getQuotationPlaceholders;
module.exports.triggerReminderCron = triggerReminderCron;
