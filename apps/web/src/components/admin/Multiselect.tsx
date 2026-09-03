import type { FC } from 'react';
import Select from 'react-select';
import type { OnChangeValue } from 'react-select';
import { themeColor } from "@lib/designTokens";

// Define the shape for a single option
interface ISelectOption {
  value: string;
  label: string;
}

// Define the props for the MultiSelect component
interface MultiSelectProps {
  options?: ISelectOption[];
  selectedOptions?: ISelectOption[];
  onChange: (value: OnChangeValue<ISelectOption, true>) => void;
  placeholder?: string;
  isDisabled?: boolean;
}

const MultiSelect: FC<MultiSelectProps> = ({
  options = [],
  selectedOptions = [],
  onChange,
  placeholder = 'Select options...',
  isDisabled = false,
}) => {
  return (
    <Select
      isMulti
      options={options}
      value={selectedOptions}
      onChange={onChange}
      placeholder={placeholder}
      isDisabled={isDisabled}
      className="react-select-container"
      classNamePrefix="react-select"
      // react-select takes style objects, not class names, so nothing about a
      // Tailwind token change reaches it. These previously hardcoded stock
      // Tailwind v3 violets (#a78bfa, #ede9fe, #5b21b6, #c084fc) which were
      // never the brand color even before the migration.
      styles={{
        // Filled, borderless, 28px — the same control as fieldControlClasses().
        control: (base, state) => ({
          ...base,
          border: 'none',
          borderRadius: '0.5rem',
          backgroundColor: themeColor('control-bg'),
          minHeight: '1.75rem',
          boxShadow: state.isFocused
            ? `0 0 0 2px ${themeColor('focus-neutral')}`
            : 'none',
          '&:hover': {
            backgroundColor: themeColor('control-bg-on-gray'),
          },
        }),
        option: (base, state) => ({
          ...base,
          padding: '8px 12px',
          color: state.isSelected ? themeColor('accent-foreground') : themeColor('foreground'),
          backgroundColor: state.isSelected
            ? themeColor('accent')
            : state.isFocused
              ? themeColor('muted')
              : themeColor('card'),
          '&:hover': {
            backgroundColor: themeColor('muted'),
          },
        }),
        multiValue: (base) => ({
          ...base,
          backgroundColor: themeColor('accent'),
        }),
        multiValueLabel: (base) => ({
          ...base,
          color: themeColor('accent-foreground'),
        }),
        multiValueRemove: (base) => ({
          ...base,
          color: themeColor('accent-foreground'),
          '&:hover': {
            backgroundColor: themeColor('primary'),
            color: themeColor('primary-foreground'),
          },
        }),
      }}
    />
  );
};

export default MultiSelect;