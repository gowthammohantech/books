// lib/ledger/dimensionSplit.spec.ts
import { describe, it, expect } from 'vitest';

import { splitNetByCentre } from './dimensionSplit';
import { toDecimal, sumDecimals } from './money';

const sum = (groups: { net: string }[]): string =>
  sumDecimals(groups.map((g) => toDecimal(g.net))).toFixed(4);

describe('splitNetByCentre', () => {
  it('returns [] when every line resolves to the header centre', () => {
    // The uniform case must stay byte-identical to the pre-feature posting, so
    // callers keep emitting their original single revenue leg.
    const groups = splitNetByCentre(
      [{ net: '100' }, { net: '50' }],
      'cc-sales',
      '150',
    );
    expect(groups).toEqual([]);
  });

  it('returns [] when every line explicitly repeats the header centre', () => {
    const groups = splitNetByCentre(
      [{ costCenterId: 'cc-sales', net: '100' }, { costCenterId: 'cc-sales', net: '50' }],
      'cc-sales',
      '150',
    );
    expect(groups).toEqual([]);
  });

  it('returns [] for an undimensioned document', () => {
    const groups = splitNetByCentre([{ net: '100' }], null, '100');
    expect(groups).toEqual([]);
  });

  it('groups lines by centre and sums each group', () => {
    const groups = splitNetByCentre(
      [
        { costCenterId: 'cc-a', net: '100' },
        { costCenterId: 'cc-b', net: '40' },
        { costCenterId: 'cc-a', net: '10' },
      ],
      'cc-a',
      '150',
    );
    expect(groups).toEqual([
      { costCenterId: 'cc-a', net: '110.0000' },
      { costCenterId: 'cc-b', net: '40.0000' },
    ]);
    expect(sum(groups)).toBe('150.0000');
  });

  it('lets a line inherit the header while a sibling overrides', () => {
    const groups = splitNetByCentre(
      [{ net: '100' }, { costCenterId: 'cc-b', net: '50' }],
      'cc-a',
      '150',
    );
    expect(groups).toEqual([
      { costCenterId: 'cc-a', net: '100.0000' },
      { costCenterId: 'cc-b', net: '50.0000' },
    ]);
  });

  it('treats an explicit null as untagged, not as inherit', () => {
    const groups = splitNetByCentre(
      [{ costCenterId: null, net: '60' }, { costCenterId: 'cc-b', net: '40' }],
      'cc-a',
      '100',
    );
    expect(groups.find((g) => g.costCenterId === null)?.net).toBe('60.0000');
    expect(groups.find((g) => g.costCenterId === 'cc-a')).toBeUndefined();
  });

  it('orders groups by centre id with the untagged group last', () => {
    // Deterministic ordering: a void-and-repost must reproduce the same line order.
    const groups = splitNetByCentre(
      [
        { costCenterId: 'cc-z', net: '10' },
        { costCenterId: null, net: '20' },
        { costCenterId: 'cc-a', net: '30' },
      ],
      'cc-a',
      '60',
    );
    expect(groups.map((g) => g.costCenterId)).toEqual(['cc-a', 'cc-z', null]);
  });

  it('folds a rounding residual into the header centre so the split reconciles exactly', () => {
    // Line nets are computed before document-level tax/discount adjustments, so
    // they routinely drift from the header total by a cent.
    const groups = splitNetByCentre(
      [{ costCenterId: 'cc-a', net: '33.33' }, { costCenterId: 'cc-b', net: '33.33' }],
      'cc-a',
      '66.67',
    );
    expect(sum(groups)).toBe('66.6700');
    expect(groups.find((g) => g.costCenterId === 'cc-a')?.net).toBe('33.3400');
    expect(groups.find((g) => g.costCenterId === 'cc-b')?.net).toBe('33.3300');
  });

  it('creates a header group for the residual when the header centre has no lines', () => {
    const groups = splitNetByCentre(
      [{ costCenterId: 'cc-b', net: '50' }, { costCenterId: 'cc-c', net: '49.99' }],
      'cc-a',
      '100',
    );
    expect(sum(groups)).toBe('100.0000');
    expect(groups.find((g) => g.costCenterId === 'cc-a')?.net).toBe('0.0100');
  });

  it('drops a centre whose own lines cancel out to zero', () => {
    // cc-b nets to zero (a line and its correcting reversal on the same
    // document); an empty leg carries no information, so it should not reach
    // the journal entry at all.
    const groups = splitNetByCentre(
      [
        { costCenterId: 'cc-a', net: '10' },
        { costCenterId: 'cc-b', net: '50' },
        { costCenterId: 'cc-b', net: '-50' },
      ],
      'cc-a',
      '10',
    );
    expect(groups.map((g) => g.costCenterId)).not.toContain('cc-b');
    expect(groups).toEqual([{ costCenterId: 'cc-a', net: '10.0000' }]);
    expect(sum(groups)).toBe('10.0000');
  });

  it('returns [] for an empty line list', () => {
    expect(splitNetByCentre([], 'cc-a', '0')).toEqual([]);
  });

  it('always reconciles to the net total across a range of drifts', () => {
    for (const total of ['99.99', '100.00', '100.01', '0.03', '12345.67']) {
      const groups = splitNetByCentre(
        [{ costCenterId: 'cc-a', net: '33.33' }, { costCenterId: 'cc-b', net: '33.33' }, { costCenterId: 'cc-c', net: '33.33' }],
        'cc-a',
        total,
      );
      expect(sum(groups)).toBe(toDecimal(total).toFixed(4));
    }
  });
});
