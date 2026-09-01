import { useCallback, useState } from "react";

const STORAGE_KEY = "commandPalette.recents";
const MAX_RECENTS = 6;

/**
 * Reads the stored recents, discarding anything unparseable.
 *
 * Guarded rather than trusted: a bad value here would throw during the
 * palette's first render, which takes the whole admin layout down with it.
 */
const read = (): string[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((id): id is string => typeof id === "string")
            : [];
    } catch {
        return [];
    }
};

/**
 * The command ids most recently run from the palette, newest first.
 *
 * Persisted per browser (not per user): it is an ordering convenience, and the
 * ids are permission-filtered again on every open, so a stale id for a page the
 * current user cannot reach simply never resolves to a row.
 */
export const useRecentCommands = () => {
    const [recentIds, setRecentIds] = useState<string[]>(read);

    const remember = useCallback((id: string) => {
        setRecentIds((prev) => {
            const next = [id, ...prev.filter((existing) => existing !== id)].slice(
                0,
                MAX_RECENTS
            );
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Private-mode / quota failures are not worth surfacing: recents
                // just stay in memory for this session.
            }
            return next;
        });
    }, []);

    return { recentIds, remember };
};
