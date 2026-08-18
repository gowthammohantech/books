import * as React from 'react';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';

type Option = {
    label: string;
    value: string;
}

type Props = {
    value: string | null;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    options: Option[],
    name: string
}
export default function RowRadioButtonsGroup({ value, onChange, options, name }: Props) {
    return (
        <FormControl>
            <RadioGroup
                row
                name={name}
                value={value}
                onChange={onChange}
            >
                {options.map((option) => (
                    <FormControlLabel
                        key={option.value}
                        value={option.value}
                        control={<Radio />}
                        label={option.label}
                        className="text-gray-600"
                    />
                ))}
            </RadioGroup>
        </FormControl>
    );
}
