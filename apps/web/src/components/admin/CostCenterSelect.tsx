import React from 'react';
import { Select } from '@components/ui';
import { useCostCenters, type CostCenterUsage } from '@hooks/useCostCenters';

/** Mirrors LINE_CENTRE_NONE in the backend's lib/lineDimensions.ts.
 *
 *  A line select needs THREE states, but a native <select> only gives us
 *  strings: '' means "inherit the document's centre" (the common case, and what
 *  an untouched control posts), so clearing a single line needs a sentinel of
 *  its own. */
export const LINE_CENTRE_NONE = '__none__';

interface CostCenterSelectProps {
    /** `header` = the document-level picker; `line` = the compact per-row one. */
    mode?: 'header' | 'line';
    /** Selected centre id. For `line` mode, '' means inherit the header. */
    value: string;
    onChange: (costCenterId: string) => void;
    /** Restricts the list by centre type; BOTH always qualifies. */
    usage?: CostCenterUsage;
    label?: string;
    id?: string;
    disabled?: boolean;
    error?: string;
    className?: string;
    containerClassName?: string;
    /** Header mode only: label shown for the "no centre" choice. */
    placeholder?: string;
}

/**
 * Profit Centre picker, shared by every document form.
 *
 * Both modes pin a disabled option for a value that is no longer selectable —
 * an inactive centre, or one whose type does not match this document. Without
 * that pin, opening an old invoice would silently re-post it to a different
 * department (or to none) the moment it was saved.
 */
const CostCenterSelect: React.FC<CostCenterSelectProps> = ({
    mode = 'header',
    value,
    onChange,
    usage = 'any',
    label = 'Profit Center',
    id,
    disabled = false,
    error,
    className,
    containerClassName,
    placeholder = 'No profit center',
}) => {
    const { options, resolveCostCenter, loading } = useCostCenters(usage);

    const selectable = options.filter((c) => c.isActive);
    const isRealValue = value && value !== LINE_CENTRE_NONE;
    const stale = isRealValue && !selectable.some((c) => c.id === value)
        ? resolveCostCenter(value)
        : null;

    const staleOption = stale ? (
        <option value={stale.id} disabled>
            {stale.code} — {stale.name} {stale.isActive ? '(unavailable here)' : '(inactive)'}
        </option>
    ) : null;

    if (mode === 'line') {
        return (
            <select
                id={id}
                className={className ?? 'p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none'}
                value={value}
                disabled={disabled || loading}
                onChange={(e) => onChange(e.target.value)}
                aria-label="Line profit center"
            >
                <option value="">Same as document</option>
                <option value={LINE_CENTRE_NONE}>No profit center</option>
                {staleOption}
                {selectable.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                    </option>
                ))}
            </select>
        );
    }

    return (
        <Select
            id={id}
            label={label}
            error={error}
            disabled={disabled || loading}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={className}
            containerClassName={containerClassName}
        >
            <option value="">{placeholder}</option>
            {staleOption}
            {selectable.map((c) => (
                <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                </option>
            ))}
        </Select>
    );
};

export default CostCenterSelect;
