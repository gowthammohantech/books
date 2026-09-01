import {
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type SVGProps,
} from "react";

import {
    decideIconMotion,
    ICON_PULSE_MS,
    type IconTrigger,
} from "./iconMotionSupport";
import { hasVariant, ICON_REGISTRY, type IconName } from "./iconRegistry";
import {
    getReducedMotionServerSnapshot,
    prefersReducedMotion,
    subscribeReducedMotion,
} from "./reducedMotion";
import { useIconTrigger } from "./useIconTrigger";
import { loadVariants, peekVariants, warmVariants } from "./variants/loader";
import type { AnimatedIconVariant, VariantState } from "./variants/types";

export interface AnimatedIconProps
    extends Omit<SVGProps<SVGSVGElement>, "ref" | "name"> {
    name: IconName;
    /**
     * Always pass this. The app sizes icons two ways — `size={14}` and
     * `w-4 h-4` — and both work here, but an unsized icon falls back to
     * lucide's 24px, which is larger than anything in the chrome.
     */
    size?: number;
    /** Where the hover/focus that plays this icon comes from. */
    trigger?: IconTrigger;
    /**
     * Play once, now, with no pointer involved. Bump the number on a state
     * change worth announcing — NotificationBell bumps it when the waiting
     * count goes UP. Undefined means the icon never pulses.
     */
    pulseKey?: number;
}

/**
 * A lucide icon that animates when you point at the thing it belongs to.
 *
 * Drop-in by design. Every icon slot in this app is typed `ReactNode` and holds
 * an already-instantiated element (`icon: <Home size={16} />`), so this
 * component *is* a valid value for all of them and swapping one in costs no
 * type change anywhere — not in types/sidebar.ts, not in tableActions.ts, not
 * in Button's leftIcon, not in any statusConfig record.
 *
 * What renders, in order of preference:
 *
 *   the variant   once the chunk has arrived AND motion is wanted
 *   the glyph     always otherwise — before the chunk lands, under reduced
 *                 motion, for a name with no variant, and if the fetch fails
 *
 * Because the fallback is the exact lucide icon the app used before, the
 * degraded state is not a degradation: it is precisely today's UI.
 */
const AnimatedIcon = ({
    name,
    size = 16,
    trigger = "closest",
    pulseKey,
    className,
    ...rest
}: AnimatedIconProps) => {
    const Static = ICON_REGISTRY[name];

    const reducedMotion = useSyncExternalStore(
        subscribeReducedMotion,
        prefersReducedMotion,
        getReducedMotionServerSnapshot,
    );

    const mode = decideIconMotion({
        reducedMotion,
        hasVariant: hasVariant(name),
        trigger,
    });

    // Seeded synchronously so the SECOND icon to mount after the chunk has
    // landed is animated from its first frame, with no swap flicker.
    const [Variant, setVariant] = useState<AnimatedIconVariant | null>(
        () => peekVariants()?.[name] ?? null,
    );
    const [state, setState] = useState<VariantState>("normal");

    useEffect(() => {
        if (mode === "animated") warmVariants();
    }, [mode]);

    // Whether the trigger is under the pointer / holding focus RIGHT NOW. A ref
    // rather than state because the only reader is the async continuation
    // below, and re-rendering on hover would cost more than it buys.
    const isHot = useRef(false);

    const play = useCallback(() => {
        isHot.current = true;
        const ready = peekVariants();
        if (ready) {
            setVariant(() => ready[name] ?? null);
            setState("animate");
            return;
        }
        void loadVariants()
            .then((variants) => {
                setVariant(() => variants[name] ?? null);
                // The pointer may well have moved on during the download.
                // Cache the component for next time, but do not play an
                // animation for a row the reader has already left.
                if (isHot.current) setState("animate");
            })
            .catch(() => {});
    }, [name]);

    const rest_ = useCallback(() => {
        isHot.current = false;
        setState("normal");
    }, []);

    const attach = useIconTrigger({
        enabled: mode === "animated",
        trigger,
        onEnter: play,
        onLeave: rest_,
    });

    // Skip the initial value, so a bell whose count is already 3 on load does
    // not ring at the reader for something they have not just been told.
    const lastPulse = useRef(pulseKey);
    useEffect(() => {
        if (pulseKey === undefined || pulseKey === lastPulse.current) return;
        lastPulse.current = pulseKey;
        if (mode !== "animated") return;
        play();
        const timer = window.setTimeout(rest_, ICON_PULSE_MS);
        return () => window.clearTimeout(timer);
    }, [pulseKey, mode, play, rest_]);

    // lucide marks unlabelled icons aria-hidden. Reproducing that matters: the
    // labels in this app live on the ANCESTOR (the sidebar row's aria-label,
    // the bell button's), so letting these into the accessibility tree would
    // add fifteen unnamed graphics to the rail. Anything the caller passes
    // explicitly still wins.
    const a11y =
        rest["aria-label"] || rest["aria-labelledby"]
            ? {}
            : { "aria-hidden": true as const };

    const shared = {
        width: size,
        height: size,
        className,
        ref: attach,
        ...a11y,
        ...rest,
    };

    return Variant && mode === "animated" ? (
        <Variant {...shared} size={size} state={state} />
    ) : (
        <Static {...shared} size={size} />
    );
};

export default AnimatedIcon;
