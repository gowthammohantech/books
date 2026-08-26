// lib/inventory/resolveRestockUnitCost.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { resolveRestockUnitCost } from './stockAdjust';

const D = (v: string) => new Prisma.Decimal(v);

function makeTx(opts: {
  valuationMethod?: string | null;
  purchasePrice?: string | null;
  avgCost?: string | null;
  layerUnitCost?: string | null;
}) {
  const product = {
    findUnique: vi.fn().mockResolvedValue({
      valuationMethod: opts.valuationMethod ?? null,
      purchase_price: opts.purchasePrice != null ? D(opts.purchasePrice) : null,
    }),
  };
  const inventory = {
    findFirst: vi.fn().mockResolvedValue(
      opts.avgCost != null ? { avgCost: D(opts.avgCost) } : null,
    ),
  };
  const inventoryCostLayer = {
    findFirst: vi.fn().mockResolvedValue(
      opts.layerUnitCost != null ? { unitCost: D(opts.layerUnitCost) } : null,
    ),
  };
  return { product, inventory, inventoryCostLayer };
}

describe('resolveRestockUnitCost — WAC', () => {
  it('returns current avgCost (blend no-op → valuation-neutral)', async () => {
    const tx = makeTx({ valuationMethod: 'WAC', avgCost: '8' });
    const cost = await resolveRestockUnitCost(tx as never, { productId: 'p1', userId: 'u1' });
    expect(cost).toBe(8);
    // FIFO layer path must NOT be consulted for WAC
    expect(tx.inventoryCostLayer.findFirst).not.toHaveBeenCalled();
  });
  it('returns 0 when no inventory row exists', async () => {
    const tx = makeTx({ valuationMethod: 'WAC', avgCost: null });
    const cost = await resolveRestockUnitCost(tx as never, { productId: 'p1', userId: 'u1' });
    expect(cost).toBe(0);
  });
  it('treats null valuationMethod (legacy) as WAC', async () => {
    const tx = makeTx({ valuationMethod: null, avgCost: '12' });
    const cost = await resolveRestockUnitCost(tx as never, { productId: 'p1', userId: 'u1' });
    expect(cost).toBe(12);
  });
});

describe('resolveRestockUnitCost — FIFO', () => {
  it('uses the most-recent cost-layer unitCost (never avgCost, never 0)', async () => {
    const tx = makeTx({ valuationMethod: 'FIFO', layerUnitCost: '7.5', avgCost: '0' });
    const cost = await resolveRestockUnitCost(tx as never, { productId: 'p1', userId: 'u1' });
    expect(cost).toBe(7.5);
    // must not fall back to the (stale/0) avgCost
    expect(tx.inventory.findFirst).not.toHaveBeenCalled();
  });
  it('falls back to product.purchase_price when no layer exists', async () => {
    const tx = makeTx({ valuationMethod: 'FIFO', layerUnitCost: null, purchasePrice: '9' });
    const cost = await resolveRestockUnitCost(tx as never, { productId: 'p1', userId: 'u1' });
    expect(cost).toBe(9);
  });
  it('falls back to 0 only when neither layer nor purchase_price exists', async () => {
    const tx = makeTx({ valuationMethod: 'FIFO', layerUnitCost: null, purchasePrice: null });
    const cost = await resolveRestockUnitCost(tx as never, { productId: 'p1', userId: 'u1' });
    expect(cost).toBe(0);
  });
});
