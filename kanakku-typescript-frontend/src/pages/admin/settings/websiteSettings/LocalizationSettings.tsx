import SearchableDropdown from '@components/admin/SearchableDropdown';
import SubmitButton from '@components/admin/SubmitButton';
import Constants from '@constants/api';
import type { AppDispatch, RootState } from '@store/index';
import { fetchSystemSettings } from '@store/systemSettingsSlice';
import { hasPermission } from '@utils/hasPermission';
import { Button, Card, FormField } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';
import axios from 'axios';
import { Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from "sonner";

type OptionType = {
    id: string;
    name: string;
};

interface DateFormat extends OptionType {
    format: string;
    title: string;
}

interface TimeFormat extends OptionType {
    format: string;
}

interface TimeZone extends OptionType {
    offset: string;
}

interface WeekDay extends OptionType {
    value: string;
}

// Static weekdays array
const WEEKDAYS: WeekDay[] = [
    { id: 'Sunday', name: 'Sunday', value: 'Sunday' },
    { id: 'Monday', name: 'Monday', value: 'Monday' },
    { id: 'Tuesday', name: 'Tuesday', value: 'Tuesday' },
    { id: 'Wednesday', name: 'Wednesday', value: 'Wednesday' },
    { id: 'Thursday', name: 'Thursday', value: 'Thursday' },
    { id: 'Friday', name: 'Friday', value: 'Friday' },
    { id: 'Saturday', name: 'Saturday', value: 'Saturday' },
];
const LocalizationSettings: React.FC = () => {
    const [dateFormats, setDateFormats] = useState<DateFormat[]>([]);
    const [timeFormats, setTimeFormats] = useState<TimeFormat[]>([]);
    const [timeZones, setTimeZones] = useState<TimeZone[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);

    // Selected values
    const [selectedTimeZone, setSelectedTimeZone] = useState<OptionType | null>(null);
    const [selectedWeekDay, setSelectedWeekDay] = useState<OptionType | null>(null);
    const [selectedDateFormat, setSelectedDateFormat] = useState<OptionType | null>(null);
    const [selectedTimeFormat, setSelectedTimeFormat] = useState<OptionType | null>(null);

    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const dispatch: AppDispatch = useDispatch();
    const navigate = useNavigate();
    useEffect(() => {
        fetchLocalizations();
    }, []);

    const fetchLocalizations = async () => {
        setIsLoading(true);
        try {
            const response = await axios.get(Constants.FETCH_LOCALIZATION_DROPDOWNS_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const { dateFormats, timeFormats, timezones, settings } = response.data.data;

            if (dateFormats) {
                setDateFormats(dateFormats.map((df: DateFormat) => ({
                    ...df,
                    name: df.title || df.format
                })));
            }
            setTimeFormats(timeFormats);
            setTimeZones(timezones);

            // Set current settings if available
            if (settings) {
                const { timezone, startWeek, dateFormat, timeFormat } = settings;
                // Find and format the selected date format
                const formattedDateFormat = dateFormats.find((df: DateFormat) => df.id === dateFormat.id);
                const dateFormatWithName = formattedDateFormat ? {
                    ...formattedDateFormat,
                    name: formattedDateFormat.title || formattedDateFormat.format
                } : null;

                setSelectedTimeZone(timezones.find((tz: TimeZone) => tz.id === timezone.id) || null);
                setSelectedWeekDay(WEEKDAYS.find(day => day.id === startWeek) || null);
                setSelectedDateFormat(dateFormatWithName);
                setSelectedTimeFormat(timeFormats.find((tf: TimeFormat) => tf.id === timeFormat.id) || null);
            }
        } catch (error) {
            console.error('Error fetching localizations:', error);
            toast.error('Failed to load localization settings');
        } finally {
            setIsLoading(false);
        }
    }

    const handleSaveSettings = async () => {
        if (!selectedTimeZone || !selectedWeekDay || !selectedDateFormat || !selectedTimeFormat) {
            toast.error('Please fill all required fields');
            return;
        }

        setIsSaving(true);
        try {
            await axios.post(Constants.UPDATE_LOCALIZATION_URL, {
                timezoneId: selectedTimeZone.id,
                startWeek: selectedWeekDay.id,
                dateFormatId: selectedDateFormat.id,
                timeFormatId: selectedTimeFormat.id
            }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (token) dispatch(fetchSystemSettings(token));
            toast.success('Localization settings updated successfully');
        } catch (error) {
            console.error('Error updating localization settings:', error);
            toast.error('Failed to update localization settings');
        } finally {
            setIsSaving(false);
        }
    }
    const sectionHeaderClass = "flex items-center gap-2 px-5 py-4 border-b border-border text-lg font-semibold text-heading";

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <PageHeader title="Localization">
                <Button
                    type="button"
                    variant="white"
                    leftIcon={<X size={16} />}
                    disabled={isLoading || isSaving}
                    onClick={() => navigate('/admin/dashboard')}
                >
                    Cancel
                </Button>
                {hasPermission(permissions, 'website-settings', 'edit') &&
                    <SubmitButton
                        isDisabled={isSaving}
                        mode='edit'
                        isLoading={isSaving}
                        onClick={handleSaveSettings}
                    />
                }
            </PageHeader>

            <Card
                padded={false}
                header={
                    <div className={sectionHeaderClass}>
                        <Settings2 className="w-5 h-5 text-purple-600" />
                        Basic Information
                    </div>
                }
            >
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
                    <FormField label="Time Zone" required>
                        {(field) => (
                            <>
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={timeZones}
                                    value={selectedTimeZone}
                                    placeholder="Select Time Zone"
                                    onChange={(_, value) => setSelectedTimeZone(value)}
                                    disabled={isLoading}
                                    required
                                    noAsterisk
                                />
                                {selectedTimeZone && (
                                    <p className="mt-1 text-xs text-body">
                                        Offset: {(timeZones.find(tz => tz.id === selectedTimeZone.id) as TimeZone)?.offset}
                                    </p>
                                )}
                            </>
                        )}
                    </FormField>

                    <FormField label="Start Week On" required>
                        {(field) => (
                            <SearchableDropdown
                                id={field.id}
                                aria-invalid={field['aria-invalid']}
                                aria-describedby={field['aria-describedby']}
                                options={WEEKDAYS}
                                value={selectedWeekDay}
                                placeholder="Select Start Day of Week"
                                onChange={(_, value) => setSelectedWeekDay(value)}
                                disabled={isLoading}
                                required
                                noAsterisk
                            />
                        )}
                    </FormField>

                    <FormField label="Date Format" required>
                        {(field) => (
                            <>
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={dateFormats}
                                    value={selectedDateFormat}
                                    placeholder="Select Date Format"
                                    onChange={(_, value) => setSelectedDateFormat(value)}
                                    disabled={isLoading}
                                    required
                                    noAsterisk
                                />
                                {selectedDateFormat && (
                                    <p className="mt-1 text-xs text-body">
                                        Format: {(selectedDateFormat as DateFormat).format} ({(selectedDateFormat as DateFormat).title})
                                    </p>
                                )}
                            </>
                        )}
                    </FormField>

                    <FormField label="Time Format" required>
                        {(field) => (
                            <>
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={timeFormats}
                                    value={selectedTimeFormat}
                                    placeholder="Select Time Format"
                                    onChange={(_, value) => setSelectedTimeFormat(value)}
                                    disabled={isLoading}
                                    required
                                    noAsterisk
                                />
                                {selectedTimeFormat && (
                                    <p className="mt-1 text-xs text-body">
                                        Format: {(timeFormats.find(tf => tf.id === selectedTimeFormat.id) as TimeFormat)?.format}
                                    </p>
                                )}
                            </>
                        )}
                    </FormField>
                </div>
            </Card>
        </div>
    );
}

export default LocalizationSettings;