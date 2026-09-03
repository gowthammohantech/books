import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Shared control styling for text-like inputs and native selects. Exported so
 * every other primitive (Select, InputField, and the custom controls that
 * imitate an input) can reuse the exact same look.
 *
 * ERPNext fields are FILLED, not outlined: --control-bg at rest with no border
 * at all, and a 2px outer ring on focus. That ring is a box-shadow rather than
 * an outline or a border so it cannot shift layout, which matters at 28px
 * where there is no vertical slack to give back.
 *
 * `disabled:opacity-60` is deliberately gone. Fading a filled control muddies
 * the fill instead of reading as disabled; ERPNext uses an explicit darker
 * fill with dimmer text, which is what --disabled-control-bg is for.
 */
export const fieldControlClasses = (invalid = false) =>
  [
    "w-full bg-muted border-0 rounded-md px-2 py-1 text-sm text-foreground",
    "min-h-[1.75rem] coarse:min-h-[2.75rem]",
    "placeholder:text-gray-600 placeholder:opacity-100",
    "outline-none transition-shadow",
    "disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed",
    invalid
      ? "shadow-[0_0_0_1px_var(--destructive)] focus:shadow-[0_0_0_2px_var(--focus-red)]"
      : "focus:shadow-[0_0_0_2px_var(--focus-neutral)]",
  ].join(" ");

/**
 * Accessibility/identity props FormField hands to whatever control it wraps —
 * exposed to render-prop children so a custom control (e.g. an MUI
 * Autocomplete) can wire the label association and aria state itself.
 */
export interface FormFieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  required?: boolean;
}

export interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "children"> {
  /** Label rendered above the control. */
  label?: ReactNode;
  /** Shows a `text-destructive` asterisk next to the label and forwards `required` to the control. */
  required?: boolean;
  /** Error message rendered below the control in `text-destructive`. Takes priority over `helper`. */
  error?: string;
  /** Helper text rendered below the control when there is no error. */
  helper?: ReactNode;
  /** Field id (also used as the label's `htmlFor`). Auto-generated if omitted. */
  id?: string;
  /** Class name applied to the outer wrapper (label + control + helper/error). */
  containerClassName?: string;
  /**
   * Custom control to render instead of the built-in `<input>` (e.g. a
   * SearchableDropdown or DateInput). May be a node OR a render function that
   * receives the field id + aria props, so a custom control can wire label
   * association and validation state itself.
   */
  children?: ReactNode | ((field: FormFieldControlProps) => ReactNode);
}

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  function FormField(
    {
      label,
      required = false,
      error,
      helper,
      id,
      className = "",
      containerClassName = "",
      children,
      disabled,
      ...rest
    },
    ref,
  ) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const invalid = Boolean(error);
    const errorId = `${fieldId}-error`;
    const helperId = `${fieldId}-helper`;
    const describedBy = error ? errorId : helper ? helperId : undefined;

    const controlProps: FormFieldControlProps = {
      id: fieldId,
      "aria-describedby": describedBy,
      "aria-invalid": invalid || undefined,
      required: required || undefined,
    };

    return (
      <div className={containerClassName}>
        {label ? (
          <label
            htmlFor={fieldId}
            className="block text-sm font-medium text-foreground mb-1"
          >
            {label}{" "}
            {required && (
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            )}
          </label>
        ) : null}

        {typeof children === "function" ? (
          children(controlProps)
        ) : children !== undefined ? (
          children
        ) : (
          <input
            ref={ref}
            id={fieldId}
            disabled={disabled}
            required={required}
            aria-required={required || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={`${fieldControlClasses(invalid)} ${className}`}
            {...rest}
          />
        )}

        {error ? (
          <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        ) : helper ? (
          <p id={helperId} className="mt-1 text-sm text-muted-foreground">
            {helper}
          </p>
        ) : null}
      </div>
    );
  },
);

export default FormField;
