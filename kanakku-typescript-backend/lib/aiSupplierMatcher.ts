/**
 * Supplier auto-matcher for the AI bill extraction flow (Cluster H,
 * slice H.2). Given an extracted vendor name + optional GSTIN, find the
 * best matching `Supplier` row for the user.
 *
 * Strategy:
 *   1. GSTIN exact match wins outright (we treat GSTIN as authoritative).
 *      The current `Supplier` model doesn't carry a GSTIN column, but the
 *      matcher accepts one in case it's added later; for now the GSTIN
 *      branch is a no-op pass-through.
 *   2. Otherwise compute a Levenshtein ratio against `supplier_name` for
 *      every active supplier owned by the user. Return the highest scorer
 *      if score >= 0.85.
 *
 * Returns `{ matchType: 'none' }` when nothing meets the threshold so the
 * frontend can prompt the user to confirm "create new supplier".
 */
import { distance } from 'fastest-levenshtein';

import { prisma } from './prisma';

export interface ExtractedVendor {
  vendorName?: string | null;
  vendorGstin?: string | null;
}

export interface SupplierMatch {
  supplierId?: string;
  supplierName?: string;
  matchType: 'gstin' | 'fuzzy' | 'none';
  score?: number;
}

const FUZZY_THRESHOLD = 0.85;

function levenshteinRatio(a: string, b: string): number {
  const lower = (s: string) => s.toLowerCase().trim();
  const aa = lower(a);
  const bb = lower(b);
  if (!aa || !bb) return 0;
  const maxLen = Math.max(aa.length, bb.length);
  if (maxLen === 0) return 1;
  const d = distance(aa, bb);
  return 1 - d / maxLen;
}

export async function matchSupplier(
  extracted: ExtractedVendor,
  userId: string,
): Promise<SupplierMatch> {
  const vendorName = (extracted.vendorName ?? '').trim();
  // const vendorGstin = (extracted.vendorGstin ?? '').trim();

  // GSTIN match: `Supplier` doesn't currently store a GSTIN, so this is
  // intentionally a no-op until a future migration adds the column. The
  // matchType is still part of the contract so the frontend can branch.
  // When the column lands, swap to: prisma.supplier.findFirst({ where:
  // { user_id: userId, supplier_gstin: vendorGstin } })

  if (!vendorName) {
    return { matchType: 'none' };
  }

  const suppliers = await prisma.supplier.findMany({
    where: { user_id: userId, isDeleted: false, status: true },
    select: { id: true, supplier_name: true },
  });

  let best: { id: string; name: string; score: number } | null = null;
  for (const s of suppliers) {
    const score = levenshteinRatio(vendorName, s.supplier_name);
    if (!best || score > best.score) {
      best = { id: s.id, name: s.supplier_name, score };
    }
  }

  if (best && best.score >= FUZZY_THRESHOLD) {
    return {
      supplierId: best.id,
      supplierName: best.name,
      matchType: 'fuzzy',
      score: best.score,
    };
  }

  return { matchType: 'none', score: best?.score };
}
