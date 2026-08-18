import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import type { EmailTemplateStatus, NotificationTypeStatus } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';

// Same generation scheme as invoiceController.ts's enablePublicLink (64-char hex).
function generatePublicToken(): string {
  return randomBytes(32).toString('hex');
}

interface CreateEmailTemplateBody {
  title?: string;
  // Note: the JS source uses `notification_type`; we accept that and the
  // Prisma-native `notificationTypeId` for forward-compat.
  notification_type?: string;
  notificationTypeId?: string;
  description?: string;
  subject?: string;
  sms_content?: string;
  notification_content?: string;
  status?: EmailTemplateStatus;
}

// =============================================================================
// Email Templates
// =============================================================================

export async function createEmailTemplate(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as CreateEmailTemplateBody;
    const {
      title,
      description,
      subject,
      sms_content,
      notification_content,
      status = 'active',
    } = body;
    const notificationTypeId = body.notification_type ?? body.notificationTypeId;

    if (!title || !notificationTypeId || !subject) {
      res.status(400).json({
        success: false,
        message: 'Title, notification_type, and subject are required',
      });
      return;
    }

    const notificationTypeExists = await prisma.notificationType.findUnique({
      where: { id: notificationTypeId },
    });
    if (!notificationTypeExists) {
      res.status(404).json({
        success: false,
        message: 'Notification type not found',
      });
      return;
    }

    const emailTemplate = await prisma.emailTemplate.create({
      data: {
        title,
        notificationTypeId,
        description,
        subject,
        sms_content,
        notification_content,
        status: status as EmailTemplateStatus,
      },
    });

    // Only one active template per notification type drives sending — if this
    // one is active, deactivate its siblings of the same type.
    if (emailTemplate.status === 'active') {
      await prisma.emailTemplate.updateMany({
        where: { notificationTypeId, status: 'active', id: { not: emailTemplate.id } },
        data: { status: 'inactive' },
      });
    }

    res.status(201).json({
      success: true,
      message: 'Email template created successfully',
      data: emailTemplate,
    });
  } catch (err) {
    console.error('Email template creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating email template',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listEmailTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { page = '1', limit = '10', search = '', status } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      status?: EmailTemplateStatus;
    };

    const pageNum = Number(page);
    const limitNum = Number(limit);

    const where: Prisma.EmailTemplateWhereInput = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [total, templates] = await Promise.all([
      prisma.emailTemplate.count({ where }),
      prisma.emailTemplate.findMany({
        where,
        include: {
          notificationType: { select: { id: true, title: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    // Expose the relation as `notification_type` too — the frontend (and its
    // EmailTemplate type) reads `notification_type`, while Prisma names it
    // `notificationType`. Keeping both avoids an edit-modal crash.
    const mapped = templates.map((t) => ({
      ...t,
      notification_type: (t as { notificationType?: unknown }).notificationType,
    }));

    res.status(200).json({
      success: true,
      message: 'Email templates fetched successfully',
      data: {
        templates: mapped,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (err) {
    console.error('Error fetching email templates:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching email templates',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateEmailTemplate(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const body = req.body as CreateEmailTemplateBody;
    const updates: Prisma.EmailTemplateUncheckedUpdateInput = { ...body };

    // Translate notification_type (legacy) → notificationTypeId for Prisma.
    const incomingNotificationTypeId =
      body.notification_type ?? body.notificationTypeId ?? undefined;
    delete (updates as Record<string, unknown>).notification_type;
    delete (updates as Record<string, unknown>).notificationTypeId;

    if (incomingNotificationTypeId) {
      const notificationTypeExists = await prisma.notificationType.findUnique({
        where: { id: incomingNotificationTypeId },
      });
      if (!notificationTypeExists) {
        res.status(404).json({
          success: false,
          message: 'Notification type not found',
        });
        return;
      }
      updates.notificationTypeId = incomingNotificationTypeId;
    }

    const existing = await prisma.emailTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Email template not found',
      });
      return;
    }

    const updatedTemplate = await prisma.emailTemplate.update({
      where: { id },
      data: updates,
    });

    // Enforce one active template per notification type (activating one
    // deactivates the others of the same type).
    if (updatedTemplate.status === 'active') {
      await prisma.emailTemplate.updateMany({
        where: {
          notificationTypeId: updatedTemplate.notificationTypeId,
          status: 'active',
          id: { not: updatedTemplate.id },
        },
        data: { status: 'inactive' },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Email template updated successfully',
      data: updatedTemplate,
    });
  } catch (err) {
    console.error('Error updating email template:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating email template',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteEmailTemplate(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.emailTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Email template not found',
      });
      return;
    }

    await prisma.emailTemplate.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Email template deleted successfully',
    });
  } catch (err) {
    console.error('Error deleting email template:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting email template',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Notification Types (helper endpoint that lives in this controller file)
// =============================================================================

export async function listNotificationTypes(req: Request, res: Response): Promise<void> {
  try {
    const { search = '', status, tagId } = req.query as {
      search?: string;
      status?: NotificationTypeStatus;
      tagId?: string;
    };

    const where: Prisma.NotificationTypeWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    if (tagId) {
      where.tags = { some: { notificationTagId: tagId } };
    }

    const data = await prisma.notificationType.findMany({
      where,
      include: {
        tags: {
          include: {
            notificationTag: { select: { id: true, title: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Flatten the join to mirror Mongoose `.populate('tags', 'title status')`.
    const flattened = data.map((nt) => ({
      ...nt,
      tags: nt.tags.map((joinRow) => joinRow.notificationTag),
    }));

    res.status(200).json({
      success: true,
      message: 'Notification types fetched successfully',
      data: flattened,
      count: flattened.length,
    });
  } catch (err) {
    console.error('Error fetching notification types:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching notification types',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Template rendering — resolve the active template for a document type and
// substitute {Tag} merge fields with the document's real values. Used by the
// invoice/quotation email screens to prefill subject + body.
// =============================================================================

function fmtMoney(amount: unknown, code?: string | null): string {
  const c = (code || 'USD').toString().toUpperCase();
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  } catch {
    return `${c} ${n.toFixed(2)}`;
  }
}
function fmtDate(d: unknown): string {
  if (!d) return '';
  const date = new Date(d as string);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function humanizeStatus(s: unknown): string {
  return String(s ?? '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function applyPlaceholders(text: string | null | undefined, map: Record<string, string>): string {
  let out = text ?? '';
  for (const [key, value] of Object.entries(map)) {
    // Tags are plain words/spaces — escape just in case, then replace {Tag} globally.
    const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\{\\s*${safe}\\s*\\}`, 'g'), value);
  }
  return out;
}

function appBaseUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/+$/, '');
}

// Prefer the tenant's own configured public base URL (CompanySettings.publicBaseUrl
// — the same field the invoice QR/"Scan to view online" link already uses) over the
// server-wide FRONTEND_URL fallback, so a per-tenant domain/port is respected.
function resolvePublicBaseUrl(companyPublicBaseUrl?: string | null): string {
  return (companyPublicBaseUrl || appBaseUrl()).replace(/\/+$/, '');
}

async function activeTemplateForSlug(slug: string) {
  return prisma.emailTemplate.findFirst({
    where: { status: 'active', notificationType: { slug } },
    orderBy: { updatedAt: 'desc' },
  });
}

async function buildInvoiceMap(invoiceId: string): Promise<Record<string, string> | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      billToCustomer: true,
      customer: true,
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
      payments: { where: { isVoided: false } },
    },
  });
  if (!invoice) return null;
  const company = await prisma.companySettings.findFirst({ orderBy: { createdAt: 'desc' } });
  // Contact-first party resolution (matches getPurchaseReport / getIncomeStats):
  // prefer the unified Contact, then the bill-to Contact, then the legacy Customer.
  // New-flow invoices set contactId but leave the legacy `customer` null, so
  // reading only `customer` left "Customer Name" blank in the merged email.
  const party = invoice.contact ?? invoice.billToContact ?? null;
  const legacy = invoice.billToCustomer ?? invoice.customer;
  const customerName = (party ? resolveDisplayName(party) : '') || legacy?.name || '';
  const total = Number(invoice.TotalAmount ?? 0);
  const paid = (invoice.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  // The link must point at the PUBLIC, token-gated viewer (/invoice/:token) —
  // not the staff-only /admin/view-invoice/:id route, which 404s/redirects to
  // login for an external recipient with no account. Enable the public view +
  // generate a token if this invoice doesn't already have one (mirrors
  // invoiceController.ts's enablePublicLink).
  let publicViewToken = invoice.publicViewToken;
  if (!publicViewToken) {
    publicViewToken = generatePublicToken();
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { publicViewToken, publicViewEnabled: true },
    });
  } else if (!invoice.publicViewEnabled) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { publicViewEnabled: true } });
  }
  const viewInvoiceLink = `${resolvePublicBaseUrl(company?.publicBaseUrl)}/invoice/${publicViewToken}`;
  return {
    'Customer Name': customerName,
    'Company Name': company?.companyName ?? '',
    'Invoice Number': invoice.invoiceNumber ?? '',
    'Invoice Date': fmtDate(invoice.invoiceDate),
    'Due Date': fmtDate(invoice.dueDate),
    'Invoice Amount': fmtMoney(total, invoice.currencyCode),
    'Invoice Status': humanizeStatus(invoice.status),
    'Amount Paid': fmtMoney(paid, invoice.currencyCode),
    'Balance Due': fmtMoney(total - paid, invoice.currencyCode),
    'View Invoice Link': viewInvoiceLink,
  };
}

async function buildQuotationMap(quotationId: string): Promise<Record<string, string> | null> {
  const q = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      billToCustomer: true,
      customer: true,
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
  if (!q) return null;
  const company = await prisma.companySettings.findFirst({ orderBy: { createdAt: 'desc' } });
  // Contact-first party resolution — see buildInvoiceMap above.
  const party = q.contact ?? q.billToContact ?? null;
  const legacy = q.billToCustomer ?? q.customer;
  const customerName = (party ? resolveDisplayName(party) : '') || legacy?.name || '';

  // The link must point at the PUBLIC, token-gated viewer (/quotation/:token) —
  // not the staff-only /admin/view-quotation/:id route, which 404s/redirects to
  // login for an external recipient with no account. Enable the public view +
  // generate a token if this quotation doesn't already have one (mirrors
  // buildInvoiceMap above / invoiceController.ts's enablePublicLink).
  let publicViewToken = q.publicViewToken;
  if (!publicViewToken) {
    publicViewToken = generatePublicToken();
    await prisma.quotation.update({
      where: { id: q.id },
      data: { publicViewToken, publicViewEnabled: true },
    });
  } else if (!q.publicViewEnabled) {
    await prisma.quotation.update({ where: { id: q.id }, data: { publicViewEnabled: true } });
  }
  const viewQuotationLink = `${resolvePublicBaseUrl(company?.publicBaseUrl)}/quotation/${publicViewToken}`;

  return {
    'Customer Name': customerName,
    'Company Name': company?.companyName ?? '',
    'Quotation Number': q.quotationId ?? '',
    'Quotation Date': fmtDate(q.quotationDate),
    'Expiry Date': fmtDate(q.expiryDate),
    'Quotation Amount': fmtMoney(q.TotalAmount, q.currencyCode),
    'View Quotation Link': viewQuotationLink,
  };
}

/**
 * GET /admin/email-template/resolve/:docType/:id
 * docType: 'invoice' | 'quotation'
 * Returns { hasTemplate, subject, html } — the active template for that
 * document type with merge fields filled. hasTemplate=false → caller uses its
 * own built-in default body.
 */
export async function resolveDocumentTemplate(req: Request, res: Response): Promise<void> {
  try {
    const { docType, id } = req.params as { docType: string; id: string };
    const slugByType: Record<string, string> = {
      invoice: 'invoice-generated',
      quotation: 'new-quotation-created',
    };
    const slug = slugByType[docType];
    if (!slug) {
      res.status(400).json({ success: false, message: `Unsupported document type: ${docType}` });
      return;
    }

    const template = await activeTemplateForSlug(slug);
    if (!template) {
      res.status(200).json({ success: true, data: { hasTemplate: false, subject: '', html: '' } });
      return;
    }

    const map = docType === 'invoice' ? await buildInvoiceMap(id) : await buildQuotationMap(id);
    if (!map) {
      res.status(404).json({ success: false, message: `${docType} not found` });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        hasTemplate: true,
        subject: applyPlaceholders(template.subject, map),
        html: applyPlaceholders(template.description, map),
      },
    });
  } catch (err) {
    console.error('resolveDocumentTemplate error:', err);
    res.status(500).json({
      success: false,
      message: 'Error resolving email template',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
  listNotificationTypes,
  deleteEmailTemplate,
  resolveDocumentTemplate,
};
module.exports.createEmailTemplate = createEmailTemplate;
module.exports.listEmailTemplates = listEmailTemplates;
module.exports.updateEmailTemplate = updateEmailTemplate;
module.exports.listNotificationTypes = listNotificationTypes;
module.exports.deleteEmailTemplate = deleteEmailTemplate;
module.exports.resolveDocumentTemplate = resolveDocumentTemplate;
