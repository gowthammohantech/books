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
        control: (base) => ({
          ...base,
          border: `1px solid ${themeColor('border')}`,
          borderRadius: '0.375rem',
          backgroundColor: themeColor('card'),
          boxShadow: 'none',
          '&:hover': {
            borderColor: themeColor('primary'),
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