import React from 'react';

interface SwitchProps {
    name: string;
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    disabled?: boolean;
    className?: string;
}

const Switch: React.FC<SwitchProps> = ({ name, checked, onChange, disabled = false, className = '' }) => {

    const handleToggle = () => {
        const event = {
            target: {
                name,
                type: 'checkbox',
                checked: !checked,
            },
        } as React.ChangeEvent<HTMLInputElement>;

        onChange(event);
    };

    return (
        <label className={`inline-flex items-center cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
            <input
                type="checkbox"
                name={name}
                className="sr-only peer"
                checked={checked}
                onChange={handleToggle}
                disabled={disabled}
                id={name}
            />
            <div className="relative w-11 h-6 bg-gray-200 peer-checked:bg-purple-600 rounded-full peer-focus:ring-2 peer-focus:ring-purple-600 transition-all duration-300">
                <div
                    className={`absolute top-0.5 left-1 w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${checked ? 'translate-x-full' : ''
                        }`}
                ></div>
            </div>
        </label>
    );
};

export default Switch;
