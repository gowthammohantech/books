// lib/ledger/dimensionSplit.ts
//
// Group a document's per-line net amounts by profit centre so the posting
// engine can emit one revenue (or cost) leg per department instead of a single
// blanket leg. Pure — no Prisma, no I/O — so the reconciliation invariants can
// be tested exhaustively without a database.
//
// The invariant that matters: the returned groups sum EXACTLY to the caller's
// net total. Line nets are computed before document-level adjustments (tax
// treatment overrides, flat-regime server-authoritative tax recompute, discount
// rounding), so they routinely drift from the header total by a cent or two.
// Rather than let that drift reach buildLines and trip the "unbalanced entry"
// guard, the residual is folded into the header centre's group here.

import { toDecimal, sumDecimals, ZERO } from './money';

export interface CentreNet {
  costCenterId: string | null;
  net: string;
}

export interface SplitLine {
  /** Absent/undefined → inherit the header centre. Explicit null → untagged. */
  costCenterId?: string | null;
  net: string;
}

const fmt = (d: ReturnType<typeof toDecimal>): string => d.toFixed(4);

/**
 * Group `lines` by resolved centre and reconcile the groups to `netTotal`.
 *
 * Returns `[]` when every line resolves to `headerCostCenterId` — the uniform
 * case, and by far the common one. Callers then emit their existing single-leg
 * posting unchanged, so an undimensioned or single-department document produces
 * a byte-identical journal entry to the one it produced before this feature
 * existed. Every existing ledger fixture depends on that.
 */
export function splitNetByCentre(
  lines: SplitLine[],
  headerCostCenterId: string | null,
  netTotal: string,
): CentreNet[] {
  if (!lines.length) return [];

  const resolved = lines.map((l) => ({
    costCenterId: l.costCenterId === undefined ? headerCostCenterId : l.costCenterId,
    net: toDecimal(l.net),
  }));

  // Uniform → let the caller keep its original single-leg shape.
  const isUniform = resolved.every((l) => l.costCenterId === headerCostCenterId);
  if (isUniform) return [];

  const byCentre = new Map<string | null, ReturnType<typeof toDecimal>>();
  for (const l of resolved) {
    const key = l.costCenterId;
    byCentre.set(key, (byCentre.get(key) ?? ZERO).plus(l.net));
  }

  // Deterministic order — centre id ascending, the untagged group last. A
  // void-and-repost must reproduce the same line order as the original posting,
  // or the two entries stop being comparable line-for-line.
  const keys = [...byCentre.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const groups: CentreNet[] = keys.map((k) => ({
    costCenterId: k,
    net: fmt(byCentre.get(k) as ReturnType<typeof toDecimal>),
  }));

  // Fold any drift into the header centre's group so the split reconciles to
  // netTotal exactly, creating that group if the header centre has no lines.
  const target = toDecimal(netTotal);
  const summed = sumDecimals(groups.map((g) => toDecimal(g.net)));
  const residual = target.minus(summed);

  if (!residual.isZero()) {
    const headerGroup = groups.find((g) => g.costCenterId === headerCostCenterId);
    if (headerGroup) {
      headerGroup.net = fmt(toDecimal(headerGroup.net).plus(residual));
    } else {
      groups.push({ costCenterId: headerCostCenterId, net: fmt(residual) });
    }
  }

  // Drop groups that reconciled to zero — an empty leg carries no information
  // and would just add noise to the journal entry.
  return groups.filter((g) => !toDecimal(g.net).isZero());
}
