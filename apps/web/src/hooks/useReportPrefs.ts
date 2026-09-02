import { useCallback, useMemo, useState } from "react";
import { currentTenantId, tenantLocal } from "@utils/tenantStorage";

/**
 * Per-workspace report preferences: which reports are starred, and when each was
 * last opened.
 *
 * WHY TENANT-SCOPED. These are ids from a catalogue every workspace shares, so
 * raw localStorage would look like it worked: someone who belongs to two
 * companies would star "AR Aging" in one and find it starred in the other. That
 * is not a data leak but it is a lie about whose workspace you are looking at,
 * and the last-visited column would be flatly wrong — it would show a visit that
 * happened somewhere else. `tenantLocal` namespaces both values by the tenant id
 * in the current token, so each workspace keeps its own.
 *
 * Signed out there is no tenant id, and the store is a no-op by design: a
 * preference is not worth falling back to an un-namespaced key for.
 *
 * WHY THE READS ARE GUARDED. Anything can be in browser storage — a value from
 * an older build, a hand-edited key, the literal string "undefined" that
 * `JSON.stringify(undefined)` produces. This hook runs during the Reports
 * Center's first render, so an unguarded parse would not degrade the page, it
 * would white-screen it. Every read therefore narrows to the shape it wants and
 * discards the rest rather than trusting what it finds.
 */

const FAVORITES_KEY = "reports.favorites";
const LAST_VISITED_KEY = "reports.lastVisited";

/** Report ids, in the order the user starred them. */
export type Favorites = string[];

/** Report id -> ISO timestamp of the last visit. */
export type LastVisited = Record<string, string>;

const readFavorites = (tenantId: string | null): Favorites => {
    if (!tenantId) return [];
    const parsed = tenantLocal.getJson<unknown>(tenantId, FAVORITES_KEY);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
};

const readLastVisited = (tenantId: string | null): LastVisited => {
    if (!tenantId) return {};
    const parsed = tenantLocal.getJson<unknown>(tenantId, LAST_VISITED_KEY);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LastVisited = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof at === "string") out[id] = at;
    }
    return out;
};

export interface ReportPrefs {
    favorites: Favorites;
    isFavorite: (id: string) => boolean;
    toggleFavorite: (id: string) => void;
    lastVisited: LastVisited;
    recordVisit: (id: string) => void;
}

export const useReportPrefs = (): ReportPrefs => {
    // Read once per mount. The tenant id only changes by switching workspace,
    // which reloads the app, so re-deriving it every render would decode the JWT
    // for nothing.
    const tenantId = useMemo(() => currentTenantId(), []);

    const [favorites, setFavorites] = useState<Favorites>(() => readFavorites(tenantId));
    const [lastVisited, setLastVisited] = useState<LastVisited>(() =>
        readLastVisited(tenantId),
    );

    const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
    const isFavorite = useCallback((id: string) => favoriteIds.has(id), [favoriteIds]);

    const toggleFavorite = useCallback(
        (id: string) => {
            setFavorites((prev) => {
                const next = prev.includes(id)
                    ? prev.filter((existing) => existing !== id)
                    : [...prev, id];
                // `setJson` refuses undefined/null and swallows quota failures,
                // so an unwritable store costs the persistence, not the toggle.
                tenantLocal.setJson(tenantId ?? "", FAVORITES_KEY, next);
                return next;
            });
        },
        [tenantId],
    );

    const recordVisit = useCallback(
        (id: string) => {
            setLastVisited((prev) => {
                const next = { ...prev, [id]: new Date().toISOString() };
                tenantLocal.setJson(tenantId ?? "", LAST_VISITED_KEY, next);
                return next;
            });
        },
        [tenantId],
    );

    return { favorites, isFavorite, toggleFavorite, lastVisited, recordVisit };
};

export default useReportPrefs;
