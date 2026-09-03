import { forwardRef, type HTMLAttributes } from "react";
import Indicator, { type IndicatorHue } from "./Indicator";

/**
 * Adapter over {@link Indicator}, kept so the ~77 files importing Badge do not
 * have to change. `soft` — the default and the overwhelming majority of call
 * sites — is exactly an Indicator; `solid` and `outline` have no ERPNext
 * equivalent and are built from the same ramps rather than invented.
 *
 * New code should reach for Indicator directly.
 */
export type BadgeColor =
  | "primary"
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "secondary"
  | "indigo"
  | "orange"
  | "pink"
  | "teal"
  | "gray";

export type BadgeVariant = "soft" | "solid" | "outline";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
  variant?: BadgeVariant;
}

/**
 * The one place the two blues meet, and it is deliberate: a soft primary badge
 * is informational and takes the blue ramp, a solid one is brand and takes
 * --primary. `indigo` has no ERPNext ramp (it splits that space into purple and
 * violet), so it borrows violet for the tint and keeps --indigo for the fill.
 */
const HUE: Record<BadgeColor, IndicatorHue> = {
  primary: "blue",
  success: "green",
  danger: "red",
  warning: "yellow",
  info: "blue",
  secondary: "gray",
  indigo: "violet",
  orange: "orange",
  pink: "pink",
  teal: "teal",
  gray: "gray",
};

// Static, fully-spelled class strings so Tailwind v4 JIT can detect them.
// (Never interpolate e.g. `bg-${color}-600`.)
const SOLID: Record<BadgeColor, string> = {
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  danger: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-warning-foreground",
  info: "bg-info text-info-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  indigo: "bg-indigo text-primary-foreground",
  orange: "bg-orange text-primary-foreground",
  pink: "bg-pink text-primary-foreground",
  teal: "bg-teal text-primary-foreground",
  gray: "bg-gray-700 text-gray-50",
};

const OUTLINE: Record<BadgeColor, string> = {
  primary: "border border-primary text-primary",
  success: "border border-success text-on-green",
  danger: "border border-destructive text-on-red",
  warning: "border border-warning text-on-yellow",
  info: "border border-info text-on-blue",
  secondary: "border border-border text-secondary-foreground",
  indigo: "border border-indigo text-indigo",
  orange: "border border-orange text-on-orange",
  pink: "border border-pink text-on-pink",
  teal: "border border-teal text-on-teal",
  gray: "border border-border text-muted-foreground",
};

const SHAPE =
  "inline-flex items-center gap-1.5 h-5 px-2 rounded-full text-[0.8125rem] font-medium tracking-ui";

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { color = "gray", variant = "soft", className = "", children, ...rest },
  ref,
) {
  if (variant === "soft") {
    return (
      <Indicator ref={ref} hue={HUE[color]} dot={false} className={className} {...rest}>
        {children}
      </Indicator>
    );
  }

  const tone = variant === "solid" ? SOLID[color] : OUTLINE[color];
  return (
    <span ref={ref} className={`${SHAPE} ${tone} ${className}`} {...rest}>
      {children}
    </span>
  );
});

export default Badge;
