export type RecurringUnit = 'days' | 'months' | 'years';

/**
 * Advances `invoiceDate` by `recurringDuration` of `recurring` units.
 *
 * Returns a new Date; the input is not mutated (`new Date(invoiceDate)` copies
 * it). An unrecognised `recurring` value returns the date unchanged, which is
 * the behaviour callers have always had.
 */
export function getNextRecurringDate(
  invoiceDate: Date | string | number,
  recurring: RecurringUnit | string,
  recurringDuration: number,
): Date {
  const date = new Date(invoiceDate);
  if (recurring === 'days') date.setDate(date.getDate() + recurringDuration);
  if (recurring === 'months') date.setMonth(date.getMonth() + recurringDuration);
  if (recurring === 'years') date.setFullYear(date.getFullYear() + recurringDuration);
  return date;
}

// The JS version was `module.exports = getNextRecurringDate`, i.e. the function
// itself was the module. Preserved so any CJS `require()` keeps working.
module.exports = getNextRecurringDate;
module.exports.getNextRecurringDate = getNextRecurringDate;
export default getNextRecurringDate;
