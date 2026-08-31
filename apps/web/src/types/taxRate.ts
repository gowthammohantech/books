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

export interface TaxLine {
  taxRateId: string;
  name: string;
  kind: TaxKind | null;
  percent: number;
  amount: number;
}
