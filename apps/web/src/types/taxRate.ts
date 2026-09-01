import type { TaxComponent } from '@elixirbooks/money';
import type { TaxRegime, TaxKind } from '@elixirbooks/enums';

// Generated from apps/api/prisma/schema.prisma. Re-exported so the existing
// import sites for these names keep working.
export type { TaxRegime, TaxKind };

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  regime: TaxRegime;
  taxKind: TaxKind | null;
  countryId: string | null;
  stateId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A resolved tax component on a line. The shape lives in @elixirbooks/money so
 * the recompute helpers there return exactly this; the TaxKind narrowing is
 * preserved by parameterising it.
 */
export type TaxLine = TaxComponent<TaxKind | null>;
