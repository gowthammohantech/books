// Sanitizer for per-line custom-field bags travelling inside the items JSON of
// every document (items[n].customFields = { fieldSlug: value }). Server-side we
// only enforce shape/size — mandatory-ness is a client concern (parity with the
// header-level custom-field system). Silently drops junk; never throws.
const MAX_KEYS = 20;
const MAX_KEY_LENGTH = 64;
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 20;

export type LineCustomFieldValue = string | number | boolean | string[];

export function sanitizeLineCustomFields(
  raw: unknown,
): Record<string, LineCustomFieldValue> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, LineCustomFieldValue> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= MAX_KEYS) break;
    if (!key || key.length > MAX_KEY_LENGTH) continue;
    if (typeof value === 'string') {
      if (value.trim() === '' || value.length > MAX_STRING_LENGTH) continue;
      out[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (Array.isArray(value)) {
      const arr = value
        .filter((v): v is string => typeof v === 'string' && v.length <= MAX_STRING_LENGTH)
        .slice(0, MAX_ARRAY_LENGTH);
      if (arr.length === 0) continue;
      out[key] = arr;
    } else {
      continue;
    }
    kept += 1;
  }
  return kept > 0 ? out : undefined;
}
