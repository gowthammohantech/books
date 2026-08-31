import { forwardRef, type HTMLAttributes } from "react";

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

const BASE =
  "inline-flex items-center gap-1 text-[13px] font-medium px-2 py-0.5 rounded-md";

// Static, fully-spelled class strings so Tailwind v4 JIT can detect them.
// (Never interpolate e.g. `bg-${color}-soft`.)
const STYLES: Record<BadgeColor, Record<BadgeVariant, string>> = {
  primary: {
    soft: "bg-accent text-primary",
    solid: "bg-primary text-primary-foreground",
    outline: "border border-primary text-primary",
  },
  success: {
    soft: "bg-success-soft text-success-strong",
    solid: "bg-success text-success-foreground",
    outline: "border border-success text-success-strong",
  },
  danger: {
    soft: "bg-destructive-soft text-destructive-strong",
    solid: "bg-destructive text-destructive-foreground",
    outline: "border border-destructive text-destructive-strong",
  },
  warning: {
    soft: "bg-warning-soft text-warning-strong",
    solid: "bg-warning text-warning-foreground",
    outline: "border border-warning text-warning-strong",
  },
  info: {
    soft: "bg-info-soft text-info-strong",
    solid: "bg-info text-info-foreground",
    outline: "border border-info text-info-strong",
  },
  secondary: {
    soft: "bg-muted text-secondary-foreground",
    solid: "bg-secondary text-secondary-foreground",
    outline: "border border-border text-secondary-foreground",
  },
  indigo: {
    soft: "bg-accent text-indigo",
    solid: "bg-indigo text-white",
    outline: "border border-indigo text-indigo",
  },
  orange: {
    soft: "bg-orange-soft text-orange",
    solid: "bg-orange text-white",
    outline: "border border-orange text-orange",
  },
  pink: {
    soft: "bg-pink-soft text-pink",
    solid: "bg-pink text-white",
    outline: "border border-pink text-pink",
  },
  teal: {
    soft: "bg-teal-soft text-teal",
    solid: "bg-teal text-white",
    outline: "border border-teal text-teal",
  },
  gray: {
    soft: "bg-muted text-muted-foreground",
    solid: "bg-gray-700 text-gray-50",
    outline: "border border-border text-muted-foreground",
  },
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { color = "gray", variant = "soft", className = "", children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={`${BASE} ${STYLES[color][variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
});

export default Badge;
