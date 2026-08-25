// controllers/recurringScheduleController.spec.ts
//
// FIX (final whole-branch review, Important): create/update on recurring
// schedules persisted body.items as a raw JSON passthrough, so junk (nested
// objects, oversized strings, etc.) under items[n].customFields survived
// straight into the schedule row and then propagated verbatim into every
// generated invoice (lib/recurringInvoiceRunner.ts copies items as-is).
// sanitizeScheduleItems runs each row's customFields through the same
// server-wide line-bag contract (lib/lineCustomFields.sanitizeLineCustomFields)
// used elsewhere, while leaving the rest of the row untouched.
import { describe, it, expect } from 'vitest';
import { sanitizeScheduleItems } from './recurringScheduleController';

describe('sanitizeScheduleItems', () => {
  it('passes through non-array input untouched', () => {
    expect(sanitizeScheduleItems(undefined)).toBeUndefined();
    expect(sanitizeScheduleItems(null)).toBeNull();
    expect(sanitizeScheduleItems('not-an-array')).toBe('not-an-array');
  });

  it('leaves non-object rows (and rows without customFields) untouched', () => {
    expect(sanitizeScheduleItems([null, 'x', 5, { name: 'Pen', qty: 2 }])).toEqual([
      null, 'x', 5, { name: 'Pen', qty: 2 },
    ]);
  });

  it('sanitizes customFields on each row, preserving the rest of the row', () => {
    const out = sanitizeScheduleItems([
      {
        name: 'Widget',
        qty: 3,
        customFields: { hsn_code: '8471', junk: { nested: true }, empty: '   ' },
      },
    ]);
    expect(out).toEqual([{ name: 'Widget', qty: 3, customFields: { hsn_code: '8471' } }]);
  });

  it('drops the customFields key entirely when nothing survives sanitization', () => {
    const out = sanitizeScheduleItems([
      { name: 'Widget', qty: 3, customFields: { junk: { nested: true } } },
    ]);
    expect(out).toEqual([{ name: 'Widget', qty: 3 }]);
    expect((out as Array<Record<string, unknown>>)[0]).not.toHaveProperty('customFields');
  });
});
