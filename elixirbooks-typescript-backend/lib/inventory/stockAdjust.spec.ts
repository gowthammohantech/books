// lib/inventory/stockAdjust.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// --- Mock the cost helpers BEFORE importing the module under test ---
vi.mock('../ledger/inventoryValuation', () => ({
  applyWacReceipt: vi.fn(),
  applyWacIssue: vi.fn(),
  applyFifoReceipt: vi.fn(),
  applyFifoIssue: vi.fn(),
}));

import {
  applyWacReceipt,
  applyWacIssue,
  applyFifoReceipt,
  applyFifoIssue,
} from '../ledger/inventoryValuation';
import { applyStockAdjustment } from './stockAdjust';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const D = (v: string) => new Prisma.Decimal(v);

/** Build a minimal fake inventory row. */
function makeInventoryRow(qty = 10, qoh = '10', avg = '5') {
  return {
    id: 'inv-1',
    productId: 'prod-1',
    userId: 'user-1',
    quantity: qty,
    quantityOnHand: D(qoh),
    avgCost: D(avg),
    inventory_history: [] as unknown[],
    isDeleted: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Build a typed fake Prisma tx that covers only the ops stockAdjust needs. */
function makeTx(opts: {
  existingRow?: ReturnType<typeof makeInventoryRow> | null;
  productValuationMethod?: string;
}) {
  const createdRows: unknown[] = [];
  const updatedRows: { id: string; data: unknown }[] = [];

  return {
    createdRows,
    updatedRows,
    product: {
      findUnique: vi.fn().mockResolvedValue(
        opts.productValuationMethod !== undefined
          ? { valuationMethod: opts.productValuationMethod }
          : { valuationMethod: null },
      ),
    },
    inventory: {
      findFirst: vi.fn().mockResolvedValue(opts.existingRow ?? null),
      create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
        const row = { id: 'inv-new', ...(data as object) };
        createdRows.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: unknown }) => {
        const row = { id: where.id, ...(data as object) };
        updatedRows.push({ id: where.id, data });
        return row;
      }),
    },
    // FIFO layer ops — not called in WAC tests, but must exist for TS satisfaction
    inventoryCostLayer: {
      create: vi.fn().mockResolvedValue({ id: 'layer-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Positive delta → stock_in, WAC receipt applied, both qty fields increment
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — stock_in (positive delta)', () => {
  it('increments legacy quantity and quantityOnHand via WAC receipt, appends stock_in history', async () => {
    const existing = makeInventoryRow(10, '10', '5');

    const wacResult = { quantityOnHand: D('15'), avgCost: D('6') };
    vi.mocked(applyWacReceipt).mockReturnValue(wacResult);

    const tx = makeTx({ existingRow: existing });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: 5,
      type: 'stock_in',
      referenceType: 'purchase',
      referenceId: 'pur-42',
      unitCost: 8,
    });

    // WAC receipt was called with current state + delta + unitCost
    expect(applyWacReceipt).toHaveBeenCalledWith(
      { quantityOnHand: D('10'), avgCost: D('5') },
      5,
      8,
    );

    // inventory.update was called once
    expect(tx.inventory.update).toHaveBeenCalledOnce();
    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;

    // legacy quantity incremented
    expect(d['quantity']).toBe(10 + 5);

    // quantityOnHand + avgCost from WAC helper
    expect((d['quantityOnHand'] as Prisma.Decimal).equals(D('15'))).toBe(true);
    expect((d['avgCost'] as Prisma.Decimal).equals(D('6'))).toBe(true);

    // history appended with correct shape
    const history = d['inventory_history'] as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    const entry = history[0]!;
    expect(entry['type']).toBe('stock_in');
    expect(entry['referenceType']).toBe('purchase');
    expect(entry['referenceId']).toBe('pur-42');
    expect(entry['adjustment']).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. Negative delta → stock_out, WAC issue applied, both qty fields decrement
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — stock_out (negative delta)', () => {
  it('decrements legacy quantity and quantityOnHand via WAC issue, appends stock_out history', async () => {
    const existing = makeInventoryRow(10, '10', '5');

    const wacResult = { state: { quantityOnHand: D('7'), avgCost: D('5') }, cogs: D('15') };
    vi.mocked(applyWacIssue).mockReturnValue(wacResult);

    const tx = makeTx({ existingRow: existing });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: -3,
      type: 'stock_out',
      referenceType: 'invoice',
      referenceId: 'inv-99',
    });

    // WAC issue was called with |delta|
    expect(applyWacIssue).toHaveBeenCalledWith(
      { quantityOnHand: D('10'), avgCost: D('5') },
      3,
    );

    expect(tx.inventory.update).toHaveBeenCalledOnce();
    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;

    expect(d['quantity']).toBe(10 + (-3)); // 7
    expect((d['quantityOnHand'] as Prisma.Decimal).equals(D('7'))).toBe(true);

    const history = d['inventory_history'] as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    const entry = history[0]!;
    expect(entry['type']).toBe('stock_out');
    expect(entry['referenceType']).toBe('invoice');
    expect(entry['referenceId']).toBe('inv-99');
    // adjustment is the absolute quantity moved
    expect(entry['adjustment']).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Missing inventory row → auto-create, then apply
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — auto-create missing row', () => {
  it('creates the inventory row when none exists (stock_in)', async () => {
    const wacResult = { quantityOnHand: D('5'), avgCost: D('10') };
    vi.mocked(applyWacReceipt).mockReturnValue(wacResult);

    const tx = makeTx({ existingRow: null });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-new',
      userId: 'user-1',
      qtyDelta: 5,
      type: 'stock_in',
      referenceType: 'purchase',
      referenceId: 'pur-new',
      unitCost: 10,
    });

    // create, NOT update
    expect(tx.inventory.create).toHaveBeenCalledOnce();
    expect(tx.inventory.update).not.toHaveBeenCalled();

    const created = tx.createdRows[0] as Record<string, unknown>;
    expect(created['productId']).toBe('prod-new');
    expect(created['userId']).toBe('user-1');
    expect(created['quantity']).toBe(5);
    const history = created['inventory_history'] as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]!['type']).toBe('stock_in');
    expect(history[0]!['referenceType']).toBe('purchase');
    expect(history[0]!['referenceId']).toBe('pur-new');
  });

  it('creates the inventory row when none exists (stock_out allows negative)', async () => {
    const wacResult = { state: { quantityOnHand: D('-3'), avgCost: D('0') }, cogs: D('0') };
    vi.mocked(applyWacIssue).mockReturnValue(wacResult);

    const tx = makeTx({ existingRow: null });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-new',
      userId: 'user-1',
      qtyDelta: -3,
      type: 'stock_out',
      referenceType: 'invoice',
      referenceId: 'inv-out',
    });

    expect(tx.inventory.create).toHaveBeenCalledOnce();
    const created = tx.createdRows[0] as Record<string, unknown>;
    expect(created['quantity']).toBe(-3);
    const history = created['inventory_history'] as Array<Record<string, unknown>>;
    expect(history[0]!['type']).toBe('stock_out');
  });
});

// ---------------------------------------------------------------------------
// 4. History entry shape — referenceType + referenceId carried through
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — history entry shape', () => {
  it('carries referenceType and referenceId in history entry', async () => {
    const existing = makeInventoryRow(20, '20', '8');
    vi.mocked(applyWacReceipt).mockReturnValue({ quantityOnHand: D('22'), avgCost: D('8') });

    const tx = makeTx({ existingRow: existing });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: 2,
      type: 'stock_in',
      referenceType: 'return_',
      referenceId: 'ret-007',
      unitCost: 8,
    });

    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;
    const history = d['inventory_history'] as Array<Record<string, unknown>>;
    const entry = history[0]!;
    expect(entry['referenceType']).toBe('return_');
    expect(entry['referenceId']).toBe('ret-007');
    expect(entry['type']).toBe('stock_in');
    expect(entry['adjustment']).toBe(2);
  });

  it('appends to existing history, does not overwrite', async () => {
    const existingHistory = [
      { type: 'stock_in', referenceType: 'purchase', referenceId: 'pur-old', adjustment: 10, quantity: 0, notes: 'prior' },
    ];
    const existing = {
      ...makeInventoryRow(10, '10', '5'),
      inventory_history: existingHistory,
    };
    vi.mocked(applyWacReceipt).mockReturnValue({ quantityOnHand: D('13'), avgCost: D('5') });

    const tx = makeTx({ existingRow: existing });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: 3,
      type: 'stock_in',
      referenceType: 'purchase',
      referenceId: 'pur-new',
      unitCost: 5,
    });

    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;
    const history = d['inventory_history'] as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]!['referenceId']).toBe('pur-old');
    expect(history[1]!['referenceId']).toBe('pur-new');
  });

  it('spreads extra fields (unitId, notes, createdBy) into history entry', async () => {
    const existing = makeInventoryRow(5, '5', '10');
    vi.mocked(applyWacReceipt).mockReturnValue({ quantityOnHand: D('10'), avgCost: D('10') });

    const tx = makeTx({ existingRow: existing });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: 5,
      type: 'stock_in',
      referenceType: 'purchase',
      referenceId: 'pur-extra',
      unitCost: 10,
      extra: { unitId: 'unit-kg', notes: 'Stock in from purchase pur-extra', createdBy: 'user-1' },
    });

    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;
    const history = d['inventory_history'] as Array<Record<string, unknown>>;
    const entry = history[0]!;
    expect(entry['unitId']).toBe('unit-kg');
    expect(entry['notes']).toBe('Stock in from purchase pur-extra');
    expect(entry['createdBy']).toBe('user-1');
  });
});

// ---------------------------------------------------------------------------
// 5. adjustment type (zero-cost, no cost helper called for issues)
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — adjustment type', () => {
  it('positive adjustment treated as receipt', async () => {
    const existing = makeInventoryRow(5, '5', '10');
    vi.mocked(applyWacReceipt).mockReturnValue({ quantityOnHand: D('8'), avgCost: D('10') });

    const tx = makeTx({ existingRow: existing });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: 3,
      type: 'adjustment',
      referenceType: 'adjustment',
    });

    expect(applyWacReceipt).toHaveBeenCalled();
    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;
    const history = d['inventory_history'] as Array<Record<string, unknown>>;
    expect(history[0]!['type']).toBe('adjustment');
  });
});

// ---------------------------------------------------------------------------
// 6. FIFO receipt path — applyFifoReceipt chosen, avgCost NOT updated
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — FIFO receipt', () => {
  it('calls applyFifoReceipt when valuationMethod===FIFO (stock_in)', async () => {
    const existing = makeInventoryRow(10, '10', '5');
    const newQtyOnHand = D('15');
    vi.mocked(applyFifoReceipt).mockResolvedValue(newQtyOnHand);

    const tx = makeTx({ existingRow: existing, productValuationMethod: 'FIFO' });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: 5,
      type: 'stock_in',
      referenceType: 'purchase',
      referenceId: 'pur-fifo',
      unitCost: 12,
      receiptDate: new Date('2026-01-01'),
    });

    // FIFO helper chosen, WAC NOT called
    expect(applyFifoReceipt).toHaveBeenCalledOnce();
    expect(applyWacReceipt).not.toHaveBeenCalled();

    // avgCost should NOT be written for FIFO
    expect(tx.inventory.update).toHaveBeenCalledOnce();
    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;
    expect(d['avgCost']).toBeUndefined();

    // quantityOnHand from FIFO helper
    expect((d['quantityOnHand'] as Prisma.Decimal).equals(newQtyOnHand)).toBe(true);

    // legacy quantity updated
    expect(d['quantity']).toBe(15);
  });

  it('auto-creates the row via FIFO when no existing row', async () => {
    const newQtyOnHand = D('7');
    vi.mocked(applyFifoReceipt).mockResolvedValue(newQtyOnHand);

    const tx = makeTx({ existingRow: null, productValuationMethod: 'FIFO' });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-new',
      userId: 'user-1',
      qtyDelta: 7,
      type: 'stock_in',
      referenceType: 'purchase',
      referenceId: 'pur-fifo-new',
      unitCost: 9,
    });

    expect(tx.inventory.create).toHaveBeenCalledOnce();
    expect(tx.inventory.update).not.toHaveBeenCalled();
    const created = tx.createdRows[0] as Record<string, unknown>;
    expect(created['quantity']).toBe(7);
    // avgCost not set for FIFO
    expect(created['avgCost']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. FIFO issue path — applyFifoIssue chosen
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — FIFO issue', () => {
  it('calls applyFifoIssue when valuationMethod===FIFO (stock_out)', async () => {
    const existing = makeInventoryRow(10, '10', '5');
    const fifoResult = { cogs: D('30'), newQtyOnHand: D('7') };
    vi.mocked(applyFifoIssue).mockResolvedValue(fifoResult);

    const tx = makeTx({ existingRow: existing, productValuationMethod: 'FIFO' });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: -3,
      type: 'stock_out',
      referenceType: 'invoice',
      referenceId: 'inv-fifo',
    });

    // FIFO issue helper chosen, WAC NOT called
    expect(applyFifoIssue).toHaveBeenCalledOnce();
    expect(applyWacIssue).not.toHaveBeenCalled();

    expect(tx.inventory.update).toHaveBeenCalledOnce();
    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;

    // legacy quantity decremented
    expect(d['quantity']).toBe(7);
    // quantityOnHand from FIFO helper
    expect((d['quantityOnHand'] as Prisma.Decimal).equals(D('7'))).toBe(true);
    // avgCost NOT written for FIFO
    expect(d['avgCost']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Sales-return restock: unitCost = book avgCost → WAC avg stays unchanged
// ---------------------------------------------------------------------------
describe('applyStockAdjustment — return_ restock at book cost (WAC stable)', () => {
  it('passes unitCost=avgCost to applyWacReceipt so blending leaves avgCost unchanged', async () => {
    // Existing inventory: 10 units @ $8.00 avg
    const existing = makeInventoryRow(10, '10', '8');
    // When unitCost == current avgCost, WAC formula: (10*8 + 2*8)/(10+2) = 8 → unchanged
    const wacResult = { quantityOnHand: D('12'), avgCost: D('8') };
    vi.mocked(applyWacReceipt).mockReturnValue(wacResult);

    const tx = makeTx({ existingRow: existing });

    await applyStockAdjustment(tx as never, {
      productId: 'prod-1',
      userId: 'user-1',
      qtyDelta: 2,
      type: 'stock_in',
      referenceType: 'return_',
      referenceId: 'cn-001',
      unitCost: 8, // book avgCost passed by credit-note controller
    });

    // Helper must be called with unitCost = 8 (not 0)
    expect(applyWacReceipt).toHaveBeenCalledWith(
      { quantityOnHand: D('10'), avgCost: D('8') },
      2,
      8, // <-- book avgCost; a value of 0 here would dilute the WAC
    );

    // Persisted avgCost stays at 8
    const { data } = tx.updatedRows[0]!;
    const d = data as Record<string, unknown>;
    expect((d['avgCost'] as Prisma.Decimal).equals(D('8'))).toBe(true);
  });
});
