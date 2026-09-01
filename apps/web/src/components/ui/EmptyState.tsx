import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  loadIllustration,
  peekIllustration,
  type IllustrationKey,
} from "@utils/illustrations";

/** How large the artwork is drawn, in px. `full` for a page or panel that has
 *  room; `compact` for a row inside a table that should not triple in height. */
const ART_SIZE = { full: 200, compact: 88 } as const;

export type EmptyStateSize = keyof typeof ART_SIZE;

export interface EmptyStateProps {
  /** Which illustration to draw. Defaults to the generic `no-data`. */
  art?: IllustrationKey;
  /** The one line that carries the meaning. Required — the picture is decoration. */
  title: string;
  /** Optional second line saying what to do about it. */
  description?: string;
  /** Optional call to action, usually a `<Button>`. */
  action?: ReactNode;
  size?: EmptyStateSize;
  className?: string;
}

/**
 * Renders the artwork, once it has arrived.
 *
 * The box is sized before the markup loads so that a late illustration does not
 * shove the message down the page — see the note on on-demand loading in
 * `utils/illustrations.ts`. If the chunk never arrives the box collapses and the
 * message stands on its own, which is the whole reason `loadIllustration`
 * resolves null instead of throwing.
 *
 * `aria-hidden`, because the title beneath it already says this in words.
 */
const Illustration = ({ art, size }: { art: IllustrationKey; size: EmptyStateSize }) => {
  const [markup, setMarkup] = useState(() => peekIllustration(art));
  // Guards against a resolve landing after the art prop changed or the row
  // unmounted, which in a filtered table happens on nearly every keystroke.
  const wanted = useRef(art);

  useEffect(() => {
    wanted.current = art;
    const cached = peekIllustration(art);
    if (cached) {
      setMarkup(cached);
      return;
    }

    setMarkup(null);
    let live = true;
    void loadIllustration(art).then((loaded) => {
      if (live && wanted.current === art) setMarkup(loaded);
    });
    return () => {
      live = false;
    };
  }, [art]);

  const px = ART_SIZE[size];

  return (
    <div
      aria-hidden="true"
      className="eb-illustration shrink-0"
      style={{ width: px, height: px }}
      {...(markup
        ? { dangerouslySetInnerHTML: { __html: markup } }
        : undefined)}
    />
  );
};

/**
 * The empty state: a picture, a line saying what is missing, and — where there
 * is something useful to do — a way to do it.
 *
 * Use `EmptyStateRow` instead when this belongs in a `<tbody>`; a `<div>` is
 * not valid there.
 */
const EmptyState = ({
  art = "no-data",
  title,
  description,
  action,
  size = "full",
  className = "",
}: EmptyStateProps) => (
  <div
    className={`flex flex-col items-center justify-center text-center ${
      size === "full" ? "gap-1 px-6 py-10" : "gap-0.5 px-4 py-6"
    } ${className}`}
  >
    <Illustration art={art} size={size} />
    <p
      className={`font-medium text-gray-700 ${size === "full" ? "mt-4 text-base" : "mt-2 text-sm"}`}
    >
      {title}
    </p>
    {description && (
      <p className={`max-w-sm text-gray-500 ${size === "full" ? "text-sm" : "text-xs"}`}>
        {description}
      </p>
    )}
    {action && <div className={size === "full" ? "mt-4" : "mt-3"}>{action}</div>}
  </div>
);

export default EmptyState;

export interface EmptyStateRowProps extends EmptyStateProps {
  /** Must span the whole table, or the cell sits under the first column only. */
  colSpan: number;
}

/**
 * `EmptyState` as a table row. Defaults to `compact`: these appear in dense
 * report tables where a full-height illustration would push the totals off
 * screen.
 */
export const EmptyStateRow = ({
  colSpan,
  size = "compact",
  className = "",
  ...rest
}: EmptyStateRowProps) => (
  <tr>
    <td colSpan={colSpan} className="p-0">
      <EmptyState size={size} className={className} {...rest} />
    </td>
  </tr>
);
