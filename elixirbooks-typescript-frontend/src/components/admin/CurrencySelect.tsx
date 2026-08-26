import React from 'react';
import { useCurrencies } from '@hooks/useCurrencies';

interface CurrencySelectProps {
    value: string;               // selected currency code
    onChange: (code: string) => void;
    disabled?: boolean;
    label?: string;
}

const CurrencySelect: React.FC<CurrencySelectProps> = ({
    value,
    onChange,
    disabled = false,
    label = 'Currency',
}) => {
    const { currencies, loading } = useCurrencies();

    return (
        <div className="w-full">
            {label && (
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    {label}
                </label>
            )}
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled || loading}
                className={`mt-1 p-2 h-10 w-full border text-gray-700 text-sm border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 ${
                    disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                }`}
            >
                {loading && <option value="">Loading…</option>}
                {!loading && currencies.length === 0 && (
                    <option value={value}>{value}</option>
                )}
                {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                        {c.code} — {c.symbol} {c.name}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default CurrencySelect;
