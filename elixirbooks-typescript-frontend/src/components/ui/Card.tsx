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

const BASE = "bg-white border border-border rounded-card shadow-card";

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
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            {title ? (
              <div className="text-base font-semibold text-heading">
                {title}
              </div>
            ) : (
              <span />
            )}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        ))}
      <div className={padded ? "p-5" : undefined}>{children}</div>
      {footer ? (
        <div className="px-5 py-4 border-t border-border">{footer}</div>
      ) : null}
    </Component>
  );
});

export default Card;
