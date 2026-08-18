import React from 'react';
import type { TaxRate } from '@models/taxRate';

interface LineTaxSelectProps {
    id?: string;
    /** Merged Taxes feed rows (GET /admin/tax-rates, contract C6). */
    taxRates: TaxRate[];
    /** Currently selected TaxRate id ('' = No Tax). */
    value: string;
    /** Pinned disabled option shown while a legacy line (group-resolved taxes,
     *  no tax_rate_id yet) hasn't been re-picked. */
    legacyLabel?: string | null;
    onSelect: (taxRateId: string) => void;
    disabled?: boolean;
    className?: string;
}

/**
 * Single per-line Tax dropdown. Replaces BOTH the old per-rate checkbox list
 * and the "Apply Tax Group" dropdown in edit-item modals (spec 2026-07-12).
 */
const LineTaxSelect: React.FC<LineTaxSelectProps> = ({
    id, taxRates, value, legacyLabel, onSelect, disabled = false, className,
}) => (
    <select
        id={id}
        className={className ?? 'p-2 border border-gray-200 rounded text-sm text-gray-700 focus:outline-none'}
        value={value || (legacyLabel ? '__legacy__' : '')}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value === '__legacy__' ? '' : e.target.value)}
    >
        <option value="">No Tax</option>
        {!value && legacyLabel && (
            <option value="__legacy__" disabled>{legacyLabel}</option>
        )}
        {taxRates.map((r) => (
            <option key={r.id} value={r.id}>
                {r.name} ({Number(r.rate)}%)
            </option>
        ))}
    </select>
);

export default LineTaxSelect;
