import { Autocomplete, TextField, Box } from '@mui/material';
import type { SyntheticEvent } from 'react';
type OptionType = {
    id: string;
    name: string;
};

/**
 * Value shape for `value`/`onChange`: with `freeSolo` on, a committed value may be a
 * plain typed string (no matching option) instead of an `{id, name}` option; with
 * `freeSolo` off (default), it's always `OptionType | null`, unchanged from before.
 */
export type SearchableDropdownValue<FreeSolo extends boolean | undefined> =
    FreeSolo extends true ? OptionType | string | null : OptionType | null;

interface SearchableDropdownProps<FreeSolo extends boolean | undefined = false> {
    label?: string | null;
    value: SearchableDropdownValue<FreeSolo>;
    options: OptionType[];
    inputValue?: string;
    onInputChange?: (event: SyntheticEvent, value: string) => void;
    onChange?: (event: SyntheticEvent, value: SearchableDropdownValue<FreeSolo>) => void;
    disabled?: boolean;
    required?: boolean;
    placeholder?: string;
    loading?: boolean;
    noAsterisk?: boolean;
    /** id applied to the underlying text input, so an external <label htmlFor> can associate. */
    id?: string;
    /** Marks the input invalid for assistive tech (e.g. when wrapped by FormField). */
    "aria-invalid"?: boolean;
    /** id(s) of describing element(s), e.g. an external error message. */
    "aria-describedby"?: string;
    /**
     * When true, lets the user type & commit (Enter key / blur) a value that isn't in
     * `options` — mirrors MUI Autocomplete's own `freeSolo` prop. On commit, `onChange`
     * fires with a plain string (the typed text) instead of an `{id, name}` option, so
     * callers can branch on `typeof value === 'string'` to tell "picked" from "typed".
     * Default false — byte-identical to today for every existing call site.
     */
    freeSolo?: FreeSolo;
}

function SearchableDropdownImpl<FreeSolo extends boolean | undefined = false>({
    label,
    value,
    options,
    inputValue,
    onInputChange,
    onChange,
    disabled = false,
    required = false,
    placeholder = `Select ${label}`,
    loading = false,
    noAsterisk = false,
    id,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedby,
    freeSolo,
}: SearchableDropdownProps<FreeSolo>) {
    return (
        <Box>
            <label className="block text-sm font-medium text-gray-700 mb-1">
                {label} {required && !noAsterisk && <span className="text-destructive">*</span>}
            </label>
            <Autocomplete
                disablePortal
                freeSolo={freeSolo}
                options={options}
                value={value as never}
                inputValue={inputValue}
                onInputChange={onInputChange}
                onChange={(event, newValue) => {
                    onChange?.(event, newValue as SearchableDropdownValue<FreeSolo>);
                }}
                getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
                isOptionEqualToValue={(option, val) =>
                    typeof option === 'string' || typeof val === 'string' ? option === val : option.id === val.id
                }
                disabled={disabled}
                loading={loading}
                renderOption={(props, option) => (
                    <li {...props} key={typeof option === 'string' ? option : option.id}>
                        {typeof option === 'string' ? option : option.name}
                    </li>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        id={id}
                        placeholder={placeholder}
                        size="small"
                        variant="outlined"
                        InputLabelProps={{ shrink: false }}
                        slotProps={{
                            htmlInput: {
                                ...params.inputProps,
                                'aria-invalid': ariaInvalid,
                                'aria-describedby': ariaDescribedby,
                            },
                        }}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                borderRadius: '8px',
                                backgroundColor: '#fff',
                                color: '#374151', // gray-700
                                fontSize: '14px',
                                height: '42px',
                                '&.Mui-disabled': {
                                    backgroundColor: '#f3f4f6', // gray-100
                                },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                    borderColor: '#7539FF', // purple-600
                                    borderWidth: '1px',
                                },
                            },
                            '& .MuiOutlinedInput-notchedOutline': {
                                borderColor: '#d1d5db', // gray-300
                            },
                            '&:hover .MuiOutlinedInput-notchedOutline': {
                                borderColor: '#7539FF', // purple-600
                            },
                        }}
                    />
                )}
            />
        </Box>
    );
}

// Cast preserves the generic signature across the default export — callers that don't pass
// `freeSolo` keep the exact `OptionType | null` value/onChange typing they had before.
const SearchableDropdown = SearchableDropdownImpl as <FreeSolo extends boolean | undefined = false>(
    props: SearchableDropdownProps<FreeSolo>
) => ReturnType<typeof SearchableDropdownImpl>;

export default SearchableDropdown;
