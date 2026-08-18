import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Label rendered next to the radio, associated via htmlFor. */
  label?: ReactNode;
  /** Radio id (also used as the label's `htmlFor`). Auto-generated if omitted. */
  id?: string;
  /** Class name applied to the outer `<label>` wrapper. */
  containerClassName?: string;
}

/**
 * Labeled radio button — same shape/tokens as Checkbox. Uses a native
 * `<input type="radio">` styled via `accent-purple-600`. For a group of
 * options, prefer `RadioGroup` (below) which wires `name`/selection for you.
 */
const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
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
        type="radio"
        disabled={disabled}
        className={[
          "h-4 w-4 border border-border text-purple-600",
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
});

export default Radio;

export interface RadioOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Shared `name` for the native radio group. */
  name: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Simple vertical stack of `Radio`s sharing one `name` + selection state. */
export const RadioGroup = ({
  name,
  options,
  value,
  onChange,
  disabled,
  className = "",
}: RadioGroupProps) => (
  <div role="radiogroup" className={`flex flex-col gap-2 ${className}`}>
    {options.map((opt) => (
      <Radio
        key={opt.value}
        name={name}
        value={opt.value}
        checked={value === opt.value}
        onChange={() => onChange(opt.value)}
        label={opt.label}
        disabled={disabled || opt.disabled}
      />
    ))}
  </div>
);
