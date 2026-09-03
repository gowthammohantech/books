import {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export interface CardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  as?: ElementType;
  padded?: boolean;
  header?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}

// One step down from p-5 / px-5 py-4. Card is the most-reused surface in the
// app, so this is the single highest-leverage padding change available — and
// it compounds with the --spacing rescale rather than duplicating it.
const BASE = "bg-card border border-border rounded-md shadow-sm";

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    as,
    padded = true,
    header,
    title,
    actions,
    footer,
    className = "",
    children,
    ...rest
  },
  ref,
) {
  const Component = (as ?? "div") as ElementType;
  const hasHeader = Boolean(header || title || actions);

  return (
    <Component ref={ref} className={`${BASE} ${className}`} {...rest}>
      {hasHeader &&
        (header ?? (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            {title ? (
              <div className="text-base font-semibold text-foreground">
                {title}
              </div>
            ) : (
              <span />
            )}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        ))}
      <div className={padded ? "p-4" : undefined}>{children}</div>
      {footer ? (
        <div className="px-4 py-3 border-t border-border">{footer}</div>
      ) : null}
    </Component>
  );
});

export default Card;
