/**
 * Line-item tax helpers for the document forms.
 *
 * The arithmetic moved to @elixirbooks/money — the same code the server uses to
 * compute the totals it persists. This file previously carried comments saying
 * it "mirrors the backend component path exactly"; that is now structural
 * rather than something a future edit has to remember.
 *
 * What remains here is what cannot be shared with a Node package:
 * `appendLineTaxFormData` builds a browser FormData, and `resolveLineTaxByRateId`
 * makes an HTTP call.
 */

import api from '@lib/apiClient';
import Constants from '@constants/api';
import type { TaxLine } from '@models/taxRate';

export {
  applyFlatRateToLine,
  clampDiscountValue,
  discountedBase,
  recomputeLineTaxes,
  recomputeLineTaxesByIds,
  recomputeLineTaxesFromComponents,
} from '@elixirbooks/money';
export type { LineTaxable, RecomputeResult } from '@elixirbooks/money';

/**
 * Serialize a list of line items (with taxes[] / appliedTaxRateIds) into a
 * multipart FormData under the `items[N][…]` key scheme expected by the API.
 *
 * Ported verbatim from CreateInvoice.tsx lines ~909-929.
 */
export function appendLineTaxFormData(
    formData: FormData,
    items: Array<{
        taxes?: TaxLine[];
        appliedTaxRateIds?: string[];
        [key: string]: unknown;
    }>,
    indexOffset = 0
): void {
    items.forEach((item, i) => {
        const index = indexOffset + i;
        Object.entries(item).forEach(([itemKey, itemValue]) => {
            if (itemValue === undefined || itemValue === null) return;

            if (itemKey === 'taxes' && Array.isArray(itemValue)) {
                (itemValue as TaxLine[]).forEach((t, tIdx) => {
                    formData.append(`items[${index}][taxes][${tIdx}][taxRateId]`, String(t.taxRateId));
                    formData.append(`items[${index}][taxes][${tIdx}][name]`, String(t.name));
                    formData.append(`items[${index}][taxes][${tIdx}][kind]`, t.kind ? String(t.kind) : '');
                    formData.append(`items[${index}][taxes][${tIdx}][percent]`, String(t.percent));
                    formData.append(`items[${index}][taxes][${tIdx}][amount]`, String(t.amount));
                });
                return;
            }

            if (itemKey === 'appliedTaxRateIds' && Array.isArray(itemValue)) {
                (itemValue as string[]).forEach((id, iIdx) => {
                    formData.append(`items[${index}][appliedTaxRateIds][${iIdx}]`, String(id));
                });
                return;
            }

            if (itemKey === 'customFields' && typeof itemValue === 'object' && !Array.isArray(itemValue)) {
                Object.entries(itemValue as Record<string, unknown>).forEach(([slug, cfValue]) => {
                    if (cfValue === undefined || cfValue === null) return;
                    if (typeof cfValue === 'string' && cfValue.trim() === '') return;
                    if (Array.isArray(cfValue)) {
                        cfValue.forEach((v, vIdx) => {
                            formData.append(`items[${index}][customFields][${slug}][${vIdx}]`, String(v));
                        });
                        return;
                    }
                    formData.append(`items[${index}][customFields][${slug}]`, String(cfValue));
                });
                return;
            }

            formData.append(`items[${index}][${itemKey}]`, String(itemValue));
        });
    });
}

export interface ResolvedLineTax {
    taxes: TaxLine[];
    totalTax: number;
    appliedTaxRateIds: string[];
    partyStateMissing: boolean;
}

/**
 * POST /admin/tax-engine/resolve-line with a single TaxRate id (contract C7). The
 * engine synthesizes state-aware components (CGST/SGST/IGST for kind-less
 * GST_INDIA rates, single component otherwise) with REAL taxRateIds — note
 * these may be engine-provisioned system rows NOT present in the C6 tax list,
 * so callers must persist/rescale via recomputeLineTaxesFromComponents, never
 * recomputeLineTaxesByIds against the library. Returns null on any failure so
 * callers can fall back to applyFlatRateToLine.
 */
export async function resolveLineTaxByRateId(params: {
    token: string;
    taxableAmount: number;
    taxRateId: string;
    customerId?: string;
    supplierId?: string;
}): Promise<ResolvedLineTax | null> {
    try {
        const res = await api.post(
            Constants.RESOLVE_LINE_TAX_URL,
            {
                taxableAmount: params.taxableAmount,
                taxRateId: params.taxRateId,
                ...(params.customerId ? { customerId: params.customerId } : {}),
                ...(params.supplierId ? { supplierId: params.supplierId } : {}),
            }
        );
        const data = res.data?.data;
        if (!data || !Array.isArray(data.taxes)) return null;
        return {
            taxes: data.taxes as TaxLine[],
            totalTax: Number(data.totalTax ?? 0),
            appliedTaxRateIds: (data.taxes as TaxLine[]).map((t) => t.taxRateId),
            partyStateMissing: !!data.partyStateMissing,
        };
    } catch {
        return null;
    }
}
