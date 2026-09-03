import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "soft"
  | "white"
  | "danger"
  | "dangerOutline"
  | "success"
  | "warning"
  | "ghost"
  | "link";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * `icon` is the icon-only affordance: square padding, no gap/text sizing.
   * Pass a single icon as `children` (not `leftIcon`) and always set
   * `aria-label` — there is no visible text for assistive tech to read.
   */
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

// ERPNext buttons are 14px/500 with a 6px gap, an 8px radius (rounded-md
// here, see the radius note in index.css) and letter-spacing 0 — the one
// documented exception to the 0.02em the rest of the UI carries.
const BASE =
  "inline-flex items-center justify-center gap-[0.375rem] font-medium tracking-normal rounded-md transition disabled:opacity-60 disabled:cursor-not-allowed";

// Heights are rem literals, not spacing multiples, so the density scale cannot
// pull a control under the floor. `md` is THE ERPNext button: 28px tall with
// 4px/8px padding.
//
// `sm` differs from `md` in PADDING ONLY, not height. ERPNext has exactly one
// control height and says so ("instead of introducing a second control height
// into a toolbar"), and a shorter variant is also what the floor forbids: an
// earlier pass had sm at 1.5rem and the layout audit found 1,156 sub-floor
// targets across 132 route x viewport combinations. `lg` is 32px, for the one
// primary action at the top of a page, where it is alone rather than in a row.
const SIZES: Record<ButtonSize, string> = {
  sm: "text-[0.8125rem] px-2 py-0.5 min-h-[1.75rem] coarse:min-h-[2.75rem]",
  md: "text-sm px-2 py-1 min-h-[1.75rem] coarse:min-h-[2.75rem]",
  lg: "text-sm px-3 py-1.5 min-h-[2rem] coarse:min-h-[2.75rem]",
  icon: "p-1.5 min-h-[1.75rem] min-w-[1.75rem] coarse:min-h-[2.75rem] coarse:min-w-[2.75rem]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
  // ERPNext's `default`: a gray-100 fill with gray-800 text, hovering to
  // gray-300. No border — --shadow-xs carries a 1px hairline that does that job.
  secondary: "bg-gray-100 text-gray-800 shadow-xs hover:bg-gray-300",
  outline:
    "border border-primary text-primary hover:bg-primary hover:text-primary-foreground",
  soft: "bg-accent text-primary hover:bg-primary hover:text-primary-foreground",
  white: "bg-card border border-border text-foreground hover:bg-muted",
  danger: "bg-destructive text-destructive-foreground hover:opacity-90",
  // Softer red for routine inline actions (e.g. a "Delete" button in a table
  // row) — the solid `danger` fill is reserved for the actual confirm step
  // (delete-confirmation modal), so a screen full of list rows isn't a wall
  // of alarming solid-red buttons.
  dangerOutline: "border border-destructive text-destructive-strong hover:bg-destructive hover:text-destructive-foreground",
  success: "bg-success text-success-foreground hover:opacity-90",
  warning: "bg-warning text-warning-foreground hover:opacity-90",
  ghost: "bg-transparent text-gray-700 hover:bg-gray-200",
  // Text-like, brand-color trigger with no background — for inline/table-cell
  // actions that should read as a link rather than a button chip. Padding
  // still comes from `size` (kept for a consistent hit target); use
  // `className="p-0"` at the call site if you need a truly inline link.
  link: "bg-transparent text-primary hover:underline underline-offset-2 disabled:no-underline",
};

// Scaled down with the controls: a 15px spinner in a 28px button left almost
// no optical padding.
const SPINNER_SIZE: Record<ButtonSize, number> = {
  sm: 12,
  md: 14,
  lg: 14,
  icon: 14,
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    isLoading = false,
    leftIcon,
    rightIcon,
    disabled,
    className = "",
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {isLoading ? (
        <Loader2Icon
          className="animate-spin"
          style={{ width: SPINNER_SIZE[size], height: SPINNER_SIZE[size] }}
          aria-hidden="true"
        />
      ) : (
        leftIcon
      )}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
});

export default Button;
