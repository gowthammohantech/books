import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

/**
 * Which end of a variant an icon is currently resting on.
 *
 * pqoqubbw drives this imperatively, with `useAnimation()` controls held in the
 * icon and poked through `useImperativeHandle`. We take it as a prop instead:
 * `useAnimation` is a *value* import from `motion/react`, so calling it in the
 * seam would pull the whole library into the initial bundle and defeat the
 * lazy loading. As a prop, every motion import stays inside this chunk.
 */
export type VariantState = "normal" | "animate";

/**
 * React and motion give the same names to different things.
 *
 * `onAnimationStart` in React is a CSS animation event; in motion it is a
 * callback taking an animation definition. Same for the drag handlers. Spreading
 * React's SVG props onto a `motion.svg` therefore fails to typecheck on exactly
 * these keys — and none of them are props any caller passes to an icon, so the
 * honest fix is to drop them from the contract rather than cast around it.
 */
type ConflictingHandlers =
    | "onAnimationStart"
    | "onAnimationEnd"
    | "onAnimationIteration"
    | "onDrag"
    | "onDragStart"
    | "onDragEnd"
    | "onDragEnter"
    | "onDragExit"
    | "onDragLeave"
    | "onDragOver"
    | "onTransitionEnd"
    // SVG's `values` (an animation attribute) vs motion's MotionValue map.
    | "values"
    | "onUpdate";

export interface AnimatedIconVariantProps
    extends Omit<SVGProps<SVGSVGElement>, "ref" | ConflictingHandlers> {
    size?: number;
    state: VariantState;
}

export type AnimatedIconVariant = ForwardRefExoticComponent<
    AnimatedIconVariantProps & RefAttributes<SVGSVGElement>
>;
