import type { FC } from 'react';
import Select from 'react-select';
import type { OnChangeValue } from 'react-select';

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
      styles={{
        control: (base) => ({
          ...base,
          border: '1px solid #d1d5db',
          borderRadius: '0.375rem',
          backgroundColor: '#fff',
          boxShadow: 'none',
          '&:hover': {
            borderColor: '#a78bfa',
          },
        }),
        option: (base, state) => ({
          ...base,
          padding: '8px 12px',
          color: '#374151',
          backgroundColor: state.isSelected ? '#ede9fe' : state.isFocused ? '#f5f3ff' : '#fff',
          '&:hover': {
            backgroundColor: '#f5f3ff',
          },
        }),
        multiValue: (base) => ({
          ...base,
          backgroundColor: '#e9d5ff',
        }),
        multiValueLabel: (base) => ({
          ...base,
          color: '#5b21b6',
        }),
        multiValueRemove: (base) => ({
          ...base,
          color: '#5b21b6',
          '&:hover': {
            backgroundColor: '#c084fc',
            color: 'white',
          },
        }),
      }}
    />
  );
};

export default MultiSelect;