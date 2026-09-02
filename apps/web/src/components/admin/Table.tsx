import type { ReactNode } from 'react';

interface TableProps {
  headers: string[];
  children: ReactNode;
  /**
   * Opt-in fixed-width layout: columns are sized from `colWidths` (falling back
   * to an even split) instead of the default "grow to fit content, scroll the
   * container" behaviour. Use this when a page's row content can be safely
   * truncated (e.g. with a `truncate` wrapper) and the row should always fit
   * the viewport without a horizontal scrollbar. Existing callers are
   * unaffected — this defaults to false.
   */
  fitWidth?: boolean;
  /**
   * Tailwind width classes applied 1:1 to each header (and therefore each
   * column, since `table-fixed` sizes columns from the first row). Only used
   * when `fitWidth` is true. Omit an entry (or pass '') to let that column
   * absorb the remaining space.
   */
  colWidths?: string[];
}

const Table = ({ headers, children, fitWidth = false, colWidths }: TableProps) => {
  return (
    <div
      className={
        "w-full rounded-lg border border-gray-100" +
        (fitWidth ? "" : " overflow-x-auto")
      }
    >
      <table
        className={
          "w-full bg-white text-sm text-gray-950 border-collapse border border-gray-100" +
          // min-w-max is deliberate, and was measured before being kept.
          // Switching to min-w-full lets cells wrap so the ACTIONS column is
          // visible without scrolling, but wrapping cost 62px on the invoice
          // list and turned a page that fit at 1366x768 into one that did not
          // (ratio 1.00 -> 1.07). The wrapper is already overflow-x-auto, so a
          // wide table scrolls inside its own container and never widens the
          // page — verified zero horizontal page overflow across 139 routes.
          (fitWidth ? " table-fixed" : " min-w-max")
        }
      >
        {/* No sticky header here, deliberately. `position: sticky` resolves
            against the nearest scrollport, and the wrapper above is
            overflow-x-auto — which CSS promotes to overflow-y: auto — so the
            wrapper, not <main>, is that scrollport, and it never scrolls
            vertically. Measured: with `sticky top-0` the header still moved the
            full 400px on scroll. Making it work needs the wrapper to own the
            vertical scroll (a max-height on every table), which is a bigger
            change than this. */}
        <thead className="bg-gray-100 uppercase text-xs font-semibold text-gray-900">
          <tr>
            {headers.map((header, idx) => (
              <th
                key={idx}
                className={
                  "px-3 py-2 text-left border-b border-gray-100" +
                  (fitWidth ? ` ${colWidths?.[idx] ?? ""}` : "")
                }
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
    </div>

  );
};

export default Table;
