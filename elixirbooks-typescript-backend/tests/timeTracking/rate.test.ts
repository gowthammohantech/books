/**
 * tests/timeTracking/rate.test.ts
 *
 * Unit tests for resolveEntryRate — the precedence rule member > project > 0.
 * Pure function, no prisma, no DB.
 */

import { describe, it, expect } from 'vitest';
import { resolveEntryRate } from '../../lib/timeTracking/rate';

describe('resolveEntryRate', () => {
  it('uses the member rate when present', () => {
    expect(resolveEntryRate({ memberRate: 50, projectRate: 40 })).toBe(50);
    expect(resolveEntryRate({ memberRate: 50 })).toBe(50);
  });

  it('falls through to the project rate when the member rate is absent', () => {
    expect(resolveEntryRate({ memberRate: null, projectRate: 40 })).toBe(40);
    expect(resolveEntryRate({ projectRate: 40 })).toBe(40);
    expect(resolveEntryRate({ memberRate: undefined, projectRate: 40 })).toBe(40);
  });

  it('returns 0 when both are absent', () => {
    expect(resolveEntryRate({ memberRate: null, projectRate: null })).toBe(0);
    expect(resolveEntryRate({})).toBe(0);
  });

  it('treats an explicit 0 as a real value, not absence', () => {
    // member 0 wins over project 40 (explicitly free for this member)
    expect(resolveEntryRate({ memberRate: 0, projectRate: 40 })).toBe(0);
    // member absent, project explicitly 0 -> 0
    expect(resolveEntryRate({ memberRate: null, projectRate: 0 })).toBe(0);
  });
});
