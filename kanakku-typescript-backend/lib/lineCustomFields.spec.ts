import { describe, it, expect } from 'vitest';
import { sanitizeLineCustomFields } from './lineCustomFields';

describe('sanitizeLineCustomFields', () => {
  it('returns undefined for non-objects', () => {
    expect(sanitizeLineCustomFields(undefined)).toBeUndefined();
    expect(sanitizeLineCustomFields(null)).toBeUndefined();
    expect(sanitizeLineCustomFields('hsn')).toBeUndefined();
    expect(sanitizeLineCustomFields(['a'])).toBeUndefined();
  });

  it('keeps string/number/boolean/string[] values', () => {
    expect(sanitizeLineCustomFields({
      hsn_code: '8471', qty_boxes: 4, fragile: true, colors: ['red', 'blue'],
    })).toEqual({ hsn_code: '8471', qty_boxes: 4, fragile: true, colors: ['red', 'blue'] });
  });

  it('drops empty/oversized strings, non-finite numbers, nested objects, bad keys', () => {
    expect(sanitizeLineCustomFields({
      empty: '   ',
      long: 'x'.repeat(513),
      inf: Infinity,
      nested: { a: 1 },
      ['k'.repeat(65)]: 'v',
      ok: 'keep',
    })).toEqual({ ok: 'keep' });
  });

  it('filters array entries to strings <= 512 chars and caps at 20 entries', () => {
    const arr = Array.from({ length: 30 }, (_, i) => `v${i}`);
    const out = sanitizeLineCustomFields({ tags: [...arr, 42 as unknown as string, 'x'.repeat(513)] });
    expect(out?.tags).toEqual(arr.slice(0, 20));
  });

  it('caps at 20 keys and returns undefined when nothing survives', () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, 'v']));
    expect(Object.keys(sanitizeLineCustomFields(many) ?? {})).toHaveLength(20);
    expect(sanitizeLineCustomFields({ junk: { nested: true } })).toBeUndefined();
  });
});
