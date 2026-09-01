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
import { requireTenantId, UnauthorizedError, requireActingUserId } from '../lib/tenantScope';
import { resolveDefaultCurrencyCode } from '../lib/defaultCurrency';

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
async function fetchStoredDefaults(tenantId: string): Promise<Record<string, unknown> | null> {
  const row = await prisma.generalSetting.findUnique({
    where: { tenantId_key: { tenantId, key: 'document_defaults' } },
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
 * Merges a stored partial-defaults object with hard-coded fallbacks and the
 * company's default currency, producing the full DocumentDefaults shape.
 */
async function buildResponse(
  stored: Record<string, unknown> | null,
  tenantId: string,
): Promise<DocumentDefaults> {
  const currencyFallback = await resolveDefaultCurrencyCode(tenantId);

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
    const tenantId = requireTenantId(req);

    const stored = await fetchStoredDefaults(tenantId);
    const data = await buildResponse(stored, tenantId);

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
    const tenantId = requireTenantId(req);

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
    const existing = await fetchStoredDefaults(tenantId);
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
      where: { tenantId_key: { tenantId, key: 'document_defaults' } },
      create: {
        tenantId,
        key: 'document_defaults',
        groupSlug: 'documents',
        value: merged as Prisma.InputJsonValue,
        createdBy: requireActingUserId(req),
        updatedBy: requireActingUserId(req),
      },
      update: {
        groupSlug: 'documents',
        value: merged as Prisma.InputJsonValue,
        updatedBy: requireActingUserId(req),
      },
    });

    // Build response from the merged data (same fallback logic for consumers)
    const data = await buildResponse(merged, tenantId);

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
