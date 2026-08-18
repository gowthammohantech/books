// lib/export/csv.ts
// Hand-rolled, dependency-free CSV serializer with RFC-4180 quoting/escaping
// and a CSV-injection guard. Used by every /api/admin/export/* endpoint and by
// the full-tenant backup zip.
//
// Why hand-rolled: the product ships as self-hosted source (CodeCanyon) and the
// audit flagged "minimal deps". CSV is a small, well-understood format; a ~60
// line serializer with correct escaping beats pulling in a transitive tree.

export interface CsvColumn {
  /** property key to read from each row object */
  key: string;
  /** column header text (defaults to `key`) */
  header?: string;
}

export interface CsvOptions {
  /**
   * Prepend a UTF-8 BOM so Excel opens the file as UTF-8 (otherwise it mangles
   * non-ASCII). Defaults to true — the files are downloaded for spreadsheet use.
   */
  bom?: boolean;
}

/**
 * Escape a single cell for CSV output.
 *
 * Two concerns:
 *  1. RFC-4180 quoting — wrap in double quotes and double any embedded quote
 *     when the value contains a comma, quote, CR or LF.
 *  2. CSV / formula injection — a cell whose first character is one of
 *     `= + - @` (or a tab / CR that a spreadsheet treats as the start of a
 *     formula) is prefixed with a single quote so Excel/Sheets/LibreOffice
 *     render it as literal text instead of executing it. This neutralises the
 *     classic `=HYPERLINK(...)`, `=cmd|...`, `+`/`-`/`@`-led payloads.
 */
export function escapeCsvCell(value: unknown): string {
  let s: string;
  if (value == null) {
    s = '';
  } else if (value instanceof Date) {
    s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  } else if (typeof value === 'object') {
    // Decimal-like (Prisma.Decimal), or anything with a sane toString.
    s = String(value);
  } else {
    s = String(value);
  }

  // CSV-injection guard: neutralise a leading formula trigger before any
  // RFC-4180 quoting decision is made.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize an array of row objects to a CSV string.
 *
 * @param rows    the data rows.
 * @param columns optional ordered column spec. When omitted, the union of keys
 *                from the first row is used (object insertion order).
 */
export function toCsv(rows: Record<string, unknown>[], columns?: CsvColumn[], options?: CsvOptions): string {
  const cols: CsvColumn[] =
    columns && columns.length > 0
      ? columns
      : Object.keys(rows[0] ?? {}).map((k) => ({ key: k }));

  const lines: string[] = [];
  lines.push(cols.map((c) => escapeCsvCell(c.header ?? c.key)).join(','));
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCsvCell(row[c.key])).join(','));
  }

  // CRLF line endings are the RFC-4180 default and the safest for Excel.
  const body = lines.join('\r\n');
  const bom = options?.bom === false ? '' : '﻿';
  return bom + body;
}
