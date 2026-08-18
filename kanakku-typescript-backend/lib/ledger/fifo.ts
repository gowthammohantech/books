// lib/ledger/fifo.ts
// Pure FIFO cost-layer consumption engine — no DB access.
import { Prisma } from '@prisma/client';
import { toDecimal, ZERO, type DecimalInput } from './money';

/** A single open inventory cost layer (oldest-first basis). */
export interface Layer {
  /** Optional DB id — absent for in-memory / test layers. */
  id?: string;
  /** Remaining quantity in this layer (Decimal string or Prisma.Decimal). */
  qtyRemaining: DecimalInput;
  /** Unit cost for this layer (Decimal string or Prisma.Decimal). */
  unitCost: DecimalInput;
  /** Timestamp of receipt — used to sort oldest-first. */
  receivedAt: Date;
}

/** Record of how much was consumed from a single layer. */
export interface ConsumedRecord {
  layerId?: string;
  /** Quantity consumed from this layer. */
  qty: string;
}

export interface ConsumeFifoResult {
  /** Total COGS as a Prisma.Decimal string (4dp). */
  cogs: string;
  /** Per-layer consumption details. */
  consumed: ConsumedRecord[];
  /** Updated layers with qtyRemaining decremented (depleted layers have qtyRemaining "0"). */
  remainingLayers: Layer[];
}

/**
 * Consume `qty` units from `layers` oldest-first (FIFO).
 *
 * Rules:
 * - Layers are consumed in ascending `receivedAt` order.
 * - COGS = Σ(consumedQty × layerUnitCost) across all layers touched.
 * - If `qty` exceeds total available, ALL layers are consumed and the
 *   shortfall (oversell) is costed at the LAST layer's unitCost.
 *   If there are no layers at all, oversell cost is 0.
 *
 * Returns updated `remainingLayers` (the input array with qtyRemaining
 * decremented; depleted records have qtyRemaining of "0").
 */
export function consumeFifo(layers: Layer[], qty: DecimalInput): ConsumeFifoResult {
  const target = toDecimal(qty);
  if (target.lessThanOrEqualTo(0)) {
    return {
      cogs: ZERO.toFixed(4),
      consumed: [],
      remainingLayers: layers.map((l) => ({ ...l })),
    };
  }

  if (layers.length === 0) {
    // No layers at all — oversell costed at 0.
    return {
      cogs: ZERO.toFixed(4),
      consumed: [],
      remainingLayers: [],
    };
  }

  // Sort oldest-first by receivedAt.
  const sorted = [...layers].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
  );

  let remaining = target;
  let cogs = ZERO;
  const consumed: ConsumedRecord[] = [];
  let lastUnitCost: Prisma.Decimal = toDecimal(sorted[sorted.length - 1].unitCost);

  // Build a mutable map of qtyRemaining indexed by original position.
  const updatedQty: Map<string | number, Prisma.Decimal> = new Map();
  sorted.forEach((l, i) => {
    const key = l.id ?? i;
    updatedQty.set(key, toDecimal(l.qtyRemaining));
  });

  for (const layer of sorted) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const key = layer.id ?? sorted.indexOf(layer);
    const available = updatedQty.get(key) ?? ZERO;
    lastUnitCost = toDecimal(layer.unitCost);

    if (available.lessThanOrEqualTo(0)) continue;

    const take = remaining.greaterThan(available) ? available : remaining;
    cogs = cogs.plus(take.times(lastUnitCost));
    remaining = remaining.minus(take);
    updatedQty.set(key, available.minus(take));

    consumed.push({
      layerId: layer.id,
      qty: take.toFixed(4),
    });
  }

  // Oversell: remaining > 0 means we exhausted all layers.
  if (remaining.greaterThan(0)) {
    // Cost the shortfall at the last layer's unit cost.
    cogs = cogs.plus(remaining.times(lastUnitCost));
    consumed.push({
      layerId: undefined,
      qty: remaining.toFixed(4),
    });
  }

  // Rebuild remainingLayers preserving original order.
  const remainingLayers: Layer[] = layers.map((l, i) => {
    const key = l.id ?? i;
    const newQty = updatedQty.get(key) ?? toDecimal(l.qtyRemaining);
    return {
      ...l,
      qtyRemaining: newQty.toFixed(4),
    };
  });

  return {
    cogs: cogs.toFixed(4),
    consumed,
    remainingLayers,
  };
}
