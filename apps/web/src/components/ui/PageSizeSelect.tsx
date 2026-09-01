import type { SelectHTMLAttributes } from "react";

export interface PageSizeSelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  /** Current page size. */
  value: number;
  /** Called with the new page size as a number, not the raw event. */
  onChange: (size: number) => void;
  /** Page sizes to offer. */
  options?: number[];
}

const DEFAULT_OPTIONS = [10, 25, 50];

/**
 * The "N / page" control that sits in every list toolbar.
 *
 * This markup was duplicated across ~47 list pages, each carrying its own copy
 * of the same class string — so restyling a list toolbar meant editing 47
 * files, and they had already drifted into six whitespace/text-colour variants.
 *
 * Deliberately not built on `FormField`/`Select`: those apply `w-full`, which
 * is right for a form field in a column but wrong here, where the control sits
 * inline in a toolbar beside the search box.
 *
 * It also carries an accessible name. The raw `<select>`s had no label and no
 * `aria-label`, so screen readers announced them as an unnamed combo box.
 */
export default function PageSizeSelect({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  className = "",
  ...rest
}: PageSizeSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Results per page"
      className={`rounded-md border border-border bg-card px-3 py-2 text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-ring ${className}`}
      {...rest}
    >
      {options.map((num) => (
        <option key={num} value={num}>
          {num} / page
        </option>
      ))}
    </select>
  );
}
