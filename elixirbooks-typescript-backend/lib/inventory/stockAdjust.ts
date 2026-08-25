// lib/inventory/stockAdjust.ts
//
// Shared helper that applies a stock movement to the Inventory row (find-or-create),
// updating both the legacy `quantity` (Int) and the ledger-aware `quantityOnHand`/`avgCost`
// via the existing WAC/FIFO cost helpers. Appends an `inventory_history` entry that
// matches the shape used by purchaseController exactly.
//
// Usage: call inside a Prisma $transaction; pass `tx` (the transaction client).
// Returns the new quantityOnHand as a Prisma.Decimal.

import { Prisma } from '@prisma/client';
import {
  applyWacReceipt,
  applyWacIssue,
  applyFifoReceipt,
  applyFifoIssue,
} from '../ledger/inventoryValuation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockAdjustmentParams {
  /** The product to adjust. */
  productId: string;
  /** Tenant user id — row key alongside productId. */
  userId: string;
  /**
   * Signed quantity change.
   *   > 0 → stock in / receipt
   *   < 0 → stock out / issue
   *   Must not be 0.
   */
  qtyDelta: number;
  /** Maps to `inventory_history[].type` — drives cost-helper branch selection. */
  type: 'stock_in' | 'stock_out' | 'adjustment';
  /** Maps to `inventory_history[].referenceType`. */
  referenceType: 'purchase' | 'invoice' | 'return_' | 'sales_return' | 'purchase_return' | 'adjustment';
  /** Maps to `inventory_history[].referenceId`. Optional (e.g. adjustments). */
  referenceId?: string;
  /**
   * Unit cost for receipt movements. Used to update WAC avgCost.
   * Falls back to 0 when not provided (e.g. goods return at cost-unknown).
   * For FIFO receipts, this is the landedUnitCost passed to applyFifoReceipt.
   */
  unitCost?: number;
  /**
   * Optional additional date for FIFO receipt layers.
   * Defaults to `new Date()` when not supplied.
   */
  receiptDate?: Date;
  /**
   * Extra history fields spread into the inventory_history entry so callers can
   * match the full shape used by purchaseController:
   *   { unitId?, notes?, createdBy? }
   */
  extra?: {
    unitId?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  };
}

// Minimal Prisma tx-client shape needed by this helper.
// Typed narrowly so callers can pass the real Prisma.TransactionClient (or a test stub).
type TxClient = {
  product: {
    findUnique: (args: {
      where: { id: string };
      select: { valuationMethod: true };
    }) => Promise<{ valuationMethod: string | null } | null>;
  };
  inventory: {
    findFirst: (args: { where: { productId: string; userId: string } }) => Promise<{
      id: string;
      quantity: number;
      quantityOnHand: Prisma.Decimal;
      avgCost: Prisma.Decimal;
      inventory_history: unknown;
    } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string; quantityOnHand: Prisma.Decimal }>;
    update: (args: { where: { id: string }; data: unknown }) => Promise<{ id: string; quantityOnHand: Prisma.Decimal }>;
  };
  // FIFO layer ops — present on real tx; unused on WAC path but typed for completeness.
  inventoryCostLayer?: {
    create: (args: { data: unknown }) => Promise<{ id: string }>;
    findMany: (args: unknown) => Promise<unknown[]>;
    update: (args: unknown) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// Reversing-restock cost resolver
// ---------------------------------------------------------------------------

// Narrow tx shape for resolveRestockUnitCost (uses the real Prisma tx client at
// call sites; typed loosely here so callers can cast).
type RestockCostTx = {
  product: {
    findUnique: (args: {
      where: { id: string };
      select: { valuationMethod: true; purchase_price: true };
    }) => Promise<{ valuationMethod: string | null; purchase_price: Prisma.Decimal | null } | null>;
  };
  inventory: {
    findFirst: (args: {
      where: { productId: string; userId: string; isDeleted: boolean };
      select: { avgCost: true };
    }) => Promise<{ avgCost: Prisma.Decimal } | null>;
  };
  inventoryCostLayer: {
    findFirst: (args: {
      where: { userId: string; productId: string };
      orderBy: { receivedAt: 'desc' };
      select: { unitCost: true };
    }) => Promise<{ unitCost: Prisma.Decimal } | null>;
  };
};

/**
 * Resolve the unit cost for a REVERSING stock_in — a restock that undoes a prior
 * issue (invoice / credit-note / debit-note delete, or a sales/purchase return).
 *
 * The reversing receipt must be valuation-neutral so a stock_out followed by its
 * reversing stock_in never corrupts COGS:
 *
 *   - WAC  → the current avgCost. Receiving qty at the current average is a blend
 *            no-op, so the weighted average is unchanged. Restocking at 0 would
 *            dilute the average and understate future COGS.
 *   - FIFO → FIFO does NOT maintain avgCost (it stays 0 / stale), so restocking a
 *            FIFO product at avgCost would create a 0-cost layer that the next sale
 *            consumes at 0 — corrupting COGS. The exact per-unit cost booked when
 *            the units were sold is not persisted on the invoice/CN line, and
 *            consumed layers are not linked back to the sale line, so the true
 *            sold-cost is NOT recoverable. We approximate with the product's
 *            most-recent cost-layer unitCost (open or depleted — depleted layers
 *            are soft-deleted, not removed), which is the latest real purchase
 *            cost the business paid. Fallbacks: product.purchase_price, then 0.
 *
 * @returns the unit cost (a plain number) to pass as `unitCost` to applyStockAdjustment.
 */
export async function resolveRestockUnitCost(
  tx: RestockCostTx,
  params: { productId: string; userId: string },
): Promise<number> {
  const { productId, userId } = params;
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { valuationMethod: true, purchase_price: true },
  });

  if (product?.valuationMethod === 'FIFO') {
    const layer = await tx.inventoryCostLayer.findFirst({
      where: { userId, productId },
      orderBy: { receivedAt: 'desc' },
      select: { unitCost: true },
    });
    if (layer) return Number(layer.unitCost);
    return product.purchase_price != null ? Number(product.purchase_price) : 0;
  }

  const inv = await tx.inventory.findFirst({
    where: { productId, userId, isDeleted: false },
    select: { avgCost: true },
  });
  return inv ? Number(inv.avgCost) : 0;
}

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Apply a stock movement to the tenant Inventory row for `productId`/`userId`.
 *
 * - Finds the row; if missing, auto-creates it at qty 0 baseline first.
 * - Applies `qtyDelta` to the legacy `quantity` Int.
 * - Looks up `product.valuationMethod`:
 *     FIFO receipts  → applyFifoReceipt (creates cost layer, increments quantityOnHand)
 *     FIFO issues    → applyFifoIssue (consumes layers, decrements quantityOnHand)
 *     WAC receipts   → applyWacReceipt (blends avgCost + quantityOnHand)
 *     WAC issues     → applyWacIssue (decrements quantityOnHand, avgCost unchanged)
 * - Appends an `inventory_history` entry matching purchaseController's shape.
 *   Optional `extra` fields (unitId, notes, createdBy) are spread in when supplied.
 * - Runs all DB ops via the supplied `tx` (Prisma transaction client).
 *
 * @returns The new `quantityOnHand` Decimal.
 */
export async function applyStockAdjustment(
  tx: TxClient,
  params: StockAdjustmentParams,
): Promise<Prisma.Decimal> {
  const {
    productId,
    userId,
    qtyDelta,
    type,
    referenceType,
    referenceId,
    unitCost = 0,
    receiptDate,
    extra,
  } = params;

  // 1. Find existing row (keyed by productId + userId, matching purchaseController).
  const existing = await tx.inventory.findFirst({
    where: { productId, userId },
  });

  const previousQuantity = existing?.quantity ?? 0;
  const currentQtyOnHand = existing?.quantityOnHand ?? new Prisma.Decimal(0);
  const currentAvgCost = existing?.avgCost ?? new Prisma.Decimal(0);

  // 2. Look up product valuation method.
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { valuationMethod: true },
  });
  const isFifo = product?.valuationMethod === 'FIFO';

  const absQty = Math.abs(qtyDelta);
  let newQtyOnHand: Prisma.Decimal;
  let newAvgCost: Prisma.Decimal = currentAvgCost; // FIFO does not update avgCost

  // 3. Compute new cost state via appropriate valuation helper.
  if (qtyDelta > 0) {
    // Receipt path
    if (isFifo) {
      // FIFO: create cost layer + return updated quantityOnHand.
      // avgCost is intentionally NOT updated for FIFO products.
      newQtyOnHand = await applyFifoReceipt(
        tx as unknown as Parameters<typeof applyFifoReceipt>[0],
        {
          userId,
          productId,
          qty: absQty,
          landedUnitCost: unitCost,
          purchaseDate: receiptDate ?? new Date(),
          purchaseId: referenceId ?? '',
          currentQtyOnHand,
        },
      );
    } else {
      // WAC: blend avgCost + update quantityOnHand.
      const wac = applyWacReceipt(
        { quantityOnHand: currentQtyOnHand, avgCost: currentAvgCost },
        absQty,
        unitCost,
      );
      newQtyOnHand = wac.quantityOnHand;
      newAvgCost = wac.avgCost;
    }
  } else {
    // Issue path
    if (isFifo) {
      // FIFO: consume layers oldest-first, return cogs + new quantityOnHand.
      const fifoResult = await applyFifoIssue(
        tx as unknown as Parameters<typeof applyFifoIssue>[0],
        {
          userId,
          productId,
          qty: absQty,
          currentQtyOnHand,
        },
      );
      newQtyOnHand = fifoResult.newQtyOnHand;
      // avgCost unchanged for FIFO
    } else {
      // WAC: decrement quantityOnHand, avgCost unchanged.
      const result = applyWacIssue(
        { quantityOnHand: currentQtyOnHand, avgCost: currentAvgCost },
        absQty,
      );
      newQtyOnHand = result.state.quantityOnHand;
      newAvgCost = result.state.avgCost;
    }
  }

  // 4. Build the history entry — shape matches purchaseController exactly:
  //    { unitId, quantity (previousQty), notes, type, adjustment, referenceId, referenceType, createdBy }
  const nowIso = new Date().toISOString();
  const historyEntry: Record<string, unknown> = {
    unitId: extra?.unitId ?? null,
    quantity: previousQuantity,
    notes: extra?.notes ?? null,
    type,
    // Signed delta so the history shows +qty for stock-in (purchase) and -qty
    // for stock-out (invoice/sale). The cost helpers above use absQty; the
    // display field keeps the direction.
    adjustment: qtyDelta,
    referenceType,
    referenceId: referenceId ?? null,
    createdBy: extra?.createdBy ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // 5. Build inventory data update — FIFO does NOT write avgCost.
  const inventoryData: Record<string, unknown> = {
    quantity: previousQuantity + qtyDelta,
    quantityOnHand: newQtyOnHand,
    ...(isFifo ? {} : { avgCost: newAvgCost }),
  };

  // 6. Persist.
  if (existing) {
    const existingHistory = Array.isArray(existing.inventory_history)
      ? (existing.inventory_history as unknown[])
      : [];

    await tx.inventory.update({
      where: { id: existing.id },
      data: {
        ...inventoryData,
        inventory_history: [
          ...existingHistory,
          historyEntry,
        ] as unknown as Prisma.InputJsonValue,
      },
    });
  } else {
    // Auto-create the row at the baseline (0) and apply the delta in one shot.
    await tx.inventory.create({
      data: {
        productId,
        userId,
        ...inventoryData,
        inventory_history: [historyEntry] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return newQtyOnHand;
}
