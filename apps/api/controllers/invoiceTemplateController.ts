import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { requireTenantId, UnauthorizedError } from '../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function createOrUpdateTemplate(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { default_invoice_template } = req.body as { default_invoice_template?: string | number };
    const defaultTemplate = default_invoice_template !== undefined ? String(default_invoice_template) : undefined;

    const existing = await prisma.invoiceTemplate.findFirst({ where: { tenantId } });

    if (existing) {
      const template = await prisma.invoiceTemplate.update({
        where: { id: existing.id },
        data: { default_invoice_template: defaultTemplate ?? existing.default_invoice_template },
      });
      res.status(200).json({ success: true, message: 'Template updated successfully', data: template });
      return;
    }

    const template = await prisma.invoiceTemplate.create({
      data: {
        default_invoice_template: defaultTemplate ?? '',
        tenantId,
      },
    });
    res.status(201).json({ success: true, message: 'Template created successfully', data: template });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Template upsert error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err instanceof Error ? err.message : String(err) });
  }
}

export async function getMyTemplate(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const template = await prisma.invoiceTemplate.findFirst({ where: { tenantId } });
    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found for this user' });
      return;
    }
    res.status(200).json({ success: true, data: template });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get template error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err instanceof Error ? err.message : String(err) });
  }
}

export async function getAllTemplates(req: Request, res: Response): Promise<void> {
  try {
    // Scope to the authenticated user — prevents cross-tenant data leaks.
    const tenantId = requireTenantId(req);
    const templates = await prisma.invoiceTemplate.findMany({
      where: { tenantId },
      include: {
      },
    });
    res.status(200).json({ success: true, count: templates.length, data: templates });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get all templates error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err instanceof Error ? err.message : String(err) });
  }
}
