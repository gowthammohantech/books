import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { FC } from 'react';
import useDateFormatter from '@hooks/useDateFormatter';

interface DateInputProps {
    label: string;
    value: Date | null;
    onChange: (date: Date | null) => void;
    minDate?: Date;
    maxDate?: Date;
    isRequired?: boolean;
}

const DateInput: FC<DateInputProps> = ({ label, value, onChange, minDate, maxDate, isRequired }) => {
    // Render the date in the user-configured format (display-only; onChange still
    // emits a Date so submitted values are unaffected).
    const { dateFnsFormat } = useDateFormatter();
    return (
        <div>
            <label className="block text-sm font-medium text-foreground pb-1">
                {label} {isRequired && <span className="text-destructive">*</span>}
            </label>
            <DatePicker
                value={value}
                onChange={onChange}
                minDate={minDate}
                maxDate={maxDate}
                format={dateFnsFormat}
                slotProps={{
                    textField: {
                        size: 'small',
                        fullWidth: true,
                        // Surface + border colors come from the MUI theme's
                        // MuiOutlinedInput override; only the padding is local.
                        sx: {
                            '& .MuiOutlinedInput-root': {
                                paddingRight: '8px',
                            },
                        },
                    },
                }}
            />
        </div>
    );
};

export default DateInput;