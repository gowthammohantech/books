// lib/ledger/inventoryValuation.ts
// Orchestration helpers for FIFO vs WAC inventory valuation at receipt and issue time.
// This module MUST NOT change WAC behaviour — WAC calls delegate unchanged to inventoryCost.ts.
//
// FIFO + Approvals policy (v1 documented limitation):
//   - FIFO layer consumption happens at CREATE time only.
//   - If approvalsEnabled is true, layer consumption still occurs at create-time.
//   - The COGS amount computed at create-time is passed through to postInvoiceLedger
//     and eventually postSaleCogs; this matches what was computed at create-time.
//   - On approve, the COGS is NOT re-consumed from layers (which would double-consume).
//   - Implication: FIFO COGS is always the create-time average, regardless of whether
//     approval is enabled. This is a documented v1 limitation; a v2 improvement would
//     store the create-time COGS on the invoice row and replay it at approve-time.

import { Prisma } from '@prisma/client';
import { applyReceipt, applyIssue, type StockState } from './inventoryCost';
import { consumeFifo, type Layer } from './fifo';
import { allocateLandedCost } from './landedCost';
import { toDecimal, ZERO } from './money';

// Re-export for convenience
export type { StockState };

type TxClient = {
  inventoryCostLayer: {
    create: (args: {
      data: {
        userId: string;
        productId: string;
        qtyRemaining: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        receivedAt: Date;
        sourceType?: string;
        sourceId?: string;
      };
    }) => Promise<{ id: string }>;
    findMany: (args: {
      where: { userId: string; productId: string; isDeleted: boolean };
      orderBy: { receivedAt: 'asc' };
    }) => Promise<
      {
        id: string;
        qtyRemaining: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        receivedAt: Date;
      }[]
    >;
    update: (args: {
      where: { id: string };
      data: { qtyRemaining: Prisma.Decimal; isDeleted?: boolean };
    }) => Promise<unknown>;
  };
};

/** One item line for landed-cost allocation. */
export interface InventoryLine {
  /** Net line amount (rate × qty, before tax/discount). */
  amount: number;
}

/**
 * Compute the per-line landed unit cost additions when a purchase has a landedCost.
 *
 * Returns an array of additional-per-unit costs in the same order as `lines`.
 * If landedCost is absent or zero, all additions are 0.
 */
export function computeLandedAdditions(
  lines: { amount: number; qty: number }[],
  landedCost: number | null | undefined,
): number[] {
  if (!landedCost || landedCost <= 0 || lines.length === 0) {
    return lines.map(() => 0);
  }
  const allocationLines = lines.map((l) => ({ value: String(l.amount) }));
  const allocated = allocateLandedCost(allocationLines, String(landedCost));
  return allocated.map((a, i) => {
    const qty = lines[i]!.qty;
    if (qty <= 0) return 0;
    return toDecimal(a).dividedBy(toDecimal(qty)).toNumber();
  });
}

// ============================================================================
// Receipt-time helpers
// ============================================================================

/**
 * Apply an inventory receipt for a FIFO product.
 * Creates a new InventoryCostLayer and updates quantityOnHand.
 * avgCost is NOT updated for FIFO products.
 *
 * @param tx          Prisma transaction client (must have inventoryCostLayer)
 * @param params      Receipt parameters
 * @returns New quantityOnHand
 */
export async function applyFifoReceipt(
  tx: TxClient,
  params: {
    userId: string;
    productId: string;
    qty: number;
    landedUnitCost: number;
    purchaseDate: Date;
    purchaseId: string;
    currentQtyOnHand: Prisma.Decimal;
  },
): Promise<Prisma.Decimal> {
  const { userId, productId, qty, landedUnitCost, purchaseDate, purchaseId, currentQtyOnHand } = params;

  await tx.inventoryCostLayer.create({
    data: {
      userId,
      productId,
      qtyRemaining: toDecimal(qty),
      unitCost: toDecimal(landedUnitCost),
      receivedAt: purchaseDate,
      sourceType: 'purchase',
      sourceId: purchaseId,
    },
  });

  return currentQtyOnHand.plus(toDecimal(qty));
}

/**
 * Apply a WAC receipt — delegates unchanged to applyReceipt.
 * landedUnitCost includes any landed-cost allocation.
 */
export function applyWacReceipt(
  state: StockState,
  qty: number,
  landedUnitCost: number,
): StockState {
  return applyReceipt(state, String(qty), String(landedUnitCost));
}

// ============================================================================
// Issue-time helpers
// ============================================================================

/**
 * Apply an inventory issue for a FIFO product.
 * Loads open layers (oldest first), consumes via consumeFifo,
 * persists updated qtyRemaining, decrements quantityOnHand.
 *
 * Returns { cogs, newQtyOnHand }.
 */
export async function applyFifoIssue(
  tx: TxClient,
  params: {
    userId: string;
    productId: string;
    qty: number;
    currentQtyOnHand: Prisma.Decimal;
  },
): Promise<{ cogs: Prisma.Decimal; newQtyOnHand: Prisma.Decimal }> {
  const { userId, productId, qty, currentQtyOnHand } = params;

  // Load open layers oldest-first.
  const dbLayers = await tx.inventoryCostLayer.findMany({
    where: { userId, productId, isDeleted: false },
    orderBy: { receivedAt: 'asc' },
  });

  const layers: Layer[] = dbLayers.map((l) => ({
    id: l.id,
    qtyRemaining: l.qtyRemaining.toString(),
    unitCost: l.unitCost.toString(),
    receivedAt: l.receivedAt,
  }));

  const result = consumeFifo(layers, String(qty));

  // Persist the updated qtyRemaining for each touched layer.
  for (const updatedLayer of result.remainingLayers) {
    if (!updatedLayer.id) continue;
    const newQty = toDecimal(String(updatedLayer.qtyRemaining));
    const isDepleted = newQty.lessThanOrEqualTo(ZERO);
    await tx.inventoryCostLayer.update({
      where: { id: updatedLayer.id },
      data: {
        qtyRemaining: newQty,
        ...(isDepleted ? { isDeleted: true } : {}),
      },
    });
  }

  const cogs = toDecimal(result.cogs);
  const newQtyOnHand = currentQtyOnHand.minus(toDecimal(qty));

  return { cogs, newQtyOnHand };
}

/**
 * Apply a WAC issue — delegates unchanged to applyIssue.
 */
export function applyWacIssue(
  state: StockState,
  qty: number,
): { state: StockState; cogs: Prisma.Decimal } {
  return applyIssue(state, String(qty));
}
