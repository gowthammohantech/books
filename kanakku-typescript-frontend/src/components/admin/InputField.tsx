import React from 'react';
interface InputFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value?: string | number;
  type?: string; // Optional: defaults to 'text'
  required?: boolean; // Optional: for the red asterisk
  className?: string; // Optional: for custom container styling (like grid spans)
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  maxLength?: number;
}

const InputField: React.FC<InputFieldProps> = ({
  id,
  label,
  placeholder,
  type = 'text',
  value,
  required = false,
  className = '',
  onChange,
  error,
  maxLength,
}) => {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-heading">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <input
        type={type}
        id={id}
        name={id}
        value={value}
        placeholder={placeholder}
        className="mt-1 block w-full px-3 py-2 bg-surface border border-border rounded-control text-heading placeholder:text-body focus:outline-none focus:border-purple-600 sm:text-sm"
        onChange={onChange}
        maxLength={maxLength}
      />
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
};

export default InputField;