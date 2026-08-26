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
          (fitWidth ? " table-fixed" : " min-w-max")
        }
      >
        <thead className="bg-gray-100 uppercase text-xs font-semibold text-gray-900">
          <tr>
            {headers.map((header, idx) => (
              <th
                key={idx}
                className={
                  "px-4 py-3 text-left border-b border-gray-100" +
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
