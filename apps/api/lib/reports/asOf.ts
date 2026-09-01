// lib/reports/asOf.ts
//
// Single shared parser for the `?asOf=` cutoff used by every point-in-time
// report (AR/AP aging, CSV exports, reconciliation tally). Returns an
// INCLUSIVE end-of-day instant computed in UTC so "as of DATE" means the same
// wall-clock instant no matter what timezone the server process runs in.
//
// Why this matters: `new Date(str); d.setHours(23,59,59,999)` uses the
// *server's local timezone* to build the end-of-day boundary. On a non-UTC
// server (the norm for this self-hosted product) that instant shifts by the
// server's UTC offset (e.g. +5:30), so the same `?asOf=2024-06-15` could
// resolve to a different cutoff in the aging API vs. the CSV export vs. the
// reconciliation tally — letting a document dated near midnight be included
// by one and excluded by another. Every point-in-time source filter
// (GL entryDate, invoice date, payment date, etc.) is `<= asOf`, so this one
// function is the single source of truth for that boundary.
export function parseAsOf(value: unknown): Date {
  const base = value ? new Date(String(value)) : new Date();
  const d = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
