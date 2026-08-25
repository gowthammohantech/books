/**
 * Document Defaults controller — D.1
 *
 * Two thin endpoints over the GeneralSetting key-value store:
 *   GET  /admin/document-defaults  → returns stored JSON merged with fallbacks
 *   PUT  /admin/document-defaults  → partial-merge upsert of document_defaults key
 *
 * Storage: key = 'document_defaults', groupSlug = 'documents', value = JSON object.
 */

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VALID_SIGN_TYPES = ['none', 'digitalSignature', 'eSignature'] as const;
type SignType = (typeof VALID_SIGN_TYPES)[number];

interface DocumentDefaults {
  defaultCurrencyCode: string | null;
  defaultSignType: SignType;
  defaultSignatureId: string | null;
  paymentTermsDays: number | null;
  defaultNotes: string;
  defaultTerms: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

/**
 * Reads the stored value for key='document_defaults' and returns it as a plain
 * object, or null when the row doesn't exist / the value isn't an object.
 */
async function fetchStoredDefaults(): Promise<Record<string, unknown> | null> {
  const row = await prisma.generalSetting.findUnique({
    where: { key: 'document_defaults' },
    select: { value: true },
  });
  if (!row) return null;
  const v = row.value;
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/**
 * Fetches the company's default currency code (first active default currency).
 */
async function fetchDefaultCurrencyCode(): Promise<string | null> {
  const currency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return currency?.code ?? null;
}

/**
 * Merges a stored partial-defaults object with hard-coded fallbacks and the
 * company's default currency, producing the full DocumentDefaults shape.
 */
async function buildResponse(
  stored: Record<string, unknown> | null,
): Promise<DocumentDefaults> {
  const currencyFallback = await fetchDefaultCurrencyCode();

  const signTypeRaw = stored?.defaultSignType;
  const defaultSignType: SignType =
    typeof signTypeRaw === 'string' &&
    (VALID_SIGN_TYPES as readonly string[]).includes(signTypeRaw)
      ? (signTypeRaw as SignType)
      : 'none';

  const paymentRaw = stored?.paymentTermsDays;
  let paymentTermsDays: number | null = null;
  if (typeof paymentRaw === 'number' && paymentRaw >= 0) {
    paymentTermsDays = paymentRaw;
  } else if (typeof paymentRaw === 'string') {
    const n = Number(paymentRaw);
    if (!isNaN(n) && n >= 0) paymentTermsDays = n;
  }

  const sigIdRaw = stored?.defaultSignatureId;
  const defaultSignatureId =
    typeof sigIdRaw === 'string' && sigIdRaw.length > 0 ? sigIdRaw : null;

  const defaultCurrencyCodeRaw = stored?.defaultCurrencyCode;
  const defaultCurrencyCode =
    typeof defaultCurrencyCodeRaw === 'string' && defaultCurrencyCodeRaw.length > 0
      ? defaultCurrencyCodeRaw
      : currencyFallback;

  return {
    defaultCurrencyCode,
    defaultSignType,
    defaultSignatureId,
    paymentTermsDays,
    defaultNotes: typeof stored?.defaultNotes === 'string' ? stored.defaultNotes : '',
    defaultTerms: typeof stored?.defaultTerms === 'string' ? stored.defaultTerms : '',
  };
}

// ---------------------------------------------------------------------------
// GET /admin/document-defaults
// ---------------------------------------------------------------------------

export async function getDocumentDefaults(req: Request, res: Response): Promise<void> {
  try {
    requireUserId(req); // auth check — throws UnauthorizedError if missing

    const stored = await fetchStoredDefaults();
    const data = await buildResponse(stored);

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching document defaults:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching document defaults',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// PUT /admin/document-defaults
// ---------------------------------------------------------------------------

export async function updateDocumentDefaults(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const body = req.body as Record<string, unknown>;

    // Validate defaultSignType if present
    if ('defaultSignType' in body) {
      if (!(VALID_SIGN_TYPES as readonly unknown[]).includes(body.defaultSignType)) {
        res.status(400).json({
          success: false,
          message: `defaultSignType must be one of: ${VALID_SIGN_TYPES.join(', ')}`,
        });
        return;
      }
    }

    // Coerce paymentTermsDays → non-negative number or null
    let paymentTermsDays: number | null | undefined;
    if ('paymentTermsDays' in body) {
      const raw = body.paymentTermsDays;
      if (raw === null || raw === undefined || raw === '') {
        paymentTermsDays = null;
      } else {
        const n = Number(raw);
        if (isNaN(n) || n < 0) {
          res.status(400).json({
            success: false,
            message: 'paymentTermsDays must be a non-negative number or null',
          });
          return;
        }
        paymentTermsDays = Math.floor(n);
      }
    }

    // Load the existing stored value for merge
    const existing = await fetchStoredDefaults();
    const merged: Record<string, unknown> = { ...(existing ?? {}) };

    // Apply incoming fields — only touch what the caller sent
    const allowedFields = [
      'defaultCurrencyCode',
      'defaultSignType',
      'defaultSignatureId',
      'defaultNotes',
      'defaultTerms',
    ] as const;

    for (const field of allowedFields) {
      if (field in body) {
        merged[field] = body[field];
      }
    }

    if ('paymentTermsDays' in body) {
      merged['paymentTermsDays'] = paymentTermsDays ?? null;
    }

    // Upsert into GeneralSetting
    await prisma.generalSetting.upsert({
      where: { key: 'document_defaults' },
      create: {
        key: 'document_defaults',
        groupSlug: 'documents',
        value: merged as Prisma.InputJsonValue,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        groupSlug: 'documents',
        value: merged as Prisma.InputJsonValue,
        updatedBy: userId,
      },
    });

    // Build response from the merged data (same fallback logic for consumers)
    const data = await buildResponse(merged);

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error updating document defaults:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating document defaults',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for JS routes
module.exports = { getDocumentDefaults, updateDocumentDefaults };
module.exports.getDocumentDefaults = getDocumentDefaults;
module.exports.updateDocumentDefaults = updateDocumentDefaults;
