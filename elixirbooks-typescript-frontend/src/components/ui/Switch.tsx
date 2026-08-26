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
 * semantics). Brand-purple "on" state, smooth transition that's disabled
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
        className={[
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
          "transition-colors motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-600 focus-visible:ring-offset-1",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          checked ? "bg-purple-600" : "bg-gray-100",
          className,
        ].join(" ")}
        {...rest}
      >
        <span
          aria-hidden="true"
          className={[
            "inline-block h-5 w-5 transform rounded-full bg-white shadow-card",
            "transition-transform motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
      {label ? (
        <label htmlFor={switchId} className="text-sm text-heading cursor-pointer">
          {label}
        </label>
      ) : null}
    </span>
  );
};

export default Switch;
