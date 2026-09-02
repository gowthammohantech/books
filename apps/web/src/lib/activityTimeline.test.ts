import { describe, expect, it } from 'vitest';

import { dotClass, entryLabel, relativeTime } from './activityTimeline';
import type { ActivityEntry } from '@models/activity';

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'a1',
  action: 'created',
  entityType: 'Invoice',
  entityId: 'i1',
  entityLabel: null,
  summary: null,
  userName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const never = () => 'FORMATTED';

describe('relativeTime', () => {
  it('reports anything under a minute as "just now"', () => {
    expect(relativeTime(ago(0), never)).toBe('just now');
    expect(relativeTime(ago(59_000), never)).toBe('just now');
  });

  it('steps up through minutes, hours and days at each boundary', () => {
    expect(relativeTime(ago(60_000), never)).toBe('1m ago');
    expect(relativeTime(ago(59 * 60_000), never)).toBe('59m ago');
    expect(relativeTime(ago(60 * 60_000), never)).toBe('1h ago');
    expect(relativeTime(ago(23 * 3_600_000), never)).toBe('23h ago');
    expect(relativeTime(ago(24 * 3_600_000), never)).toBe('1d ago');
    expect(relativeTime(ago(29 * 86_400_000), never)).toBe('29d ago');
  });

  // The cutover to an absolute date is why formatDate is injected at all.
  it('hands anything 30 days or older to the tenant date formatter', () => {
    expect(relativeTime(ago(30 * 86_400_000), never)).toBe('FORMATTED');
    expect(relativeTime(ago(400 * 86_400_000), never)).toBe('FORMATTED');
  });

  // Behaviour as it stands, pinned rather than corrected: `new Date('x')` yields
  // NaN instead of throwing, every NaN comparison below is false, so an
  // unparseable date falls through to formatDate and the catch never runs. The
  // raw-value fallback the catch was written for is therefore unreachable.
  it('falls through to the date formatter on an unparseable date', () => {
    expect(relativeTime('not-a-date', never)).toBe('FORMATTED');
  });
});

describe('entryLabel', () => {
  it('prefers the server-written summary', () => {
    expect(entryLabel(entry({ summary: 'Payment of 100.00 recorded' }))).toBe(
      'Payment of 100.00 recorded',
    );
  });

  it('composes action and entity type when there is no summary', () => {
    expect(entryLabel(entry({ action: 'voided', entityType: 'Payment' }))).toBe('voided Payment');
  });

  it('falls back to a placeholder when both halves are empty', () => {
    expect(entryLabel(entry({ action: '', entityType: '' }))).toBe('Activity recorded');
  });
});

describe('dotClass', () => {
  it.each([
    ['voided', 'bg-destructive'],
    ['payment reversed', 'bg-destructive'], // reverse wins over payment — order matters
    ['payment recorded', 'bg-success'],
    ['marked paid', 'bg-success'],
    ['sent to customer', 'bg-info'],
    ['created', 'bg-gray-400'],
    ['status changed', 'bg-indigo-400'],
    ['something else', 'bg-chart-3'],
  ])('maps %s to %s', (action, expected) => {
    expect(dotClass(action)).toBe(expected);
  });

  it('is case-insensitive and survives a missing action', () => {
    expect(dotClass('VOIDED')).toBe('bg-destructive');
    expect(dotClass(undefined as unknown as string)).toBe('bg-chart-3');
  });
});
