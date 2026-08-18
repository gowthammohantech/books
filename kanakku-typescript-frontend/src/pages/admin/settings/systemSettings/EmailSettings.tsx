import Switch from '@components/admin/Switch';
import { Settings, Send, Check } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import nodemail from '@assets/icons/nodeMailer.svg';
import smtpImage from '@assets/icons/smtp.svg';
import Modal from '@components/admin/Modal';
import type { EmailSettingsFormData } from '@models/email-settings';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import axios from 'axios';
import Constants from '@constants/api';
import { toast } from "sonner";
import { hasPermission } from '@utils/hasPermission';
import SubmitButton from '@components/admin/SubmitButton';
import { Button, Badge, Card, FormField } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';

const initialFormData: EmailSettingsFormData = {
    provider_type: '',
    userId: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    host: '',
    port: '',
    username: '',
    password: '',
    apiKey: '',
    smtp_status: false,
    node_status: false,
    resend_status: false
};

interface ProviderCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    configured: boolean;
    active: boolean;
    summary?: string;
    canEdit: boolean;
    switchName: string;
    onConfigure: () => void;
    onToggle: () => void;
}

/** One email-provider card: shows its configured/active state and a summary of
 *  the saved sender so the user can see what's set without opening the modal. */
const ProviderCard: React.FC<ProviderCardProps> = ({
    icon, title, description, configured, active, summary, canEdit, switchName, onConfigure, onToggle,
}) => (
    <Card
        padded={false}
        className={active ? 'border-purple-400 ring-1 ring-purple-200' : ''}
        header={
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                    <div className="bg-surface p-2 rounded-md flex items-center justify-center">{icon}</div>
                    <h2 className="font-semibold text-base text-heading">{title}</h2>
                </div>
                {active ? (
                    <Badge color="primary">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-600" /> Active
                    </Badge>
                ) : configured ? (
                    <Badge color="success">
                        <Check size={12} /> Configured
                    </Badge>
                ) : (
                    <Badge color="gray">Not configured</Badge>
                )}
            </div>
        }
        footer={canEdit ? (
            <div className="flex justify-between items-center">
                <Button
                    variant="secondary"
                    onClick={onConfigure}
                    leftIcon={<Settings size={18} />}
                    aria-label={`${title} Settings`}
                >
                    {configured ? 'Edit' : 'Configure'}
                </Button>
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${active ? 'text-purple-700' : 'text-body'}`}>
                        {active ? 'Active' : 'Inactive'}
                    </span>
                    <Switch
                        name={switchName}
                        checked={active}
                        onChange={onToggle}
                        disabled={!configured || active}
                    />
                </div>
            </div>
        ) : undefined}
    >
        <div className="p-5">
            <p className="text-sm text-body">{description}</p>
            {configured && summary && (
                <p className="text-xs text-body mt-3 break-all" title={summary}>
                    <span className="font-semibold text-heading">Sender:</span> {summary}
                </p>
            )}
        </div>
    </Card>
);

const EmailSettings: React.FC = () => {
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [formData, setFormData] = useState<EmailSettingsFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [configurationType, setConfigurationType] = useState<string>('');
    const [isConfigurationModalOpen, setIsConfigurationModalOpen] = useState<boolean>(false);
    const [configurations, setConfigurations] = useState<any>(null);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [testEmail, setTestEmail] = useState<string>(user?.email || '');
    const [isTesting, setIsTesting] = useState<boolean>(false);
    useEffect(() => {
        fetchConfigurations();
    }, []);

    const handleSendTestEmail = async () => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!testEmail || !emailRegex.test(testEmail)) {
            toast.error('Enter a valid recipient email to test.');
            return;
        }
        try {
            setIsTesting(true);
            const res = await axios.post(
                Constants.SEND_TEST_EMAIL_URL,
                { to: testEmail },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success(res.data?.message || 'Test email sent.');
        } catch (error: any) {
            // Surface the real provider error (bad API key, unverified domain, etc.)
            const detail = error?.response?.data?.error || error?.response?.data?.message;
            toast.error(detail ? `Test failed: ${detail}` : 'Failed to send test email.');
        } finally {
            setIsTesting(false);
        }
    };

    const fetchConfigurations = async () => {
        const response = await axios.get(`${Constants.GET_EMAIL_SETTINGS_URL}`, {
            params: { userId: user?.id },
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = response.data.data;
        setConfigurations(data);
    }
    const openConfigurationModal = async (type: 'NodeMail' | 'SMTP' | 'Resend') => {
        setFormData(initialFormData);
        setFormErrors({});
        setConfigurationType(type);
        const data = configurations;
        if (data) {
            const providerType = type === 'NodeMail' ? 'NODE' : type === 'Resend' ? 'RESEND' : 'SMTP';
            setFormData({
                ...initialFormData,
                provider_type: providerType,
                userId: data.userId,
                fromName: type === 'NodeMail' ? data.nodeFromName : type === 'Resend' ? data.resendFromName : data.smtpFromName,
                fromEmail: type === 'NodeMail' ? data.nodeFromEmail : type === 'Resend' ? data.resendFromEmail : data.smtpFromEmail,
                replyTo: (type === 'NodeMail' ? data.nodeReplyTo : type === 'Resend' ? data.resendReplyTo : data.smtpReplyTo) || '',
                host: type === 'NodeMail' ? data.nodeHost : data.smtpHost,
                port: type === 'NodeMail' ? data.nodePort : data.smtpPort,
                username: type === 'NodeMail' ? data.nodeUsername : data.smtpUsername,
                password: type === 'NodeMail' ? data.nodePassword : data.smtpPassword,
                apiKey: type === 'Resend' ? (data.resendApiKey || '') : '',
                smtp_status: data.smtp_status,
                node_status: data.node_status,
                resend_status: data.resend_status
            })
        }
        setIsConfigurationModalOpen(true);
    };

    const handleNodeMailConfigClick = () => {
        openConfigurationModal('NodeMail');
    };
    const handleSmtpConfigClick = () => openConfigurationModal('SMTP');
    const handleResendConfigClick = () => openConfigurationModal('Resend');

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'number' ? (value === '' ? '' : Number(value)) : value
        }));
    };

    const validateField = (name: string, value: any): string => {
        switch (name) {
            case 'fromName':
                if (!value) return "From name is required.";
                if (value.length > 100) return "From name cannot exceed 100 characters.";
                break;
            case 'fromEmail':
                if (!value) return "From email is required.";
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value)) return "Invalid email address.";
                if (value.length > 150) return "Email cannot exceed 150 characters.";
                break;
            case 'host':
                if (!value) return "Host is required.";
                if (value.length > 200) return "Host cannot exceed 200 characters.";
                break;
            case 'port':
                if (value === '' || value === null) return "Port is required.";
                const port = Number(value);
                if (isNaN(port)) return "Port must be a number.";
                if (port < 1 || port > 65535) return "Port must be between 1 and 65535.";
                break;
            case 'username':
                if (!value) return "Username is required.";
                if (value.length > 100) return "Username cannot exceed 100 characters.";
                break;
            case 'password':
                if (!value) return "Password is required.";
                if (value.length < 6) return "Password must be at least 6 characters long.";
                if (value.length > 100) return "Password cannot exceed 100 characters.";
                break;
            case 'apiKey':
                if (!value) return "API key is required.";
                if (value.length > 200) return "API key cannot exceed 200 characters.";
                break;
            case 'replyTo':
                // Optional — only validate format when a value is provided.
                if (value) {
                    const replyRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!replyRegex.test(value)) return "Invalid reply-to email address.";
                    if (value.length > 150) return "Email cannot exceed 150 characters.";
                }
                break;
            default:
                break;
        }
        return '';
    };

    const validateForm = (): boolean => {
        const newErrors: { [key: string]: string } = {};
        let isValid = true;

        const hasStoredSecret =
            configurationType === 'Resend'
                ? !!configurations?.hasResendApiKey
                : configurationType === 'NodeMail'
                    ? !!configurations?.hasNodePassword
                    : !!configurations?.hasSmtpPassword;

        // Resend only needs From Name/Email + API key; SMTP/Node need host/port/credentials.
        let fieldsToValidate: (keyof EmailSettingsFormData)[] =
            configurationType === 'Resend'
                ? ['fromName', 'fromEmail', 'replyTo', 'apiKey']
                : ['fromName', 'fromEmail', 'replyTo', 'host', 'port', 'username', 'password'];

        // When a secret is already stored, the password/API-key field may be left
        // blank to keep the current one (it is never sent back to the client).
        if (hasStoredSecret && !formData.password && !formData.apiKey) {
            fieldsToValidate = fieldsToValidate.filter(f => f !== 'password' && f !== 'apiKey');
        }

        fieldsToValidate.forEach(fieldName => {
            const error = validateField(fieldName, formData[fieldName]);
            if (error) {
                newErrors[fieldName] = error;
                isValid = false;
            }
        });

        setFormErrors(newErrors);
        return isValid;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) {
            return;
        }
        let payload;
        if (configurationType === 'NodeMail') {
            payload = {
                userId: user?.id,
                smtp_status: false,
                node_status: true,
                resend_status: false,
                provider_type: 'NODE',
                nodeFromName: formData.fromName,
                nodeFromEmail: formData.fromEmail,
                nodeReplyTo: formData.replyTo,
                nodeHost: formData.host,
                nodePort: formData.port,
                nodeUsername: formData.username,
                nodePassword: formData.password
            }
        } else if (configurationType === 'Resend') {
            payload = {
                userId: user?.id,
                smtp_status: false,
                node_status: false,
                resend_status: true,
                provider_type: 'RESEND',
                resendFromName: formData.fromName,
                resendFromEmail: formData.fromEmail,
                resendReplyTo: formData.replyTo,
                resendApiKey: formData.apiKey
            }
        } else {
            payload = {
                userId: user?.id,
                smtp_status: true,
                node_status: false,
                resend_status: false,
                provider_type: 'SMTP',
                smtpFromName: formData.fromName,
                smtpFromEmail: formData.fromEmail,
                smtpReplyTo: formData.replyTo,
                smtpHost: formData.host,
                smtpPort: formData.port,
                smtpUsername: formData.username,
                smtpPassword: formData.password
            }
        }

        try {
            setIsSaving(true);
            await axios.post(Constants.UPDATE_EMAIL_SETTINGS_URL, payload, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Email settings updated successfully');
            fetchConfigurations();
            setIsConfigurationModalOpen(false);
        } catch (error) {
            toast.error('Failed to update email settings');
        } finally {
            setIsSaving(false);
        }
    };

    const handleStatusChange = async (type: string) => {
        const payload = {
            userId: user?.id,
            smtp_status: type === 'SMTP',
            node_status: type === 'NodeMail',
            resend_status: type === 'Resend',
            provider_type: type === 'NodeMail' ? 'NODE' : type === 'Resend' ? 'RESEND' : 'SMTP'
        };

        try {
            await axios.post(Constants.UPDATE_EMAIL_SETTINGS_URL, payload, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Email settings updated successfully');
            fetchConfigurations();
        } catch (error) {
            toast.error('Failed to update email settings');
        }
    }
    // Derive each provider's configured/active state + a sender summary from the
    // saved settings row, so the cards reflect what's stored.
    const c = configurations || {};
    const canEdit = hasPermission(permissions, 'system-settings', 'edit');
    const providerState = (type: 'NodeMail' | 'SMTP' | 'Resend') => {
        if (type === 'NodeMail') {
            return {
                configured: !!(c.nodeHost && c.nodeFromEmail),
                active: !!c.node_status,
                summary: c.nodeFromEmail ? `${c.nodeFromEmail} · ${c.nodeHost || ''}${c.nodePort ? ':' + c.nodePort : ''}` : '',
            };
        }
        if (type === 'Resend') {
            return {
                configured: !!(c.resendApiKey && c.resendFromEmail),
                active: !!c.resend_status,
                summary: c.resendFromEmail ? `${c.resendFromEmail} · API key ••••` : '',
            };
        }
        return {
            configured: !!(c.smtpHost && c.smtpFromEmail),
            active: !!c.smtp_status,
            summary: c.smtpFromEmail ? `${c.smtpFromEmail} · ${c.smtpHost || ''}${c.smtpPort ? ':' + c.smtpPort : ''}` : '',
        };
    };
    const nodeState = providerState('NodeMail');
    const smtpState = providerState('SMTP');
    const resendState = providerState('Resend');
    // Whether the provider being edited already has a stored secret (so the
    // password / API-key field can be left blank to keep it).
    const modalHasSecret =
        configurationType === 'Resend'
            ? !!c.hasResendApiKey
            : configurationType === 'NodeMail'
                ? !!c.hasNodePassword
                : !!c.hasSmtpPassword;

    return (
        <div className="p-6">
            <PageHeader title="Email Settings" />

            {/* Send test email — validates the currently active provider */}
            {hasPermission(permissions, 'system-settings', 'edit') && (
                <Card className="mb-6">
                    <label className="block text-sm font-semibold text-heading mb-1" htmlFor="testEmail">
                        Send a test email
                    </label>
                    <p className="text-xs text-body mb-3">
                        Sends a test message using your currently active provider. Save & activate a provider first.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <FormField
                            id="testEmail"
                            type="email"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            placeholder="recipient@example.com"
                            containerClassName="w-full sm:max-w-xs"
                        />
                        <Button
                            type="button"
                            variant="white"
                            onClick={handleSendTestEmail}
                            disabled={isTesting}
                            leftIcon={<Send size={16} />}
                        >
                            {isTesting ? 'Sending…' : 'Send Test Email'}
                        </Button>
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                <ProviderCard
                    icon={<img src={nodemail} alt="Node Mail" className="w-6 h-6 object-contain" />}
                    title="Node Mail"
                    description="Used to send emails safely and easily via PHP code from a web server."
                    configured={nodeState.configured}
                    active={nodeState.active}
                    summary={nodeState.summary}
                    canEdit={canEdit}
                    switchName="NodeMailStatus"
                    onConfigure={handleNodeMailConfigClick}
                    onToggle={() => handleStatusChange('NodeMail')}
                />

                <ProviderCard
                    icon={<img src={smtpImage} alt="SMTP" className="w-6 h-6 object-contain" />}
                    title="SMTP"
                    description="SMTP is used to send, relay or forward messages from a mail client."
                    configured={smtpState.configured}
                    active={smtpState.active}
                    summary={smtpState.summary}
                    canEdit={canEdit}
                    switchName="SMTPStatus"
                    onConfigure={handleSmtpConfigClick}
                    onToggle={() => handleStatusChange('SMTP')}
                />

                <ProviderCard
                    icon={<Send size={20} className="text-body" />}
                    title="Resend"
                    description="Modern email API with high deliverability. Add your Resend API key and a verified sender domain."
                    configured={resendState.configured}
                    active={resendState.active}
                    summary={resendState.summary}
                    canEdit={canEdit}
                    switchName="ResendStatus"
                    onConfigure={handleResendConfigClick}
                    onToggle={() => handleStatusChange('Resend')}
                />

            </div>

            {/* Configuration Modal */}
            <Modal
                isOpen={isConfigurationModalOpen}
                onClose={() => setIsConfigurationModalOpen(false)}
                title={configurationType === 'NodeMail' ? 'Node Mail Configuration' : configurationType === 'Resend' ? 'Resend Configuration' : 'SMTP Configuration'}>
                <form onSubmit={handleSubmit} noValidate>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                        {/* From Name */}
                        <FormField
                            label="From Name"
                            required
                            id="fromName"
                            type="text"
                            name="fromName"
                            value={formData.fromName}
                            onChange={handleInputChange}
                            placeholder="e.g., Example Company"
                            error={formErrors.fromName}
                            containerClassName="md:col-span-2"
                        />

                        {/* From Email */}
                        <FormField
                            label="From Email"
                            required
                            id="fromEmail"
                            type="email"
                            name="fromEmail"
                            value={formData.fromEmail}
                            onChange={handleInputChange}
                            placeholder="e.g., no-reply@example.com"
                            error={formErrors.fromEmail}
                            containerClassName="md:col-span-2"
                        />

                        {/* Reply-To Email (optional) */}
                        <div className="md:col-span-2">
                            <FormField
                                label={<>Reply-To Email <span className="text-body font-normal">(optional)</span></>}
                                id="replyTo"
                                type="email"
                                name="replyTo"
                                value={formData.replyTo}
                                onChange={handleInputChange}
                                placeholder="e.g., finance@example.com"
                                error={formErrors.replyTo}
                            />
                            <p className="text-xs text-body mt-1">
                                Replies go here. Use your real inbox while the From Email stays on the verified sending domain.
                            </p>
                        </div>

                        {configurationType !== 'Resend' && (<>
                        {/* Host */}
                        <FormField
                            label="Host"
                            required
                            id="host"
                            type="text"
                            name="host"
                            value={formData.host}
                            onChange={handleInputChange}
                            placeholder="e.g., smtp.example.com"
                            error={formErrors.host}
                        />

                        {/* Port */}
                        <FormField
                            label="Port"
                            required
                            id="port"
                            type="number"
                            name="port"
                            value={formData.port}
                            onChange={handleInputChange}
                            placeholder="e.g., 587"
                            error={formErrors.port}
                        />

                        {/* Username */}
                        <FormField
                            label="Username"
                            required
                            id="username"
                            type="text"
                            name="username"
                            value={formData.username}
                            onChange={handleInputChange}
                            placeholder="Your username"
                            error={formErrors.username}
                        />

                        {/* Password */}
                        <div>
                            <FormField
                                label="Password"
                                required={!modalHasSecret}
                                id="password"
                                type="password"
                                name="password"
                                value={formData.password}
                                onChange={handleInputChange}
                                placeholder={modalHasSecret ? '•••••••• (saved — leave blank to keep)' : '••••••••'}
                                error={formErrors.password}
                            />
                            {modalHasSecret && <p className="text-xs text-body mt-1">A password is already saved. Leave blank to keep it, or enter a new one to replace it.</p>}
                        </div>
                        </>)}

                        {/* API Key (Resend) */}
                        {configurationType === 'Resend' && (
                            <div className="md:col-span-2">
                                <FormField
                                    label="Resend API Key"
                                    required={!modalHasSecret}
                                    id="apiKey"
                                    type="password"
                                    name="apiKey"
                                    value={formData.apiKey}
                                    onChange={handleInputChange}
                                    placeholder={modalHasSecret ? '•••••••• (saved — leave blank to keep)' : 're_xxxxxxxxxxxxxxxx'}
                                    error={formErrors.apiKey}
                                />
                                <p className="text-xs text-body mt-1">
                                    {modalHasSecret
                                        ? 'An API key is already saved. Leave blank to keep it, or enter a new one to replace it.'
                                        : 'Create a key at resend.com → API Keys. The From Email\'s domain must be verified in Resend.'}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end mt-6 pt-4 ">
                        <Button type="button"
                            variant="white"
                            onClick={() => setIsConfigurationModalOpen(false)}
                            className="mr-3"
                        >
                            Cancel
                        </Button>
                        <SubmitButton
                            isDisabled={isSaving}
                            isLoading={isSaving}
                            mode='edit'
                        />
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default EmailSettings;
