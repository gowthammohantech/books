import { XIcon } from 'lucide-react';

export interface ActiveFilter {
    label: string;
    value: string;
}

interface Props {
    filters: ActiveFilter[];
    onClear: () => void;
}

/**
 * Shown on list pages when they are opened pre-filtered via a drill-down from an
 * accounting report. Surfaces the active filters (which otherwise have no UI on
 * these pages) and offers a one-click Clear. Renders nothing when no filters.
 */
const ActiveFilterBanner: React.FC<Props> = ({ filters, onClear }) => {
    if (filters.length === 0) return null;

    return (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm">
            <span className="font-medium text-purple-700">Filtered from report:</span>
            {filters.map((f) => (
                <span
                    key={f.label}
                    className="inline-flex items-center rounded-full bg-white border border-purple-200 px-2 py-0.5 text-xs text-gray-700"
                >
                    <span className="text-gray-500 mr-1">{f.label}:</span>
                    {f.value}
                </span>
            ))}
            <button
                type="button"
                onClick={onClear}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900 cursor-pointer"
            >
                <XIcon size={14} /> Clear filters
            </button>
        </div>
    );
};

export default ActiveFilterBanner;
