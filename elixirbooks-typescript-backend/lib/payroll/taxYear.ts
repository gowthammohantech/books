/**
 * UK tax-year + tax-month utility for My Money per-user ledgers.
 *
 * UK tax year: 6 April → 5 April (next calendar year)
 * Tax months: Month 1 = 6 Apr–5 May, …, Month 12 = 6 Mar–5 Apr
 *
 * All calculations are UTC. No Date.now() / argless new Date() in this module.
 */

export interface TaxYear {
  /** e.g. '2026/27' */
  label: string;
  /** 6 Apr 00:00:00.000 UTC of start calendar year */
  start: Date;
  /** 5 Apr 23:59:59.999 UTC of the following calendar year */
  end: Date;
}

/**
 * Build a TaxYear from a start calendar year.
 * e.g. startYear=2026 → label='2026/27', start=2026-04-06T00:00:00Z, end=2027-04-05T23:59:59.999Z
 */
function buildTaxYear(startYear: number): TaxYear {
  const endYear = startYear + 1;
  const shortEnd = String(endYear % 100).padStart(2, '0');
  const label = `${startYear}/${shortEnd}`;
  const start = new Date(Date.UTC(startYear, 3, 6, 0, 0, 0, 0));    // month index 3 = April
  const end = new Date(Date.UTC(endYear, 3, 5, 23, 59, 59, 999));   // month index 3 = April
  return { label, start, end };
}

/**
 * Returns the UK tax year that contains `date`.
 * If date is on/after 6 April → start year is the calendar year.
 * If date is before 6 April → start year is calendar year − 1.
 */
export function taxYearFor(date: Date): TaxYear {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1..12
  const d = date.getUTCDate();

  // On/after 6 April → tax year starts this calendar year
  const startYear = m > 4 || (m === 4 && d >= 6) ? y : y - 1;
  return buildTaxYear(startYear);
}

/**
 * Returns the UK tax year containing `now`.
 * Callers must pass `now` explicitly — never call Date.now() / new Date() in the lib.
 */
export function currentTaxYear(now: Date): TaxYear {
  return taxYearFor(now);
}

/**
 * Parses a label like '2026/27' and returns that tax year.
 * Throws if the label is not in the expected format or the short year is inconsistent.
 */
export function taxYearByLabel(label: string): TaxYear {
  const match = /^(\d{4})\/(\d{2})$/.exec(label);
  if (!match) {
    throw new Error(`Invalid tax year label: "${label}". Expected format YYYY/YY (e.g. '2026/27').`);
  }
  const startYear = parseInt(match[1], 10);
  const expectedShort = String((startYear + 1) % 100).padStart(2, '0');
  if (match[2] !== expectedShort) {
    throw new Error(
      `Invalid tax year label: "${label}". The short year "${match[2]}" does not follow "${startYear}" (expected "${expectedShort}").`,
    );
  }
  return buildTaxYear(startYear);
}

/**
 * Returns the tax month (1..12) within the tax year containing `date`.
 * Month 1 = 6 Apr–5 May, Month 2 = 6 May–5 Jun, …, Month 12 = 6 Mar–5 Apr.
 *
 * @param date - the date to classify
 * @param ty   - optional pre-computed tax year (avoids recomputing if the caller has it)
 */
export function taxMonthOf(date: Date, ty?: TaxYear): number {
  const taxYear = ty ?? taxYearFor(date);

  // Number of milliseconds from the tax year start to the date
  const msFromStart = date.getTime() - taxYear.start.getTime();
  if (msFromStart < 0) {
    // date is before tax year start — should not happen if ty is correct
    throw new Error('date is before the start of the provided tax year');
  }

  // Each tax month window starts on the 6th of a calendar month.
  // We can compute which window by checking the calendar month + day relative
  // to the tax year start (6 April).
  //
  // Tax month 1: 6 Apr – 5 May
  // Tax month N: 6 of (Apr+N-1) – 5 of (Apr+N), wrapping at Dec→Jan.
  //
  // Strategy: find how many full "6th-of-month" boundaries have passed since 6 Apr.
  const m = date.getUTCMonth() + 1; // 1..12
  const d = date.getUTCDate();
  const y = date.getUTCFullYear();

  // Offset of the calendar month relative to April (tax month 1 starts at April).
  // We need to handle the fact that tax year spans two calendar years.
  const startYear = taxYear.start.getUTCFullYear();

  // Compute "months elapsed since 6 April of startYear".
  // If we haven't yet passed the 6th of the current month, we're still in the prior window.
  let monthsElapsed: number;
  if (y === startYear) {
    // Apr–Dec of start year
    monthsElapsed = (m - 4); // Apr=0, May=1, ..., Dec=8
  } else {
    // Jan–Mar of the following year
    monthsElapsed = (m - 4) + 12; // Jan=9, Feb=10, Mar=11
  }

  // If we haven't reached the 6th of the current month, we're still in the previous window
  if (d < 6) {
    monthsElapsed -= 1;
  }

  // taxMonth is 1-indexed
  return monthsElapsed + 1;
}

/**
 * Returns an array of `count` consecutive tax years ending at (and including) `endingTaxYear`,
 * ordered most-recent-first.
 *
 * e.g. listTaxYears(taxYearByLabel('2026/27'), 3) → ['2026/27', '2025/26', '2024/25']
 */
export function listTaxYears(endingTaxYear: TaxYear, count: number): TaxYear[] {
  const endStartYear = endingTaxYear.start.getUTCFullYear();
  const result: TaxYear[] = [];
  for (let i = 0; i < count; i++) {
    result.push(buildTaxYear(endStartYear - i));
  }
  return result;
}
