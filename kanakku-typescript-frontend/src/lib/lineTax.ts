/**
 * Shared line-item tax utilities for invoice forms.
 *
 * Extracted from CreateInvoice.tsx / EditInvoice.tsx so that both forms use
 * identical logic and so the group-expand path can reuse the same engine.
 */

import axios from 'axios';
import Constants from '@constants/api';
import type { TaxRate, TaxLine } from '@models/taxRate';
import { round2 } from '@utils/round2';

/** Minimal line shape that recomputeLineTaxes needs. */
export interface LineTaxable {
    qty: number;
    rate: number;
    /** Absolute discount amount (already computed from discount_value / discount_type). */
    discount: number;
}

export interface RecomputeResult {
    taxes: TaxLine[];
    totalTax: number;
    /** Post-tax line total (taxable + totalTax). */
    amount: number;
}

/**
 * Given a line's taxable inputs and the full TaxRate rows that apply,
 * compute the per-component taxes[] split, totalTax, and line amount.
 *
 * Identical to the inline logic in CreateInvoice / EditInvoice —
 * kept here as the single source of truth.
 */
export function recomputeLineTaxes(
    line: LineTaxable,
    appliedRates: TaxRate[],
): RecomputeResult {
    const qty = Number(line.qty || 0);
    const rate = Number(line.rate || 0);
    const discount = Number(line.discount || 0);
    // Full-precision discounted base. The backend (lib/documentTotals.ts) taxes
    // the UNROUNDED (gross − discount) base and rounds each tax component to 2dp;
    // rounding the base first (e.g. 26.973 → 26.97) diverges from that by up to a
    // cent (26.97×18% = 4.85 vs 26.973×18% = 4.86). Do NOT round `base` here.
    const base = qty * rate - discount;

    const taxes: TaxLine[] = appliedRates.map((r) => ({
        taxRateId: r.id,
        name: r.name,
        kind: r.taxKind ?? null,
        percent: Number(r.rate),
        amount: round2((base * Number(r.rate)) / 100),
    }));

    const totalTax = round2(taxes.reduce((s, t) => s + t.amount, 0));
    const amount = round2(base + totalTax);

    return { taxes, totalTax, amount };
}

/**
 * Recompute an existing line's per-component tax amounts on a new discounted
 * base, PRESERVING each component's taxRateId/name/kind/percent. Used by the
 * edit-item modal: when qty/rate/discount change but the tax components were
 * already resolved (tax group / resolve-line endpoint), we must re-scale each
 * component rather than leave stale amounts. Mirrors the backend component path
 * exactly — round2(base × percent/100) per component, on the unrounded base.
 */
export function recomputeLineTaxesFromComponents(
    line: LineTaxable,
    components: TaxLine[],
): RecomputeResult {
    const base = Number(line.qty || 0) * Number(line.rate || 0) - Number(line.discount || 0);

    const taxes: TaxLine[] = components.map((t) => ({
        ...t,
        amount: round2((base * Number(t.percent)) / 100),
    }));

    const totalTax = round2(taxes.reduce((s, t) => s + t.amount, 0));
    const amount = round2(base + totalTax);

    return { taxes, totalTax, amount };
}

/**
 * Clamp a line's raw discount_value input to a valid range based on
 * discount_type, BEFORE it feeds the recompute pipeline (recomputeLineTaxes*
 * / documentTotals.ts on the backend). Percentage discounts are bounded to
 * [0, 100]; Fixed discounts are bounded to [0, qty*rate] (the line's pre-tax
 * subtotal) — matching backend lib/documentTotals.ts `lineDiscount`.
 *
 * Single source of truth for this clamp: used by both the edit-item modal
 * (CreateInvoice.tsx handleEditingItemChange) and the inline row input
 * (InvoiceTableRow.tsx handleManualChange) so the two paths can't drift.
 */
export function clampDiscountValue(
    value: number,
    type: 'Fixed' | 'Percentage' | undefined,
    qty: number,
    rate: number,
): number {
    const raw = Number(value) || 0;

    if (type === 'Percentage') {
        if (raw < 0) return 0;
        if (raw > 100) return 100;
        return raw;
    }

    const subtotal = Number(qty || 0) * Number(rate || 0);
    if (raw < 0) return 0;
    if (raw > subtotal) return subtotal;
    return raw;
}

/**
 * Convenience wrapper that accepts a library map (id → TaxRate) and
 * a list of applied rate IDs, resolves the TaxRate objects, then delegates
 * to recomputeLineTaxes. Returns null entries for IDs not found in the library.
 */
export function recomputeLineTaxesByIds(
    line: LineTaxable,
    appliedTaxRateIds: string[],
    taxRateLibrary: TaxRate[],
): RecomputeResult & { appliedTaxRateIds: string[] } {
    const appliedRates = appliedTaxRateIds
        .map((id) => taxRateLibrary.find((r) => r.id === id))
        .filter((r): r is TaxRate => !!r);

    return {
        ...recomputeLineTaxes(line, appliedRates),
        appliedTaxRateIds,
    };
}

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
    indexOffset = 0,
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

/**
 * Single-rate flat compute: one component = the rate row. Used when a line's
 * tax is a single TaxRate id (unified-tax model) and no server resolve result
 * is available (flat-path docs, or resolve-line fallback).
 */
export function applyFlatRateToLine(
    line: LineTaxable,
    rate: TaxRate | null,
): RecomputeResult & { appliedTaxRateIds: string[] } {
    if (!rate) {
        const base = Number(line.qty || 0) * Number(line.rate || 0) - Number(line.discount || 0);
        return { taxes: [], totalTax: 0, amount: round2(base), appliedTaxRateIds: [] };
    }
    return { ...recomputeLineTaxes(line, [rate]), appliedTaxRateIds: [rate.id] };
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
        const res = await axios.post(
            Constants.RESOLVE_LINE_TAX_URL,
            {
                taxableAmount: params.taxableAmount,
                taxRateId: params.taxRateId,
                ...(params.customerId ? { customerId: params.customerId } : {}),
                ...(params.supplierId ? { supplierId: params.supplierId } : {}),
            },
            { headers: { Authorization: `Bearer ${params.token}` } },
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
