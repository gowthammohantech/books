import { useCallback } from "react";

import { TRIGGER_SELECTOR, type IconTrigger } from "./iconMotionSupport";

interface TriggerOptions {
    enabled: boolean;
    trigger: IconTrigger;
    onEnter: () => void;
    onLeave: () => void;
}

/**
 * Binds an icon's animation to the thing a reader actually points at.
 *
 * The icon is almost never the hover target. In the sidebar the pointer is over
 * a 240px <Link> row; in a Button it is over the button; in ActionMenu it is
 * over a portalled <li>. So rather than ask every call site to wire something
 * up, the icon walks up the DOM and listens on whatever it finds.
 *
 * `closest` walks the DOM rather than the React tree, which is why this keeps
 * working through createPortal — ActionMenu's menu items resolve to their own
 * buttons even though React renders them from a different subtree.
 *
 * Returned as a ref CALLBACK with a cleanup, rather than a useEffect: React 19
 * re-runs it exactly when the icon's DOM node identity changes, and the
 * static -> animated swap changes the node. A useEffect with [] deps would
 * leave four listeners bound to a detached ancestor.
 */
export const useIconTrigger = ({ enabled, trigger, onEnter, onLeave }: TriggerOptions) =>
    useCallback(
        (node: SVGSVGElement | null) => {
            if (!node || !enabled || trigger === "none") return;

            const target =
                trigger === "self"
                    ? (node.parentElement as HTMLElement | null)
                    : node.closest<HTMLElement>(TRIGGER_SELECTOR);

            // Nothing interactive above us: StatsCard's decorative chip, the
            // breadcrumb separator, SettingsLayout's <p>. A documented no-op,
            // not a bug — the icon stays static, no listener is bound and no
            // chunk is fetched. Put `data-icon-trigger` on the container if you
            // want one of these alive.
            if (!target) return;

            // Hover and focus are independent sources, so a boolean is wrong:
            // moving the pointer off a row you are still tabbed into would
            // cancel the animation while the row is visibly still focused.
            let depth = 0;

            const enter = (event: Event) => {
                // A touch "hover" fires once and never leaves, which would pin
                // the icon in its animated state for the rest of the session.
                if (
                    event.type === "pointerenter" &&
                    (event as PointerEvent).pointerType === "touch"
                )
                    return;
                if (depth++ === 0) onEnter();
            };

            const leave = () => {
                depth -= 1;
                if (depth <= 0) {
                    depth = 0;
                    onLeave();
                }
            };

            // pointerenter/pointerleave do NOT bubble, so they must sit on the
            // target itself. focusin/focusout DO bubble, which is what we want:
            // tabbing to the sidebar's nested AddButton should light its row.
            target.addEventListener("pointerenter", enter);
            target.addEventListener("pointerleave", leave);
            target.addEventListener("focusin", enter);
            target.addEventListener("focusout", leave);

            return () => {
                target.removeEventListener("pointerenter", enter);
                target.removeEventListener("pointerleave", leave);
                target.removeEventListener("focusin", enter);
                target.removeEventListener("focusout", leave);
            };
        },
        [enabled, trigger, onEnter, onLeave],
    );
