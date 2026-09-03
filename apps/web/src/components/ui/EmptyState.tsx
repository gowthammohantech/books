import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  loadIllustration,
  peekIllustration,
  type IllustrationKey,
} from "@utils/illustrations";

/**
 * Everything that varies by size, in one table.
 *
 * This was four separate `size === "full" ? … : …` ternaries. That shape only
 * works while there are two sizes: a third key compiles, renders, and silently
 * takes the *compact* branch of every one of them. Adding `hero` meant either
 * rewriting four conditions or getting a 320px illustration with 88px spacing,
 * so the table replaced them first.
 *
 * `art` is the illustration box in px; the rest are class strings.
 */
const SIZE = {
  full: {
    art: 200,
    root: "gap-1 px-6 py-10",
    title: "mt-4 text-base",
    description: "text-sm",
    action: "mt-4",
  },
  compact: {
    art: 88,
    root: "gap-0.5 px-4 py-6",
    title: "mt-2 text-sm",
    description: "text-xs",
    action: "mt-3",
  },
} as const;

export type EmptyStateSize = keyof typeof SIZE;

/** The hero draws much larger than either stacked size. */
const HERO_ART = 320;

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
const Illustration = ({
  art,
  px,
  className = "",
}: {
  art: IllustrationKey;
  px: number;
  className?: string;
}) => {
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

  return (
    <div
      aria-hidden="true"
      className={`eb-illustration shrink-0 ${className}`}
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
 * Use `EmptyStateRow` when this belongs in a `<tbody>`; a `<div>` is not valid
 * there. Use `EmptyStateHero` for a list that has never had a record, where the
 * table should not be on screen at all.
 */
const EmptyState = ({
  art = "no-data",
  title,
  description,
  action,
  size = "full",
  className = "",
}: EmptyStateProps) => {
  const s = SIZE[size];

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${s.root} ${className}`}
    >
      <Illustration art={art} px={s.art} />
      <p className={`font-medium text-gray-700 ${s.title}`}>{title}</p>
      {description && (
        <p className={`max-w-sm text-gray-700 ${s.description}`}>{description}</p>
      )}
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
};

export default EmptyState;

export interface EmptyStateRowProps extends EmptyStateProps {
  /** Must span the whole table, or the cell sits under the first column only. */
  colSpan: number;
}

/**
 * `EmptyState` as a table row. Defaults to `compact`: these appear in dense
 * report tables where a full-height illustration would push the totals off
 * screen.
 *
 * Note this cannot take the hero — that is a separate component rather than a
 * third size precisely so it cannot be dropped into a `<td>`, where a wide
 * two-column layout under a table header is exactly wrong.
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

export interface EmptyStateHeroProps {
  art?: IllustrationKey;
  /** The headline. A statement of what this page is for, not "No data found". */
  title: string;
  /** One orienting sentence. Use on utility lists that do not warrant bullets. */
  description?: string;
  /**
   * Benefit lines, drawn as check bullets. For the lists a workspace actually
   * starts from; a Units master does not need three selling points.
   */
  bullets?: string[];
  /**
   * The way out. May be falsy — a user without create permission still gets the
   * explanation, just no button that would fail.
   */
  action?: ReactNode;
  className?: string;
}

/**
 * The first-run state for a list that has never held a record.
 *
 * Distinct from `EmptyStateRow` on purpose. A filtered list that matched nothing
 * still has a table worth showing — its header says what the columns are, and
 * the user is one keystroke from results. A list that has never had a record has
 * no such context: the header row, the search box and a pagination bar reading
 * "Showing 0 to 0 of 0 entries" are furniture around an absence. So the page
 * drops all of it and shows this instead.
 *
 * Callers are responsible for the condition — see `isFirstRun` on the list
 * pages — because only the page knows whether a filter is active.
 *
 * The bullets reuse the chip-and-check idiom from `AuthShell`, so the first
 * screen after signing in and the first screen of an empty workspace read as
 * the same product.
 */
export const EmptyStateHero = ({
  art = "no-data",
  title,
  description,
  bullets,
  action,
  className = "",
}: EmptyStateHeroProps) => (
  <div
    className={`flex flex-col items-center gap-8 px-6 py-12 text-center md:flex-row md:justify-center md:gap-14 md:text-left ${className}`}
  >
    {/* `max-w-full` because the box is a fixed px square and `shrink-0`: without
        it the artwork refuses to give ground on a narrow viewport and pushes the
        copy off screen. */}
    <Illustration art={art} px={HERO_ART} className="max-w-full" />

    <div className="max-w-md">
      <h2 className="text-2xl font-bold leading-tight text-gray-900 sm:text-3xl">
        {title}
      </h2>

      {description && <p className="mt-3 text-gray-700">{description}</p>}

      {bullets && bullets.length > 0 && (
        <ul className="mt-6 space-y-3">
          {bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex items-start gap-3 text-left"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-primary"
              >
                <Check size={12} strokeWidth={3} />
              </span>
              <span className="text-sm text-gray-700">{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      {action && <div className="mt-8">{action}</div>}
    </div>
  </div>
);
