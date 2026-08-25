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
  "inline-flex items-center justify-center gap-1.5 font-semibold rounded-control transition disabled:opacity-60 disabled:cursor-not-allowed";

const SIZES: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5",
  md: "text-[13px] px-3 py-2",
  lg: "text-sm px-4 py-2.5",
  icon: "p-2",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-purple-600 text-white hover:bg-purple-700",
  secondary: "bg-secondary text-white hover:opacity-90",
  outline:
    "border border-purple-600 text-purple-600 hover:bg-purple-600 hover:text-white",
  soft: "bg-[#F8F5FF] text-purple-600 hover:bg-purple-600 hover:text-white",
  white: "bg-white border border-border text-heading hover:bg-surface",
  danger: "bg-danger text-white hover:opacity-90",
  // Softer red for routine inline actions (e.g. a "Delete" button in a table
  // row) — the solid `danger` fill is reserved for the actual confirm step
  // (delete-confirmation modal), so a screen full of list rows isn't a wall
  // of alarming solid-red buttons.
  dangerOutline: "border border-danger text-danger hover:bg-danger hover:text-white",
  success: "bg-success text-white hover:opacity-90",
  warning: "bg-warning text-white hover:opacity-90",
  ghost: "text-body hover:bg-surface",
  // Text-like, brand-color trigger with no background — for inline/table-cell
  // actions that should read as a link rather than a button chip. Padding
  // still comes from `size` (kept for a consistent hit target); use
  // `className="p-0"` at the call site if you need a truly inline link.
  link: "bg-transparent text-purple-600 hover:underline underline-offset-2 disabled:no-underline",
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
