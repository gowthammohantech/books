/**
 * The fiscal-year label shown in the sidebar brand block.
 *
 * Which year you are posting into is not obvious from a date — an Indian
 * workspace on 1 April has just moved into a new FY while its calendar year is
 * half over — so the rail states it rather than leaving people to work it out.
 *
 * `startMonth` is CompanySettings.fiscalYearStartMonth, 1-12. It already
 * reaches the client: getBasicDetails returns the whole CompanySettings row and
 * its cleanObject only strips createdAt/updatedAt/isDeleted/__v.
 */
export const formatFiscalYear = (
    startMonth: number | null | undefined,
    today: Date = new Date(),
): string | null => {
    // Unset, or nonsense from an install that never ran ledger setup. No label
    // beats a wrong one: this sits next to the product name on every screen.
    if (startMonth == null || !Number.isInteger(startMonth)) return null;
    if (startMonth < 1 || startMonth > 12) return null;

    const year = today.getFullYear();

    // A January start means the fiscal year IS the calendar year, and
    // "FY 2026-27" would be actively wrong there.
    if (startMonth === 1) return `FY ${year}`;

    // getMonth() is 0-indexed; startMonth is not.
    const startYear = today.getMonth() + 1 >= startMonth ? year : year - 1;
    const endYear = String(startYear + 1).slice(-2);
    return `FY ${startYear}-${endYear}`;
};
