import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

/**
 * The status primitive.
 *
 * ERPNext has exactly one of these — a fully-rounded 20px chip at 13px/420 with
 * a 6px leading dot — and every status in the desk is a hue applied to it. This
 * app had grown five parallel implementations instead (ui/Badge plus four
 * domain badges), three of which hard-coded stock Tailwind hues and one of
 * which invented its own geometry. They are all adapters over this now, so a
 * change to pill shape happens once.
 *
 * Colour comes only from the LAYER 3 tinted pairs: `bg-tint-{hue}` with its
 * matching `text-on-{hue}`, every combination of which is contrast-checked by
 * scripts/check-contrast.mjs. No call site should ever pick a ramp step.
 */
export type IndicatorHue =
  | "gray"
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "yellow"
  | "amber"
  | "purple"
  | "violet"
  | "pink"
  | "teal"
  | "cyan";

export interface IndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  hue?: IndicatorHue;
  /**
   * ERPNext's 6px leading dot. It is a real element rather than a ::before so
   * it can be dropped from a prop — a pseudo-element would need a second class
   * to suppress, which is what `.no-indicator-dot` is upstream.
   */
  dot?: boolean;
  /** ERPNext's `-round` variant: a 24px circle, for counts. */
  round?: boolean;
  /**
   * Trailing glyph. It inherits `currentColor` from the pill, so never colour
   * it at the call site — that is what made the old badges drift out of step
   * with their own backgrounds.
   */
  icon?: ReactNode;
}

// Static, fully-spelled class strings so Tailwind v4's JIT can detect them.
// (Never interpolate e.g. `bg-tint-${hue}`.)
const HUES: Record<IndicatorHue, string> = {
  gray: "bg-tint-gray text-on-gray",
  blue: "bg-tint-blue text-on-blue",
  green: "bg-tint-green text-on-green",
  red: "bg-tint-red text-on-red",
  orange: "bg-tint-orange text-on-orange",
  yellow: "bg-tint-yellow text-on-yellow",
  amber: "bg-tint-amber text-on-amber",
  purple: "bg-tint-purple text-on-purple",
  violet: "bg-tint-violet text-on-violet",
  pink: "bg-tint-pink text-on-pink",
  teal: "bg-tint-teal text-on-teal",
  cyan: "bg-tint-cyan text-on-cyan",
};

const BASE =
  "inline-flex items-center gap-1.5 rounded-full text-[0.8125rem] font-medium tracking-ui";
const PILL = "h-5 px-2";
const ROUND = "h-6 w-6 justify-center px-0";

const Indicator = forwardRef<HTMLSpanElement, IndicatorProps>(function Indicator(
  {
    hue = "gray",
    dot = true,
    round = false,
    icon,
    className = "",
    children,
    ...rest
  },
  ref,
) {
  return (
    <span
      ref={ref}
      className={`${BASE} ${round ? ROUND : PILL} ${HUES[hue]} ${className}`}
      {...rest}
    >
      {dot && !round ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
      {icon}
    </span>
  );
});

export default Indicator;
