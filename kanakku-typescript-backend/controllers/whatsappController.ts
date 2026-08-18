import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { maskConfig, mergeAndEncryptConfig, WHATSAPP_SECRET_KEYS } from '../lib/configSecret';

function sanitizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, '').replace(/^\+/, '');
}

function waMeUrl(phone: string, message: string): string {
  const cleaned = sanitizePhone(phone);
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

export async function getConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const row = await prisma.messagingConfig.findUnique({ where: { userId } });
    res.json({
      success: true,
      data: {
        config: row
          ? {
              whatsappEnabled: row.whatsappEnabled,
              whatsappProvider: row.whatsappProvider,
              defaultTemplate: row.defaultTemplate,
              hasCredentials: !!row.whatsappConfig,
              // Per-field has* flags; secret values are never returned.
              whatsappConfig: maskConfig(row.whatsappConfig, WHATSAPP_SECRET_KEYS),
            }
          : { whatsappEnabled: false, whatsappProvider: null, defaultTemplate: null, hasCredentials: false },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) { res.status(401).json({ success: false, message: err.message }); return; }
    console.error('whatsapp getConfig error:', err);
    res.status(500).json({ success: false, message: 'Failed to load messaging config' });
  }
}

export async function upsertConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as {
      whatsappEnabled?: boolean;
      whatsappProvider?: string;
      whatsappConfig?: Record<string, unknown>;
      defaultTemplate?: string;
    };

    // Merge with stored config so a blank/omitted secret keeps the previously
    // stored (encrypted) value, and encrypt provider credentials at rest.
    const existing = await prisma.messagingConfig.findUnique({ where: { userId } });
    const encryptedConfig = mergeAndEncryptConfig(
      body.whatsappConfig ?? {},
      existing?.whatsappConfig,
      WHATSAPP_SECRET_KEYS,
    );
    const data = {
      whatsappEnabled: body.whatsappEnabled === true,
      whatsappProvider: body.whatsappProvider ?? null,
      whatsappConfig: encryptedConfig as Prisma.InputJsonValue,
      defaultTemplate: body.defaultTemplate ?? null,
    };

    const row = await prisma.messagingConfig.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    res.json({ success: true, message: 'Messaging config saved', data: { id: row.id } });
  } catch (err) {
    if (err instanceof UnauthorizedError) { res.status(401).json({ success: false, message: err.message }); return; }
    console.error('whatsapp upsertConfig error:', err);
    res.status(500).json({ success: false, message: 'Failed to save messaging config' });
  }
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as { phone?: string; message?: string };
    if (!body.phone || !body.message) {
      res.status(400).json({ success: false, message: 'phone + message required' });
      return;
    }

    const config = await prisma.messagingConfig.findUnique({ where: { userId } });
    if (!config?.whatsappEnabled || !config.whatsappProvider) {
      // v1 fallback: return the wa.me deep link
      res.json({
        success: true,
        data: {
          mode: 'fallback_link',
          waMeUrl: waMeUrl(body.phone, body.message),
        },
      });
      return;
    }

    // v2: post to provider (Twilio / WhatsApp Cloud API) — stubbed here.
    // mode: 'stub' marks this as a mock success, NOT a real provider send.
    res.json({
      success: true,
      data: {
        mode: 'stub',
        stub: true,
        provider: config.whatsappProvider,
        waMeUrl: waMeUrl(body.phone, body.message),
        note: 'Provider integration is stubbed in v1; returning wa.me URL as backup',
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) { res.status(401).json({ success: false, message: err.message }); return; }
    console.error('whatsapp sendMessage error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
}

export async function sendInvoiceWhatsapp(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { invoiceId } = req.params as { invoiceId: string };

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, userId, isDeleted: false },
      include: { billToCustomer: { select: { name: true, phone: true } } },
    });
    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const phone = invoice.billToCustomer?.phone;
    if (!phone) {
      res.status(400).json({ success: false, message: 'Customer has no phone number' });
      return;
    }

    const company = await prisma.companySettings.findUnique({ where: { userId } });
    const baseUrl = company?.publicBaseUrl ?? '';
    const link = invoice.publicViewToken && baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/invoice/${invoice.publicViewToken}`
      : '';

    const messageTemplate = (await prisma.messagingConfig.findUnique({ where: { userId } }))?.defaultTemplate
      ?? 'Hi {customer}, your invoice {invoiceNumber} for {amount} is ready. {link}';

    const message = messageTemplate
      .replace('{customer}', invoice.billToCustomer?.name ?? '')
      .replace('{invoiceNumber}', invoice.invoiceNumber ?? '')
      .replace('{amount}', String(invoice.TotalAmount ?? ''))
      .replace('{link}', link);

    res.json({
      success: true,
      data: {
        waMeUrl: waMeUrl(phone, message),
        phone,
        message,
        publicLink: link || null,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) { res.status(401).json({ success: false, message: err.message }); return; }
    console.error('whatsapp sendInvoiceWhatsapp error:', err);
    res.status(500).json({ success: false, message: 'Failed to compose invoice message' });
  }
}

const handlers = { getConfig, upsertConfig, sendMessage, sendInvoiceWhatsapp };
module.exports = handlers;
module.exports.default = handlers;
