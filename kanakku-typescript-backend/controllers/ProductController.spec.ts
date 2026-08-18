import { describe, it, expect, vi } from 'vitest';

// ProductController imports the shared prisma client at module load; stub it so
// the pure helpers can be imported without a database.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

import { deriveItemType, parseBoolFlag } from './ProductController';

describe('deriveItemType — derivation matrix (spec 2026-07-12 §4A)', () => {
  it('omitted + enable_inventory on → Product', () => {
    expect(deriveItemType(undefined, true)).toBe('Product');
  });
  it('omitted + enable_inventory off → Service', () => {
    expect(deriveItemType(undefined, false)).toBe('Service');
  });
  it('explicit Product wins over inventory-off', () => {
    expect(deriveItemType('Product', false)).toBe('Product');
  });
  it('explicit Service wins over inventory-on', () => {
    expect(deriveItemType('Service', true)).toBe('Service');
  });
  it('garbage explicit value falls back to derivation', () => {
    expect(deriveItemType('Widget', true)).toBe('Product');
  });
});

describe('parseBoolFlag', () => {
  it('accepts multipart string forms', () => {
    expect(parseBoolFlag('true')).toBe(true);
    expect(parseBoolFlag('1')).toBe(true);
    expect(parseBoolFlag(true)).toBe(true);
    expect(parseBoolFlag('false')).toBe(false);
    expect(parseBoolFlag(undefined)).toBe(false);
  });
});
