import type { ReactNode } from "react";

export interface FormActionsProps {
  /**
   * Controls pinned to the left of the row — a destructive action, a status
   * line, an "unsaved changes" hint. The primary actions stay on the right.
   */
  leading?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The action row for a form. Sized to wrap rather than overflow, because the
 * document create flows carry three buttons and a drawer is narrower than the
 * full-width page these used to sit on.
 */
const FormActions = ({
  leading,
  className = "",
  children,
}: FormActionsProps) => (
  <div
    className={`flex flex-wrap items-center gap-2 ${
      leading ? "justify-between" : "justify-end"
    } ${className}`}
  >
    {leading ? (
      <div className="flex flex-wrap items-center gap-2">{leading}</div>
    ) : null}
    <div className="flex flex-wrap items-center justify-end gap-2">
      {children}
    </div>
  </div>
);

export default FormActions;
