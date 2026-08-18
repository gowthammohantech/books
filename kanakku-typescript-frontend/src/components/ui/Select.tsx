import {
  forwardRef,
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import FormField, { fieldControlClasses } from "./FormField";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  helper?: ReactNode;
  id?: string;
  containerClassName?: string;
  /** Declarative options list. If omitted, pass `<option>` children instead. */
  options?: SelectOption[];
  /** Renders a disabled, hidden leading option (e.g. "Select Gender"). */
  placeholder?: string;
}

/**
 * Styled native `<select>` matching FormField's input styling (same
 * border/radius/focus/text tokens) with the same label/error/required
 * wrapper. Uses a real `<select>` for accessibility — not a custom dropdown.
 * Delegates the wrapper (label + error/helper + aria wiring) to FormField's
 * render-prop children so the id/aria-describedby association stays in sync.
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    required = false,
    error,
    helper,
    id,
    className = "",
    containerClassName = "",
    options,
    placeholder,
    disabled,
    children,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const invalid = Boolean(error);

  return (
    <FormField
      label={label}
      required={required}
      error={error}
      helper={helper}
      id={fieldId}
      containerClassName={containerClassName}
    >
      {(field) => (
        <select
          ref={ref}
          id={field.id}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={field["aria-invalid"]}
          aria-describedby={field["aria-describedby"]}
          className={`${fieldControlClasses(invalid)} ${className}`}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          ) : null}
          {options
            ? options.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                >
                  {opt.label}
                </option>
              ))
            : children}
        </select>
      )}
    </FormField>
  );
});

export default Select;
