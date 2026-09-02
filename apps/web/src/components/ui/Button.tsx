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

const BASE =
  "inline-flex items-center justify-center gap-1.5 font-semibold rounded-md transition disabled:opacity-60 disabled:cursor-not-allowed";

// Heights are rem literals, not spacing multiples, so the density scale cannot
// pull a control under the 32px floor. `sm` was measuring ~30px before this —
// under the minimum already, without any density work.
const SIZES: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5 min-h-[2rem] coarse:min-h-[2.75rem]",
  md: "text-[0.8125rem] px-3 py-2 min-h-[2.25rem] coarse:min-h-[2.75rem]",
  lg: "text-sm px-4 py-2.5 min-h-[2.5rem] coarse:min-h-[2.75rem]",
  icon: "p-2 min-h-[2rem] min-w-[2rem] coarse:min-h-[2.75rem] coarse:min-w-[2.75rem]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
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
  ghost: "text-muted-foreground hover:bg-muted",
  // Text-like, brand-color trigger with no background — for inline/table-cell
  // actions that should read as a link rather than a button chip. Padding
  // still comes from `size` (kept for a consistent hit target); use
  // `className="p-0"` at the call site if you need a truly inline link.
  link: "bg-transparent text-primary hover:underline underline-offset-2 disabled:no-underline",
};

const SPINNER_SIZE: Record<ButtonSize, number> = {
  sm: 14,
  md: 15,
  lg: 16,
  icon: 15,
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
