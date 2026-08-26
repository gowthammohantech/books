import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek,
  addDays, isSameMonth, isSameDay, isBefore, isAfter, setYear, setMonth,
  getMonth, getYear, subYears, addYears, subDays, startOfDay,
} from 'date-fns';
import { FiCalendar, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import './DateRangePicker.css';

// Types
type DateRange = { startDate: Date | null; endDate: Date | null };
type CalendarView = 'days' | 'months' | 'years';
type DateRangePickerProps = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  disabledDate?: (date: Date) => boolean;
};

const presets = [
  { label: 'Today', range: () => ({ startDate: startOfDay(new Date()), endDate: startOfDay(new Date()) }) },
  { label: 'Yesterday', range: () => ({ startDate: subDays(startOfDay(new Date()), 1), endDate: subDays(startOfDay(new Date()), 1) }) },
  { label: 'Last 7 Days', range: () => ({ startDate: subDays(startOfDay(new Date()), 6), endDate: startOfDay(new Date()) }) },
  { label: 'This Month', range: () => ({ startDate: startOfMonth(new Date()), endDate: endOfMonth(new Date()) }) },
  { label: 'Last Month', range: () => ({ startDate: startOfMonth(subMonths(new Date(), 1)), endDate: endOfMonth(subMonths(new Date(), 1)) }) },
];

// Helper to get years for the year grid
const getYearGrid = (date: Date) => {
  const year = getYear(date);
  const startYear = Math.floor(year / 12) * 12;
  return Array.from({ length: 12 }, (_, i) => startYear + i);
};

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ value, onChange, disabledDate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(value);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(value.startDate || new Date()));
  const [calendarView, setCalendarView] = useState<CalendarView>('days');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Sync tempRange with value prop when opening
  useEffect(() => {
    if (isOpen) {
      setTempRange(value);
      setCurrentMonth(startOfMonth(value.startDate || new Date()));
    }
  }, [isOpen, value]);

  // Hook to handle clicks outside the picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleApply = () => {
    onChange(tempRange);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setIsOpen(false);
    setTempRange(value);
  };

  const handleDateClick = (day: Date) => {
    if (disabledDate && disabledDate(day)) return;

    if (!tempRange.startDate || (tempRange.startDate && tempRange.endDate)) {
      setTempRange({ startDate: day, endDate: null });
    } else if (isBefore(day, tempRange.startDate)) {
      setTempRange({ startDate: day, endDate: null });
    } else {
      setTempRange({ ...tempRange, endDate: day });
    }
  };

  const handlePresetClick = (preset: typeof presets[0]) => {
    const newRange = preset.range();
    setTempRange(newRange);
    setCurrentMonth(startOfMonth(newRange.startDate));
  };

  const handleMonthSelect = (monthIndex: number) => {
    setCurrentMonth(setMonth(currentMonth, monthIndex));
    setCalendarView('days');
  };

  const handleYearSelect = (year: number) => {
    setCurrentMonth(setYear(currentMonth, year));
    setCalendarView('months');
  };

  const handlePrev = () => {
    switch (calendarView) {
      case 'days': setCurrentMonth(subMonths(currentMonth, 1)); break;
      case 'months': setCurrentMonth(subYears(currentMonth, 1)); break;
      case 'years': setCurrentMonth(subYears(currentMonth, 12)); break;
    }
  };

  const handleNext = () => {
    switch (calendarView) {
      case 'days': setCurrentMonth(addMonths(currentMonth, 1)); break;
      case 'months': setCurrentMonth(addYears(currentMonth, 1)); break;
      case 'years': setCurrentMonth(addYears(currentMonth, 12)); break;
    }
  };

  // Rendering logic
  const renderDaysGrid = (month: Date) => {
    const monthStart = startOfMonth(month);
    const grid = [];
    let day = startOfWeek(monthStart);

    while (grid.length < 42) {
      const cloneDay = day;
      const isSelectedStart = tempRange.startDate && isSameDay(cloneDay, tempRange.startDate);
      const isSelectedEnd = tempRange.endDate && isSameDay(cloneDay, tempRange.endDate);
      const isInRange = tempRange.startDate && tempRange.endDate && isAfter(cloneDay, tempRange.startDate) && isBefore(cloneDay, tempRange.endDate);
      const isDisabled = (disabledDate && disabledDate(cloneDay)) || !isSameMonth(cloneDay, monthStart);

      const cellClasses = `calendar-day
        ${isDisabled ? 'disabled' : ''}
        ${!isSameMonth(cloneDay, monthStart) ? 'outside-month' : ''}
        ${isSelectedStart ? 'selected-start' : ''}
        ${isSelectedEnd ? 'selected-end' : ''}
        ${isInRange ? 'in-range' : ''}
        ${isSameDay(cloneDay, new Date()) ? 'today' : ''}`;

      grid.push(<div key={cloneDay.toString()} className={cellClasses} onClick={() => handleDateClick(cloneDay)}>
        <span>{format(cloneDay, 'd')}</span>
      </div>);
      day = addDays(day, 1);
    }
    return <div className='calendar-grid'>{grid}</div>
  };

  const renderMonthYearGrid = (type: 'months' | 'years') => {
    const items = type === 'months'
      ? Array.from({ length: 12 }, (_, i) => i)
      : getYearGrid(currentMonth);

    const isSelected = (item: number) => type === 'months'
      ? getMonth(currentMonth) === item
      : getYear(currentMonth) === item;

    const handleClick = (item: number) => type === 'months'
      ? handleMonthSelect(item)
      : handleYearSelect(item);

    return (
      <div className='month-year-grid'>
        {items.map(item => (
          <div key={item} className={`grid-cell ${isSelected(item) ? 'selected' : ''}`} onClick={() => handleClick(item)}>
            {type === 'months' ? format(setMonth(new Date(), item), 'MMM') : item}
          </div>
        ))}
      </div>
    );
  };

  const formattedInputDate = useMemo(() => {
    if (!value.startDate) return 'Select a date range';
    const start = format(value.startDate, 'MMM d, yyyy');
    const end = value.endDate ? ` - ${format(value.endDate, 'MMM d, yyyy')}` : '';
    return `${start}${end}`;
  }, [value]);

  return (
    <div className="date-range-picker" ref={pickerRef}>
      <div className="picker-input" data-state={isOpen ? 'open' : 'closed'} onClick={() => setIsOpen(!isOpen)}>
        <FiCalendar className="picker-icon" />
        <span>{formattedInputDate}</span>
      </div>
      {isOpen && (
        <div className="picker-popup">
          <div className="presets-column">
            {presets.map(p => (
              <button key={p.label} onClick={() => handlePresetClick(p)}>{p.label}</button>
            ))}
          </div>
          <div className="calendar-column">
            <div className="calendar-navigation">
              <button onClick={handlePrev}><FiChevronLeft /></button>
              <div className="months-display">
                {calendarView === 'days' && <button onClick={() => setCalendarView('months')}>{format(currentMonth, 'MMMM')}</button>}
                <button onClick={() => setCalendarView('years')}>{format(currentMonth, 'yyyy')}</button>
              </div>
              <button onClick={handleNext}><FiChevronRight /></button>
            </div>
            <div className="calendar-content">
              {calendarView === 'days' && <div className='days-of-week'>{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}</div>}
              {calendarView === 'days' && renderDaysGrid(currentMonth)}
              {calendarView === 'months' && renderMonthYearGrid('months')}
              {calendarView === 'years' && renderMonthYearGrid('years')}
            </div>
            <div className="action-footer">
              <div className='footer-preview'>
                {tempRange.startDate ? format(tempRange.startDate, 'MMM d, yyyy') : 'Start Date'}
                {' - '}
                {tempRange.endDate ? format(tempRange.endDate, 'MMM d, yyyy') : 'End Date'}
              </div>
              <div className='footer-buttons'>
                <button className='cancel-btn' onClick={handleCancel}>Cancel</button>
                <button className='apply-btn' onClick={handleApply}>Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};