import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Label rendered next to the switch, associated via htmlFor (button is a labelable element). */
  label?: ReactNode;
  disabled?: boolean;
  /** Switch id (also used as the label's `htmlFor`). Auto-generated if omitted. */
  id?: string;
  /** Class name applied to the outer wrapper (switch + label). */
  containerClassName?: string;
}

/**
 * Toggle switch built on a real `<button role="switch" aria-checked>` (not a
 * checked-checkbox-in-disguise), so it behaves like a native switch for
 * screen readers and keyboard users (Space/Enter toggle via button
 * semantics). Brand-colored "on" state, smooth transition that's disabled
 * under `prefers-reduced-motion`.
 */
const Switch = ({
  checked,
  onChange,
  label,
  disabled,
  id,
  className = "",
  containerClassName = "",
  ...rest
}: SwitchProps) => {
  const autoId = useId();
  const switchId = id ?? autoId;

  return (
    <span className={`inline-flex items-center gap-2 ${containerClassName}`}>
      <button
        type="button"
        id={switchId}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        // Opts out of the global min-height floor: a switch forced to 32px
        // stops being a switch and becomes a rounded rectangle. The target is
        // grown instead by a transparent pseudo-element centred on the pill,
        // which reaches the 32/44px floor without touching the visual size.
        data-hit="tight"
        className={[
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
          "before:absolute before:left-0 before:top-1/2 before:h-8 before:w-full",
          "before:-translate-y-1/2 before:content-[''] coarse:before:h-11",
          "transition-colors motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          checked ? "bg-primary" : "bg-gray-100",
          className,
        ].join(" ")}
        {...rest}
      >
        <span
          aria-hidden="true"
          className={[
            "inline-block h-5 w-5 transform rounded-full bg-card shadow-sm",
            "transition-transform motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
      {label ? (
        <label htmlFor={switchId} className="text-sm text-foreground cursor-pointer">
          {label}
        </label>
      ) : null}
    </span>
  );
};

export default Switch;
