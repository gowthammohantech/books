import type { ReactNode } from 'react';
import { Link, createSearchParams } from 'react-router-dom';

type ParamValue = string | number | null | undefined;

interface Props {
    /**
     * Target route to drill into (e.g. "/admin/invoices"). When omitted the
     * value renders as plain text — used for derived/arithmetic figures
     * (Gross Profit, Net Income, …) that have no underlying row set.
     */
    to?: string;
    /** Query params appended to the target; null/undefined/'' entries are dropped. */
    params?: Record<string, ParamValue>;
    children: ReactNode;
    /** Tooltip, e.g. "View source invoices". */
    title?: string;
    className?: string;
}

/**
 * Renders a reported number as a clickable link that navigates to the matching
 * filtered list page (invoices / purchases / expenses …) so users can see the
 * source documents behind a figure on the accounting reports. Falls back to a
 * plain span when `to` is not provided.
 */
const DrillLink: React.FC<Props> = ({ to, params, children, title, className }) => {
    if (!to) {
        return <span className={className}>{children}</span>;
    }

    const cleaned: Record<string, string> = {};
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (value !== null && value !== undefined && String(value).trim() !== '') {
                cleaned[key] = String(value);
            }
        }
    }
    const search = `?${createSearchParams(cleaned).toString()}`;

    return (
        <Link
            to={{ pathname: to, search }}
            title={title ?? 'View source records'}
            className={`text-purple-600 underline decoration-dotted underline-offset-2 hover:decoration-solid cursor-pointer ${className ?? ''}`}
        >
            {children}
        </Link>
    );
};

export default DrillLink;
