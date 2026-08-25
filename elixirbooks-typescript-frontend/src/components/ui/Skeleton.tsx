import type { HTMLAttributes } from "react";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Pulse loading placeholder. Size it via `className` (e.g. `h-4 w-32`,
 * `h-10 w-10 rounded-full`). Decorative — hidden from assistive tech; wrap
 * the loading region in `aria-busy`/`aria-live` at the call site if a status
 * announcement is needed. `animate-pulse` is disabled under
 * `prefers-reduced-motion`.
 */
const Skeleton = ({ className = "", ...rest }: SkeletonProps) => (
  <div
    aria-hidden="true"
    className={`animate-pulse motion-reduce:animate-none rounded-control bg-gray-100 ${className}`}
    {...rest}
  />
);

export default Skeleton;

export interface SkeletonTextProps extends SkeletonProps {
  /** Number of placeholder lines. Defaults to 3; the last line is shorter. */
  lines?: number;
}

/** Stack of skeleton lines for paragraph/label placeholders. */
export const SkeletonText = ({
  lines = 3,
  className = "",
  ...rest
}: SkeletonTextProps) => (
  <div className={`space-y-2 ${className}`} {...rest}>
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton
        key={index}
        className={`h-3 ${index === lines - 1 ? "w-2/3" : "w-full"}`}
      />
    ))}
  </div>
);

export interface SkeletonRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of column placeholders. Defaults to 4. */
  columns?: number;
}

/** A single skeleton table row — drop in place of `<tr>`/list-row content while loading. */
export const SkeletonRow = ({
  columns = 4,
  className = "",
  ...rest
}: SkeletonRowProps) => (
  <div
    role="presentation"
    className={`flex items-center gap-4 py-3 ${className}`}
    {...rest}
  >
    {Array.from({ length: columns }).map((_, index) => (
      <Skeleton key={index} className="h-4 flex-1" />
    ))}
  </div>
);
