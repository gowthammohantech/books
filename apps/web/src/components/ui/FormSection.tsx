import type { ReactNode } from "react";

/**
 * A titled block of form fields.
 *
 * The heading it replaces was written out by hand in ~25 places across the
 * create screens, in two spellings that had already drifted apart, and the
 * field grid under it in two more. Both are here now, so a create form
 * declares what a section IS rather than restating how one looks.
 */
export type FormSectionColumns = 1 | 2 | 3 | 4 | 6;

export interface FormSectionProps {
  title?: ReactNode;
  /** Secondary line under the title. */
  description?: ReactNode;
  /** Appends the destructive asterisk the rest of the form uses. */
  required?: boolean;
  /** Controls rendered on the heading row, right-aligned. */
  actions?: ReactNode;
  /**
   * When set, wraps children in a field grid resolving to this many columns at
   * `sm` and up, and 1 below it. `6` is the fine-grained track the entity forms
   * use with `sm:col-span-2`. Omit it for a section whose body is not a single
   * flat grid — the children then render exactly as written.
   */
  columns?: FormSectionColumns;
  className?: string;
  children: ReactNode;
}

// Spelled out rather than interpolated: Tailwind scans source text, so a
// computed `sm:grid-cols-${n}` compiles to nothing.
const COLUMNS: Record<FormSectionColumns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 md:grid-cols-4",
  6: "grid-cols-1 sm:grid-cols-6",
};

const FormSection = ({
  title,
  description,
  required = false,
  actions,
  columns,
  className = "",
  children,
}: FormSectionProps) => (
  <section className={className}>
    {title || actions ? (
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0">
          {title ? (
            <h3 className="text-base font-semibold leading-6 text-foreground">
              {title}
              {required && (
                <span className="text-destructive" aria-hidden="true">
                  {" "}
                  *
                </span>
              )}
            </h3>
          ) : null}
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    ) : null}

    {columns ? (
      <div className={`grid gap-4 ${COLUMNS[columns]}`}>{children}</div>
    ) : (
      children
    )}
  </section>
);

export default FormSection;
