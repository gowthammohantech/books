import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * A flyout anchored to the rail row that opened it.
 *
 * Two rails use this — the app sidebar's modules and the settings rail's
 * groups — and they have to behave identically, because to the user they are
 * the same gesture in the same place: point at a row, its children appear
 * beside it. The fiddly parts are the ones worth sharing.
 *
 * Coordinates are viewport coordinates, for `position: fixed`. A rail scrolls,
 * and an absolutely placed panel would be clipped by its own scroll container.
 */
export type NavFlyout = { id: string; top: number; left: number };

/** Panel header plus rows, mirroring the panel's own metrics. */
const estimateHeight = (rows: number) => 56 + rows * 32;

export const useNavFlyout = () => {
    const { pathname } = useLocation();
    const [flyout, setFlyout] = useState<NavFlyout | null>(null);

    const closeFlyout = useCallback(() => setFlyout(null), []);

    /**
     * `rows` is what the panel will render — items plus captions. It only
     * decides where the panel is pinned vertically, so an estimate is enough:
     * the panel is clamped into the viewport either way. A row with nothing
     * under it opens nothing; an empty panel is a promise of content that
     * never arrives.
     */
    const openFlyout = useCallback(
        (id: string, element: HTMLElement, rows: number) => {
            if (rows === 0) {
                setFlyout(null);
                return;
            }
            const rect = element.getBoundingClientRect();
            const height = Math.min(0.7 * window.innerHeight, estimateHeight(rows));
            setFlyout({
                id,
                left: rect.right + 8,
                top: Math.max(
                    8,
                    Math.min(rect.top - 8, window.innerHeight - height - 16),
                ),
            });
        },
        [],
    );

    // A flyout that outlives what opened it is a stray menu: close it when the
    // route changes, and on Escape.
    useEffect(() => setFlyout(null), [pathname]);
    useEffect(() => {
        if (!flyout) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setFlyout(null);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [flyout]);

    return { flyout, openFlyout, closeFlyout };
};
