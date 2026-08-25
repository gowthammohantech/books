import LoaderSpinner from "@components/admin/LoaderSpinner";
import SmartDropdown from "@components/admin/SmartDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, Card, FormField } from "@components/ui";
import Constants from "@constants/api";
import { useDebounce } from "@hooks/useDebounce";
import type { OptionType } from "@models/common";
import type { RootState } from "@store/index";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface FormData {
    quoteSalesPersonRole: string;
}
const Preferences: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const navigate = useNavigate();
    const [formData, setFormData] = useState<FormData>({
        quoteSalesPersonRole: ''
    });
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [roleSearchKeyword, setRoleSearchKeyword] = useState('');
    const debouncedRoleSearch = useDebounce(roleSearchKeyword, 700);
    const [roles, setRoles] = useState<OptionType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const fetchComponentData = async () => {
            try {
                setIsLoading(true);
                await fetchRoles();
                await fetchGeneralSettings();
            } catch (error) {
                console.error('Error fetching component data:', error);
            } finally {
                setIsLoading(false);
            }
        }
        fetchComponentData();
    }, []);

    const fetchGeneralSettings = async () => {
        try {
            const response = await axios.get(Constants.GET_GENERAL_SETTINGS_URL, {
                params: { groupSlug: 'quotation' },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            let settings: { [key: string]: string } = {};
            if (data) {
                data.forEach((setting: any) => {
                    settings[setting.key] = setting.value;
                });
                setFormData({
                    quoteSalesPersonRole: settings.quoteSalesPersonRole || ''
                });
            }
        } catch (error) {
            console.error('Error fetching general settings:', error);
        }
    }
    const fetchRoles = async () => {
        try {
            const response = await axios.get(Constants.FETCH_ALL_ROLES_URL, {
                params: { search: debouncedRoleSearch },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            if (data) {
                const options = data.map((role: any) => ({
                    id: role.id,
                    name: role.roleName
                }));
                setRoles(options);
            } else {
                setRoles([]);
            }
        } catch (error) {
            console.error('Error fetching roles:', error);
        }
    }

    const handleRoleSelect = (role: OptionType) => {
        if (role) {
            setFormData(prevState => ({
                ...prevState,
                quoteSalesPersonRole: role.id
            }));
        } else {
            setFormData(prevState => ({
                ...prevState,
                quoteSalesPersonRole: ''
            }));
        }
    }

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.quoteSalesPersonRole) newErrors.quoteSalesPersonRole = 'Role is required.';
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;
        const payload = {
            settings: [
                {
                    key: 'quoteSalesPersonRole',
                    value: formData.quoteSalesPersonRole,
                    groupSlug: 'quotation'
                }
            ]
        }
        try {
            setIsSubmitting(true);
            await axios.post(Constants.UPDATE_GENERAL_SETTINGS_URL, payload, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Settings updated successfully.');
        } catch (error) {
            toast.error('Failed to update settings.');
        } finally {
            setIsSubmitting(false);
        }

    }
    if (isLoading) {
        return (
            <div className="p-4 md:p-6 bg-gray-50 min-h-full font-sans flex items-center justify-center">
                <LoaderSpinner />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader title="Quotation Preferences">
                <Button type="button" variant="white" onClick={(_) => navigate('/admin')}>Cancel</Button>
                <SubmitButton form="quotation-preferences-form" isDisabled={isSubmitting} isLoading={isSubmitting} mode="edit" />
            </PageHeader>
            <form id="quotation-preferences-form" onSubmit={handleSubmit}>
                <Card>
                    {/* Sales Person Preferences */}
                    <div className="mb-4">
                        <p className="text-base font-semibold text-heading">Sales Person Preferences</p>
                        <small className="text-body text-xs">Choose roles that can be assigned to staff members. These roles will appear as "Sales Person" in the quotation module.</small>
                    </div>
                    <FormField label="" containerClassName="md:w-1/4 lg:w-1/4" error={formErrors.quoteSalesPersonRole}>
                        <SmartDropdown
                            items={roles}
                            value={roleSearchKeyword}
                            onChange={(keyword) => setRoleSearchKeyword(keyword)}
                            onSelect={(role) => handleRoleSelect(role as OptionType)}
                            placeholder="Search and select role"
                            selectedItem={roles.find(role => role.id === formData.quoteSalesPersonRole) || null}
                        />
                    </FormField>
                    <hr className="border-border my-4" />
                    {/* Default Terms & Notes moved to Settings → Document Defaults (single
                        source of truth shared by invoices and quotations). */}
                    <div className="rounded-control border border-border bg-surface px-4 py-3">
                        <p className="text-sm text-body">
                            Default <span className="font-semibold">Terms &amp; Conditions</span> and{" "}
                            <span className="font-semibold">Customer Notes</span> are now managed under{" "}
                            <button
                                type="button"
                                onClick={() => navigate('/admin/settings/document-defaults')}
                                className="font-semibold text-purple-600 underline cursor-pointer"
                            >
                                Settings → Document Defaults
                            </button>
                            , shared across invoices and quotations.
                        </p>
                    </div>
                </Card>
            </form>
        </div>
    );
}

export default Preferences;
