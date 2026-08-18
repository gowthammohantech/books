import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Calendar } from 'lucide-react';
import useDateFormatter from '@hooks/useDateFormatter';

type Props = {
  label?: string;
  selected?: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  required?: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
};

const ReactDateInput: React.FC<Props> = ({
  label = 'Select Date',
  selected,
  onChange,
  placeholder = 'Select date',
  minDate,
  maxDate,
  required = false,
  id = 'date',
  name = 'date',
  disabled = false,
}) => {
  // Render the date in the user-configured format (display-only; onChange still
  // emits a Date so submitted values are unaffected).
  const { dateFnsFormat } = useDateFormatter();
  return (
    <div className="mb-4">
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
        </label>
      )}

      <div className="relative">
        <DatePicker
          id={id}
          name={name}
          selected={selected}
          onChange={onChange}
          placeholderText={placeholder}
          minDate={minDate}
          maxDate={maxDate}
          required={required}
          disabled={disabled}
          dateFormat={dateFnsFormat}
          className="w-full rounded-lg border border-gray-300 bg-white text-sm text-gray-950 py-2 pl-3 pr-10 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          calendarClassName=""
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <Calendar className="w-4 h-4 text-gray-500" />
        </div>
      </div>
    </div>
  );
};

export default ReactDateInput;