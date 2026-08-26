import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Shared control styling for text-like inputs and native selects, matching
 * the app's token language (bg-surface, border-border, rounded-control,
 * purple-600 focus ring). Exported so other primitives (e.g. Select) can
 * reuse the exact same look.
 */
export const fieldControlClasses = (invalid = false) =>
  [
    "w-full bg-surface border rounded-control px-3 py-2 text-[13px] text-heading",
    "placeholder:text-body outline-none transition-colors",
    "focus:ring-1 disabled:opacity-60 disabled:cursor-not-allowed",
    invalid
      ? "border-danger focus:border-danger focus:ring-danger"
      : "border-border focus:border-purple-600 focus:ring-purple-600",
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
  /** Shows a `text-danger` asterisk next to the label and forwards `required` to the control. */
  required?: boolean;
  /** Error message rendered below the control in `text-danger`. Takes priority over `helper`. */
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
            className="block text-sm font-medium text-heading mb-1"
          >
            {label}{" "}
            {required && (
              <span className="text-danger" aria-hidden="true">
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
          <p id={errorId} role="alert" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : helper ? (
          <p id={helperId} className="mt-1 text-sm text-body">
            {helper}
          </p>
        ) : null}
      </div>
    );
  },
);

export default FormField;
