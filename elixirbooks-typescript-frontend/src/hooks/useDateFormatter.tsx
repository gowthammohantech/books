import { useCallback } from "react";
import { useSelector } from "react-redux";

import type { RootState } from "@store/index";

/**
 * Centralised date/time formatting.
 *
 * The backend stores the user-selected format as a PHP-style token string
 * (e.g. "d-m-Y", "d/m/Y", "Y-m-d", "F j, Y"). This hook formats against those
 * tokens AND the legacy uppercase tokens (YYYY/MM/DD) that older call sites
 * used, so a single helper renders every date the same way product-wide.
 *
 * The configured format is read from systemSettings, so call sites can simply
 * call `formatDate(date)` — passing a format explicitly still works and wins.
 *
 * Supported tokens:
 *   Year   Y / YYYY = 2025   y / YY = 25
 *   Month  m / MM = 08   n = 8   M / MMM = Aug   F / MMMM = August
 *   Day    d / DD = 05   j = 5   D / DDD = Sat   l / DDDD = Saturday
 *   Time   H = 14   G = 14   h = 02   g = 2   i = 09   s = 07   A = PM   a = pm
 */

export const DEFAULT_DATE_FORMAT = "d-m-Y";
export const DEFAULT_TIME_FORMAT = "h:i A";
const EMPTY = "—";

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const DAYS = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// Longest tokens first so multi-char tokens win over single-char ones.
const TOKEN_RE = /YYYY|MMMM|DDDD|MMM|DDD|YY|MM|DD|F|l|D|d|j|M|m|n|Y|y|H|G|h|g|i|s|A|a/g;

/**
 * Numeric date/time parts (year, monthIndex 0-11, day-of-month, 24h hour,
 * minute, second, weekday 0-6 Sun-Sat) as seen in a specific IANA time zone.
 *
 * When `timeZone` is set and valid, the parts are derived via Intl so every
 * date renders in the ORG's configured zone (not the viewer's browser zone).
 * If `timeZone` is missing/invalid (Intl throws on a bad zone), it falls back
 * to the Date's LOCAL getters so the formatter never breaks.
 */
interface DateParts {
    year: number;
    monthIndex: number; // 0-11
    dayOfMonth: number;
    hour24: number;
    minute: number;
    second: number;
    weekdayIndex: number; // 0=Sun .. 6=Sat
}

const localParts = (d: Date): DateParts => ({
    year: d.getFullYear(),
    monthIndex: d.getMonth(),
    dayOfMonth: d.getDate(),
    hour24: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    weekdayIndex: d.getDay(),
});

const WEEKDAY_INDEX: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
};

const zonedParts = (d: Date, timeZone?: string): DateParts => {
    if (!timeZone) return localParts(d);
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            weekday: "long",
        }).formatToParts(d);

        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
        // Intl can emit "24" for midnight under hour12:false; normalize to 0.
        let hour24 = parseInt(get("hour"), 10);
        if (hour24 === 24) hour24 = 0;

        const result: DateParts = {
            year: parseInt(get("year"), 10),
            monthIndex: parseInt(get("month"), 10) - 1,
            dayOfMonth: parseInt(get("day"), 10),
            hour24,
            minute: parseInt(get("minute"), 10),
            second: parseInt(get("second"), 10),
            weekdayIndex: WEEKDAY_INDEX[get("weekday")] ?? d.getDay(),
        };
        // Guard against any NaN slipping through (e.g. odd locale output).
        if (
            Number.isNaN(result.year) || Number.isNaN(result.monthIndex) ||
            Number.isNaN(result.dayOfMonth) || Number.isNaN(result.hour24) ||
            Number.isNaN(result.minute) || Number.isNaN(result.second)
        ) {
            return localParts(d);
        }
        return result;
    } catch {
        // Invalid IANA id (Intl throws) or any other failure → local fallback.
        return localParts(d);
    }
};

const tokenValues = (d: Date, timeZone?: string): Record<string, string> => {
    const p = zonedParts(d, timeZone);
    const h24 = p.hour24;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const year = String(p.year);
    const month = MONTHS[p.monthIndex];
    const day = DAYS[p.weekdayIndex];
    return {
        // year
        YYYY: year, Y: year,
        YY: year.slice(-2), y: year.slice(-2),
        // month
        MMMM: month, F: month,
        MMM: month.slice(0, 3), M: month.slice(0, 3),
        MM: String(p.monthIndex + 1).padStart(2, "0"), m: String(p.monthIndex + 1).padStart(2, "0"),
        n: String(p.monthIndex + 1),
        // day of month / week
        DDDD: day, l: day,
        DDD: day.slice(0, 3), D: day.slice(0, 3),
        DD: String(p.dayOfMonth).padStart(2, "0"), d: String(p.dayOfMonth).padStart(2, "0"),
        j: String(p.dayOfMonth),
        // time
        H: String(h24).padStart(2, "0"), G: String(h24),
        h: String(h12).padStart(2, "0"), g: String(h12),
        i: String(p.minute).padStart(2, "0"),
        s: String(p.second).padStart(2, "0"),
        A: h24 < 12 ? "AM" : "PM", a: h24 < 12 ? "am" : "pm",
    };
};

const toDate = (date: Date | string | number | null | undefined): Date | null => {
    if (date === null || date === undefined || date === "") return null;
    const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
    return isNaN(d.getTime()) ? null : d;
};

const applyFormat = (d: Date, format: string, timeZone?: string): string => {
    const values = tokenValues(d, timeZone);
    return format.replace(TOKEN_RE, (token) => values[token] ?? token);
};

/**
 * Convert the stored PHP-style (and legacy uppercase) date tokens to a date-fns
 * format string, so MUI's DatePicker (AdapterDateFns) and react-datepicker
 * render the configured format instead of their hardcoded defaults.
 *
 * This is DISPLAY-ONLY — the picker still emits a Date object on change, so
 * submitted values are unaffected.
 */
const PHP_TO_DATE_FNS: Record<string, string> = {
    // year
    YYYY: "yyyy", Y: "yyyy",
    YY: "yy", y: "yy",
    // month
    MMMM: "MMMM", F: "MMMM",
    MMM: "MMM", M: "MMM",
    MM: "MM", m: "MM",
    n: "M",
    // day of month / week
    DDDD: "EEEE", l: "EEEE",
    DDD: "EEE", D: "EEE",
    DD: "dd", d: "dd",
    j: "d",
    // time
    H: "HH", G: "H",
    h: "hh", g: "h",
    i: "mm",
    s: "ss",
    A: "a", a: "aaa",
};

export const toDateFnsFormat = (format: string): string =>
    format.replace(TOKEN_RE, (token) => PHP_TO_DATE_FNS[token] ?? token);

const useDateFormatter = () => {
    const dateFormat =
        useSelector((state: RootState) => state.systemSettings.data?.dateFormat?.format) ||
        DEFAULT_DATE_FORMAT;
    const timeFormat =
        useSelector((state: RootState) => state.systemSettings.data?.timeFormat?.format) ||
        DEFAULT_TIME_FORMAT;

    // Configured IANA time zone (e.g. "Asia/Kolkata"). `Timezone.name` holds the
    // IANA id on both backend and frontend types. Undefined when unset → the
    // formatter falls back to the viewer's local zone (see zonedParts).
    const timeZone = useSelector(
        (state: RootState) => state.systemSettings.data?.timezone?.name,
    ) || undefined;

    // Format a date. `format` is optional — defaults to the configured format.
    const formatDate = useCallback(
        (date: Date | string | number | null | undefined, format?: string): string => {
            const d = toDate(date);
            if (!d) return EMPTY;
            return applyFormat(d, format || dateFormat, timeZone);
        },
        [dateFormat, timeZone],
    );

    // Format a date + time using the configured (or supplied) formats.
    const formatDateTime = useCallback(
        (
            date: Date | string | number | null | undefined,
            dFormat?: string,
            tFormat?: string,
        ): string => {
            const d = toDate(date);
            if (!d) return EMPTY;
            return applyFormat(d, `${dFormat || dateFormat} ${tFormat || timeFormat}`, timeZone);
        },
        [dateFormat, timeFormat, timeZone],
    );

    // date-fns format string for picker components (display-only).
    const dateFnsFormat = toDateFnsFormat(dateFormat);

    return { formatDate, formatDateTime, dateFormat, dateFnsFormat, timeFormat };
};

export default useDateFormatter;
