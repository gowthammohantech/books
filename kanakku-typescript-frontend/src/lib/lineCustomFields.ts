// Shared helpers for line-item custom fields (custom columns in document item
// tables). Values live per row as item.customFields = { fieldSlug: value }.

export interface LineCustomField {
    id: string;
    labelName: string;
    fieldSlug: string;
    isMandatory: boolean;
    placement?: string;
    status?: string;
    options?: Array<{ label: string; value: string }>;
    dataType?: { id: string; name: string; slug?: string };
    createdAt?: string;
}

export type LineCustomFieldValues = Record<string, string | number | boolean | string[]>;

const isBlank = (v: unknown): boolean =>
    v === undefined || v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);

export function humanizeSlug(slug: string): string {
    return slug
        .split(/[_-]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export interface LineCustomColumn {
    slug: string;
    label: string;
    field?: LineCustomField;
}

export function collectLineCustomColumns(
    items: Array<{ customFields?: Record<string, unknown> | null }> | undefined | null,
    fields?: LineCustomField[],
): LineCustomColumn[] {
    const present = new Set<string>();
    const encounterOrder: string[] = [];
    (items ?? []).forEach((item) => {
        Object.entries(item?.customFields ?? {}).forEach(([slug, value]) => {
            if (isBlank(value)) return;
            if (!present.has(slug)) {
                present.add(slug);
                encounterOrder.push(slug);
            }
        });
    });
    const defs = fields ?? [];
    // Definition order first, then orphan slugs (no live definition — e.g. a
    // since-deleted field whose stored values must keep printing).
    const definedSlugs = defs
        .map((f) => f.fieldSlug)
        .filter((slug, i, arr) => present.has(slug) && arr.indexOf(slug) === i);
    const orphanSlugs = encounterOrder.filter((slug) => !defs.some((f) => f.fieldSlug === slug));
    return [...definedSlugs, ...orphanSlugs].map((slug) => {
        const field = defs.find((f) => f.fieldSlug === slug);
        return { slug, label: field?.labelName ?? humanizeSlug(slug), field };
    });
}

export function pickMatchingLineFieldValues(
    productCustomFields: Record<string, unknown> | undefined | null,
    lineFields: LineCustomField[],
): LineCustomFieldValues {
    const out: LineCustomFieldValues = {};
    lineFields.forEach((f) => {
        const v = productCustomFields?.[f.fieldSlug];
        if (isBlank(v)) return;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[f.fieldSlug] = v;
        else if (Array.isArray(v)) out[f.fieldSlug] = v.map(String);
    });
    return out;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date (YYYY-MM-DD, as stored by the row's <input type="date">) →
 *  "17 Jul 2026". Anything non-ISO passes through untouched. */
export function formatLineFieldDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return value;
    const month = MONTH_ABBR[Number(m[2]) - 1];
    if (!month) return value;
    return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Display form of a stored line custom-field value: '-' for blanks,
 *  option labels for dropdown/radio stored values, D MMM YYYY for datepicker
 *  ISO dates, comma-joined arrays. Falls back to String(value). */
export function formatLineFieldValue(value: unknown, field?: LineCustomField): string {
    if (isBlank(value)) return '-';
    const optionLabel = (v: unknown): string => {
        const s = String(v);
        const opt = field?.options?.find((o) => o.value === s);
        return opt?.label ?? s;
    };
    if (Array.isArray(value)) return value.map(optionLabel).join(', ');
    if (field?.dataType?.slug === 'datepicker' && typeof value === 'string') {
        return formatLineFieldDate(value);
    }
    return optionLabel(value);
}

/** Autofill bag when a product is picked into a row: matching-slug product
 *  values first, overlaid by the row's existing values (manual edits win).
 *  Returns {} when there is nothing to carry. */
export function mergeLineFieldAutofill(
    productCustomFields: Record<string, unknown> | undefined | null,
    existingRowValues: LineCustomFieldValues | undefined | null,
    lineFields: LineCustomField[],
): LineCustomFieldValues {
    return {
        ...pickMatchingLineFieldValues(productCustomFields, lineFields),
        ...(existingRowValues ?? {}),
    };
}

/** Header (document-placed) fields only — lineItem-placed fields render as
 *  item-table columns, never in the header Additional Details section. */
export function excludeLineItemFields<T extends { placement?: string }>(fields: T[]): T[] {
    return fields.filter((f) => f.placement !== 'lineItem');
}

export function validateLineCustomFields(
    items: Array<{ name?: string; customFields?: Record<string, unknown> | null }>,
    lineFields: LineCustomField[],
    docCreatedAt?: string | null,
): string | null {
    const docTime = docCreatedAt ? Date.parse(docCreatedAt) : NaN;
    const mandatory = lineFields.filter((f) => {
        if (!f.isMandatory) return false;
        // Grandfather: a mandatory field defined AFTER this document existed
        // must not block edits of the older document.
        if (Number.isFinite(docTime) && f.createdAt) {
            const fieldTime = Date.parse(f.createdAt);
            if (Number.isFinite(fieldTime) && fieldTime > docTime) return false;
        }
        return true;
    });
    if (mandatory.length === 0) return null;
    for (const item of items) {
        if ((item.name ?? '').trim() === '') continue; // blank rows are filtered out before submit
        for (const f of mandatory) {
            if (isBlank(item.customFields?.[f.fieldSlug])) {
                return `${f.labelName} is required for item "${item.name}".`;
            }
        }
    }
    return null;
}
