// Enum unions shared between apps/api and apps/web, generated from
// apps/api/prisma/schema.prisma — see scripts/generate.mjs.
//
// These were previously hand-copied into apps/web/src/types/*.ts. One had
// already drifted: TaxRegime gained VAT_UK, VAT_EU, GST_AU and GST_NZ in the
// schema while the frontend union still listed only four regimes.
export * from './generated';
