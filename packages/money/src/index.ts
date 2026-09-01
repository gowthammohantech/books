// Money arithmetic shared between apps/api and apps/web.
//
// Everything here is pure and Decimal-based. The DB-backed halves stay in the
// backend: `resolveItemTaxRates` (tax-group lookup), `creditNoteTotalsByInvoice`
// and `getInvoiceSettlement` all issue Prisma queries. The browser-only halves
// stay in the frontend: `appendLineTaxFormData` builds a FormData and
// `resolveLineTaxByRateId` makes an HTTP call.
export * from './decimal.js';
export * from './documentTotals.js';
export * from './lineTax.js';
export * from './invoiceStatus.js';
export * from './aging.js';
