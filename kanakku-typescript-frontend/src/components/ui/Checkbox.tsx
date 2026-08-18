import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Label rendered next to the checkbox, associated via htmlFor. */
  label?: ReactNode;
  /** Checkbox id (also used as the label's `htmlFor`). Auto-generated if omitted. */
  id?: string;
  /** Class name applied to the outer `<label>` wrapper. */
  containerClassName?: string;
}

/**
 * Labeled checkbox matching the app's token language. Uses a native
 * `<input type="checkbox">` (kept fully accessible/keyboardable) styled via
 * `accent-purple-600` for the brand-purple checked state, plus a token focus
 * ring. Forwards all other input props (checked, onChange, disabled, ...).
 */
const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { label, id, className = "", containerClassName = "", disabled, ...rest },
    ref,
  ) {
    const autoId = useId();
    const fieldId = id ?? autoId;

    return (
      <label
        htmlFor={fieldId}
        className={[
          "inline-flex items-center gap-2",
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          containerClassName,
        ].join(" ")}
      >
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          disabled={disabled}
          className={[
            "h-4 w-4 rounded-[3px] border border-border text-purple-600",
            "accent-purple-600 outline-none transition-colors",
            "focus-visible:ring-1 focus-visible:ring-purple-600",
            "disabled:cursor-not-allowed",
            className,
          ].join(" ")}
          {...rest}
        />
        {label ? <span className="text-sm text-heading">{label}</span> : null}
      </label>
    );
  },
);

export default Checkbox;
