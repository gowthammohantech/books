// lib/costCenterNumbering.ts
//
// Per-profit-centre document numbering: SAL-000001 for Sales, ACAD-000001 for
// Academy, each department counting independently.
//
// WHY THE COUNTER LIVES ON THE CostCenter ROW
// -------------------------------------------
// The obvious home would be GeneralSetting, alongside the existing
// `nextInvoiceNo`. It cannot go there: `GeneralSetting.key` is `@unique`
// GLOBALLY with no `tenantId` column (prisma/schema.prisma), so those settings are
// install-wide and already shared across every tenant. A per-centre key would
// inherit that defect. `CostCenter` carries `tenantId`, so a counter on the row is
// tenant-scoped by construction — and Prisma's atomic `increment` gives a true
// reservation that also row-locks for the rest of the owning transaction.
//
// RELATIONSHIP TO lib/documentNumbering.ts
// ----------------------------------------
// That module handles the install-wide fallback series (documents with no
// centre, or a centre with no prefix). This one handles the per-centre series
// and returns null whenever the caller should fall back to it. The two are used
// together, not as alternatives.

import { Prisma } from '@prisma/client';

/** Structural slice of a Prisma model delegate, for the global-uniqueness probe.
 *  Mirrors NumberingModel in lib/documentNumbering.ts. */
export interface NumberingProbe {
  findFirst(args: {
    where: Record<string, unknown>;
    select?: Record<string, boolean>;
  }): Promise<Record<string, unknown> | null>;
}

/** The slice of a transaction client this helper needs. */
export interface NumberingTx {
  costCenter: {
    findFirst(args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<{ numberPrefix: string | null; nextNumber: number } | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<{ nextNumber: number; numberPrefix: string | null }>;
  };
}

export interface CentreNumberOptions {
  tenantId: string;
  costCenterId: string | null | undefined;
  /** Model delegate to probe for an install-wide clash, e.g. `tx.invoice`. */
  model: NumberingProbe;
  /** The globally-@unique number column, e.g. 'invoiceNumber'. */
  field: string;
  /** Zero-pad width for the numeric suffix. Defaults to 6. */
  width?: number;
  /** How many times to bump past an install-wide clash. */
  maxAttempts?: number;
}

export const MAX_CENTRE_NUMBER_ATTEMPTS = 5;

/**
 * Reserve and format the next document number for a profit centre.
 *
 * Returns `null` when the caller should use the install-wide sequence instead:
 * no centre was supplied, the centre is missing/deleted, or it has no
 * `numberPrefix` of its own. Returning null rather than throwing is deliberate —
 * per-centre numbering is opt-in per centre, and an untagged document is normal.
 *
 * Concurrency: the `increment` below is atomic and row-locks the CostCenter row
 * for the remainder of the owning transaction, so two concurrent creators
 * against the same centre serialize instead of racing. The counter also rolls
 * back with the transaction, so a failed create burns no number.
 *
 * Callers should still wrap their owning transaction in
 * `withDocumentNumberRetry` from lib/documentNumbering.ts: the number columns are
 * unique across the whole install, so two tenants using the same prefix can
 * still collide at commit time in a way no in-transaction probe can see.
 */
export async function nextCentreDocumentNumber(
  tx: NumberingTx,
  opts: CentreNumberOptions,
): Promise<string | null> {
  const { tenantId, costCenterId, model, field, width = 6 } = opts;
  const maxAttempts = opts.maxAttempts ?? MAX_CENTRE_NUMBER_ATTEMPTS;

  if (!costCenterId) return null;

  // Read first: a centre with no prefix must NOT have its counter advanced,
  // and an in-transaction increment cannot be selectively rolled back.
  const centre = await tx.costCenter.findFirst({
    where: { id: costCenterId, tenantId, isDeleted: false },
    select: { numberPrefix: true, nextNumber: true },
  });
  if (!centre?.numberPrefix) return null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Atomic reserve. Prisma returns the value AFTER the increment, so the
    // number this call owns is one less.
    const updated = await tx.costCenter.update({
      where: { id: costCenterId },
      data: { nextNumber: { increment: 1 } },
      select: { nextNumber: true, numberPrefix: true },
    });
    const issued = updated.nextNumber - 1;
    const prefix = updated.numberPrefix ?? centre.numberPrefix;
    const candidate = `${prefix}${String(issued).padStart(width, '0')}`;

    // The number column is unique across the whole install, not per tenant, so
    // another tenant using the same prefix may already hold this string.
    const clash = await model.findFirst({
      where: { [field]: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }

  throw new Prisma.PrismaClientKnownRequestError(
    `Could not allocate a unique ${field} for this profit center after ${maxAttempts} attempts`,
    { code: 'P2002', clientVersion: Prisma.prismaVersion.client, meta: { target: [field] } },
  );
}

/**
 * Preview the next number for a centre WITHOUT reserving it.
 *
 * Used by the "next number" endpoint the create form calls: showing a preview
 * must not burn a number, or every abandoned form would leave a gap in that
 * department's sequence.
 */
export async function peekCentreDocumentNumber(
  tx: NumberingTx,
  opts: Pick<CentreNumberOptions, 'tenantId' | 'costCenterId' | 'width'>,
): Promise<string | null> {
  const { tenantId, costCenterId, width = 6 } = opts;
  if (!costCenterId) return null;

  const centre = await tx.costCenter.findFirst({
    where: { id: costCenterId, tenantId, isDeleted: false },
    select: { numberPrefix: true, nextNumber: true },
  });
  if (!centre?.numberPrefix) return null;

  return `${centre.numberPrefix}${String(centre.nextNumber).padStart(width, '0')}`;
}
