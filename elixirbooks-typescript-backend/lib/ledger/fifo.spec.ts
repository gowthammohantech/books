// lib/ledger/fifo.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { consumeFifo, type Layer } from './fifo';

const D = (v: string) => new Prisma.Decimal(v);

function makeLayer(id: string, qty: string, cost: string, offsetMs = 0): Layer {
  return {
    id,
    qtyRemaining: qty,
    unitCost: cost,
    receivedAt: new Date(1000 + offsetMs),
  };
}

// Convenience: assert string equals Decimal value to 4dp
function eq4(actual: string, expected: string): boolean {
  return new Prisma.Decimal(actual).equals(new Prisma.Decimal(expected));
}

// ---------------------------------------------------------------------------
// Single-layer partial consumption
// ---------------------------------------------------------------------------
describe('consumeFifo — single-layer partial', () => {
  it('consumes part of one layer; layer has remaining qty', () => {
    const layers: Layer[] = [makeLayer('L1', '10', '5.0000', 0)];
    const result = consumeFifo(layers, '4');

    expect(eq4(result.cogs, '20.0000')).toBe(true);           // 4 × 5 = 20
    expect(result.consumed).toHaveLength(1);
    expect(result.consumed[0].layerId).toBe('L1');
    expect(eq4(result.consumed[0].qty, '4.0000')).toBe(true);

    // remaining layer has qtyRemaining = 6
    const updated = result.remainingLayers.find((l) => l.id === 'L1')!;
    expect(eq4(String(updated.qtyRemaining), '6.0000')).toBe(true);
  });

  it('zero qty returns zero COGS and no consumed records', () => {
    const layers: Layer[] = [makeLayer('L1', '10', '5.0000', 0)];
    const result = consumeFifo(layers, '0');
    expect(eq4(result.cogs, '0.0000')).toBe(true);
    expect(result.consumed).toHaveLength(0);
    expect(eq4(String(result.remainingLayers[0].qtyRemaining), '10.0000')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Two-layer blended COGS
// ---------------------------------------------------------------------------
describe('consumeFifo — two-layer blended COGS', () => {
  it('spans two layers oldest-first with correct blended COGS', () => {
    // L1 (older): 5 units @ 10  → 50
    // L2 (newer): 5 units @ 20  → 100
    // Consume 7 units → takes 5 from L1 + 2 from L2 = 50 + 40 = 90
    const layers: Layer[] = [
      makeLayer('L1', '5', '10.0000', 0),   // older
      makeLayer('L2', '5', '20.0000', 100), // newer
    ];
    const result = consumeFifo(layers, '7');

    expect(eq4(result.cogs, '90.0000')).toBe(true);
    expect(result.consumed).toHaveLength(2);

    // First consumed record — L1 fully consumed
    const c1 = result.consumed.find((c) => c.layerId === 'L1')!;
    expect(c1).toBeDefined();
    expect(eq4(c1.qty, '5.0000')).toBe(true);

    // Second consumed record — L2 partially consumed
    const c2 = result.consumed.find((c) => c.layerId === 'L2')!;
    expect(c2).toBeDefined();
    expect(eq4(c2.qty, '2.0000')).toBe(true);

    // L1 depleted, L2 has 3 remaining
    const l1 = result.remainingLayers.find((l) => l.id === 'L1')!;
    const l2 = result.remainingLayers.find((l) => l.id === 'L2')!;
    expect(eq4(String(l1.qtyRemaining), '0.0000')).toBe(true);
    expect(eq4(String(l2.qtyRemaining), '3.0000')).toBe(true);
  });

  it('processes layers in receivedAt order regardless of input order', () => {
    // Input is reversed: newer L2 first in the array
    const layers: Layer[] = [
      makeLayer('L2', '5', '20.0000', 100), // newer — listed first
      makeLayer('L1', '5', '10.0000', 0),   // older — listed second
    ];
    const result = consumeFifo(layers, '3');
    // Should consume from L1 (oldest) first: 3 × 10 = 30
    expect(eq4(result.cogs, '30.0000')).toBe(true);

    // L1 reduced, L2 unchanged
    const l1 = result.remainingLayers.find((l) => l.id === 'L1')!;
    const l2 = result.remainingLayers.find((l) => l.id === 'L2')!;
    expect(eq4(String(l1.qtyRemaining), '2.0000')).toBe(true);
    expect(eq4(String(l2.qtyRemaining), '5.0000')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exact depletion
// ---------------------------------------------------------------------------
describe('consumeFifo — exact depletion', () => {
  it('consumes exactly the total available across two layers', () => {
    const layers: Layer[] = [
      makeLayer('L1', '4', '10.0000', 0),
      makeLayer('L2', '6', '15.0000', 100),
    ];
    const result = consumeFifo(layers, '10');

    // 4×10 + 6×15 = 40 + 90 = 130
    expect(eq4(result.cogs, '130.0000')).toBe(true);
    expect(result.consumed).toHaveLength(2);

    result.remainingLayers.forEach((l) => {
      expect(eq4(String(l.qtyRemaining), '0.0000')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Oversell beyond available layers
// ---------------------------------------------------------------------------
describe('consumeFifo — oversell', () => {
  it('costed at last layer unitCost when overselling past all layers', () => {
    // L1 (older): 2 units @ 5 → 10
    // L2 (newer): 3 units @ 8 → 24
    // Total available = 5 units; consume 9 → oversell 4 at last layer cost 8
    // COGS = 5 (available COGS) + 4 × 8 = 10 + 24 + 32 = 66
    const layers: Layer[] = [
      makeLayer('L1', '2', '5.0000', 0),
      makeLayer('L2', '3', '8.0000', 100),
    ];
    const result = consumeFifo(layers, '9');

    // available: 2×5 + 3×8 = 34; oversell: 4 × 8 = 32; total = 66
    expect(eq4(result.cogs, '66.0000')).toBe(true);

    // Both layers depleted
    result.remainingLayers.forEach((l) => {
      expect(eq4(String(l.qtyRemaining), '0.0000')).toBe(true);
    });
  });

  it('costs oversell at 0 when there are NO layers', () => {
    const result = consumeFifo([], '5');
    expect(eq4(result.cogs, '0.0000')).toBe(true);
    expect(result.consumed).toHaveLength(0);
    expect(result.remainingLayers).toHaveLength(0);
  });

  it('single-layer oversell uses that layer cost', () => {
    // 2 units @ 10; consume 5 → take 2 + oversell 3 @ 10 = 50
    const layers: Layer[] = [makeLayer('L1', '2', '10.0000', 0)];
    const result = consumeFifo(layers, '5');
    expect(eq4(result.cogs, '50.0000')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Decimal precision edge case
// ---------------------------------------------------------------------------
describe('consumeFifo — decimal precision', () => {
  it('handles fractional quantities without floating-point drift', () => {
    // 1.5 units @ 3.3333 → COGS = 4.9999(5)
    const layers: Layer[] = [makeLayer('L1', '1.5000', '3.3333', 0)];
    const result = consumeFifo(layers, '1.5');
    // 1.5 × 3.3333 = 4.99995 → rounded to 4dp = 5.0000
    const cogs = new Prisma.Decimal(result.cogs);
    // Use greaterThan check — exact 4dp depends on Decimal rounding
    expect(cogs.greaterThan(D('4.9990'))).toBe(true);
    expect(cogs.lessThan(D('5.0010'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 3: a sales-return re-enters a FIFO cost layer at a real (non-zero) cost so
// the NEXT sale consumes it at that cost — never at 0. The credit-note controller
// resolves the layer cost via resolveRestockUnitCost; here we assert the FIFO
// engine consumes a returned layer at its booked unit cost.
// ---------------------------------------------------------------------------
describe('consumeFifo — returned layer consumed at its booked cost (bug 3)', () => {
  it('a returned layer at cost 7.5 is consumed at 7.5, not 0', () => {
    // Original layers depleted; a return added a fresh layer @ 7.5 (booked cost).
    const returnedLayer: Layer = makeLayer('RET', '3', '7.5000', 100);
    const result = consumeFifo([returnedLayer], '3');
    // COGS = 3 × 7.5 = 22.5 (a 0-cost layer would have produced 0 here).
    expect(eq4(result.cogs, '22.5000')).toBe(true);
    expect(new Prisma.Decimal(result.cogs).greaterThan(D('0'))).toBe(true);
  });
});
