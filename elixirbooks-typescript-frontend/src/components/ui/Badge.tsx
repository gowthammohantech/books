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
  "inline-flex items-center gap-1 text-[13px] font-medium px-2 py-0.5 rounded-control";

// Static, fully-spelled class strings so Tailwind v4 JIT can detect them.
// (Never interpolate e.g. `bg-${color}-soft`.)
const STYLES: Record<BadgeColor, Record<BadgeVariant, string>> = {
  primary: {
    soft: "bg-primary-soft text-primary",
    solid: "bg-primary text-white",
    outline: "border border-primary text-primary",
  },
  success: {
    soft: "bg-success-soft text-success",
    solid: "bg-success text-white",
    outline: "border border-success text-success",
  },
  danger: {
    soft: "bg-danger-soft text-danger",
    solid: "bg-danger text-white",
    outline: "border border-danger text-danger",
  },
  warning: {
    soft: "bg-warning-soft text-warning",
    solid: "bg-warning text-white",
    outline: "border border-warning text-warning",
  },
  info: {
    soft: "bg-info-soft text-info",
    solid: "bg-info text-white",
    outline: "border border-info text-info",
  },
  secondary: {
    soft: "bg-surface text-secondary",
    solid: "bg-secondary text-white",
    outline: "border border-secondary text-secondary",
  },
  indigo: {
    soft: "bg-[#EEF0FB] text-indigo",
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
    soft: "bg-surface text-body",
    solid: "bg-gray-700 text-white",
    outline: "border border-border text-body",
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
