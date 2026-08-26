import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';

import type { RootState } from '@store/index';
import Constants from '@constants/api';
import CurrencySelect from '@components/admin/CurrencySelect';
import SubmitButton from '@components/admin/SubmitButton';
import { useDocumentDefaults } from '@hooks/useDocumentDefaults';
import { PageHeader } from '@/context/PageHeaderContext';
import { Card, FormField, Select, fieldControlClasses } from '@components/ui';

const sectionHeaderClass = 'flex items-center gap-2 px-5 py-4 border-b border-border text-lg font-semibold text-heading';

interface SignatureOption {
    id: string;
    name: string;
}

const DocumentDefaultsPage: React.FC = () => {
    const { token } = useSelector((s: RootState) => s.auth);
    const { defaults, loading, refetch } = useDocumentDefaults();

    // form state — mirrors DocumentDefaults shape
    const [currencyCode, setCurrencyCode] = useState('');
    const [signType, setSignType] = useState<'none' | 'digitalSignature' | 'eSignature'>('none');
    const [signatureId, setSignatureId] = useState<string>('');
    const [paymentTermsDays, setPaymentTermsDays] = useState<string>('');
    const [defaultNotes, setDefaultNotes] = useState('');
    const [defaultTerms, setDefaultTerms] = useState('');

    // saved signature list (for manual-signature picker)
    const [signatures, setSignatures] = useState<SignatureOption[]>([]);
    const [signaturesLoading, setSignaturesLoading] = useState(false);

    const [saving, setSaving] = useState(false);

    // ---- populate form once defaults load ----
    useEffect(() => {
        if (loading) return;
        setCurrencyCode(defaults.defaultCurrencyCode ?? '');
        setSignType(defaults.defaultSignType ?? 'none');
        setSignatureId(defaults.defaultSignatureId ?? '');
        setPaymentTermsDays(
            defaults.paymentTermsDays != null ? String(defaults.paymentTermsDays) : ''
        );
        setDefaultNotes(defaults.defaultNotes ?? '');
        setDefaultTerms(defaults.defaultTerms ?? '');
    }, [loading, defaults]);

    // ---- load saved signatures for manual picker ----
    useEffect(() => {
        if (!token) return;
        setSignaturesLoading(true);
        axios
            .get(Constants.FETCH_SIGNATURES_WITH_SEARCH_URL, {
                headers: { Authorization: `Bearer ${token}` },
                params: { limit: 200 },
            })
            .then((res) => {
                const raw: Array<{ id: string; signatureName: string }> =
                    Array.isArray(res.data?.data) ? res.data.data : [];
                setSignatures(raw.map((s) => ({ id: s.id, name: s.signatureName })));
            })
            .catch(() => {
                // non-critical — leave list empty
            })
            .finally(() => setSignaturesLoading(false));
    }, [token]);

    // ---- save handler ----
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSaving(true);
            const payload: Record<string, unknown> = {
                defaultSignType: signType,
                defaultNotes,
                defaultTerms,
            };
            if (currencyCode) payload.defaultCurrencyCode = currencyCode;
            if (signType === 'digitalSignature' && signatureId) {
                payload.defaultSignatureId = signatureId;
            } else {
                payload.defaultSignatureId = null;
            }
            const terms = paymentTermsDays.trim();
            payload.paymentTermsDays =
                terms === '' || terms === '0' ? null : Number(terms);

            await axios.put(Constants.UPDATE_DOCUMENT_DEFAULTS_URL, payload, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success('Document defaults saved');
            refetch();
        } catch {
            toast.error('Failed to save document defaults');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="space-y-4">
                <PageHeader title="Document Defaults" />
                <p className="text-body">Loading...</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <PageHeader title="Document Defaults">
                <SubmitButton form="document-defaults-form" isLoading={saving} isDisabled={saving}>
                    {saving ? 'Saving…' : 'Save Document Defaults'}
                </SubmitButton>
            </PageHeader>

            <p className="text-sm text-body">
                These defaults are pre-applied to every new document (invoice, quotation, etc.) and
                can be changed per document.
            </p>

            <form id="document-defaults-form" onSubmit={handleSave} className="space-y-6 max-w-2xl">
                {/* ---- Currency ---- */}
                <Card padded={false} header={<div className={sectionHeaderClass}>Currency</div>}>
                    <div className="p-5 space-y-4">
                        <CurrencySelect
                            label="Default Currency"
                            value={currencyCode}
                            onChange={setCurrencyCode}
                        />
                        <p className="text-xs text-body">
                            Leave blank to use the company's default currency.
                        </p>
                    </div>
                </Card>

                {/* ---- Signature ---- */}
                <Card padded={false} header={<div className={sectionHeaderClass}>Default Signature</div>}>
                    <div className="p-5 space-y-4">
                        <div className="space-y-2">
                            {(
                                [
                                    { value: 'none', label: 'No Signature' },
                                    { value: 'digitalSignature', label: 'Manual Signature' },
                                    { value: 'eSignature', label: 'eSignature' },
                                ] as const
                            ).map(({ value, label }) => (
                                <label
                                    key={value}
                                    className="flex items-center gap-3 cursor-pointer"
                                >
                                    <input
                                        type="radio"
                                        name="signType"
                                        value={value}
                                        checked={signType === value}
                                        onChange={() => setSignType(value)}
                                        className="accent-purple-600"
                                    />
                                    <span className="text-sm text-heading">{label}</span>
                                </label>
                            ))}
                        </div>

                        {signType === 'digitalSignature' && (
                            <Select
                                label="Saved Signature"
                                value={signatureId}
                                onChange={(e) => setSignatureId(e.target.value)}
                                disabled={signaturesLoading}
                                helper={signaturesLoading ? 'Loading signatures…' : undefined}
                                options={[
                                    { value: '', label: '— select a signature —' },
                                    ...signatures.map((s) => ({ value: s.id, label: s.name })),
                                ]}
                            />
                        )}
                    </div>
                </Card>

                {/* ---- Payment Terms ---- */}
                <Card padded={false} header={<div className={sectionHeaderClass}>Payment Terms</div>}>
                    <div className="p-5 space-y-4">
                        <FormField
                            label="Payment Due (days)"
                            id="paymentTermsDays"
                            type="number"
                            min={0}
                            step={1}
                            value={paymentTermsDays}
                            onChange={(e) => setPaymentTermsDays(e.target.value)}
                            placeholder="e.g. 30"
                            helper="Due date = document date + N days. Leave blank or 0 for no due date."
                        />
                    </div>
                </Card>

                {/* ---- Notes & Terms ---- */}
                <Card padded={false} header={<div className={sectionHeaderClass}>Default Notes &amp; Terms</div>}>
                    <div className="p-5 space-y-4">
                        <FormField label="Default Notes" containerClassName="mb-0">
                            {(field) => (
                                <textarea
                                    id={field.id}
                                    aria-describedby={field['aria-describedby']}
                                    rows={3}
                                    value={defaultNotes}
                                    onChange={(e) => setDefaultNotes(e.target.value)}
                                    placeholder="Notes visible to the customer…"
                                    className={fieldControlClasses()}
                                />
                            )}
                        </FormField>

                        <FormField label="Default Terms & Conditions" containerClassName="mb-0">
                            {(field) => (
                                <textarea
                                    id={field.id}
                                    aria-describedby={field['aria-describedby']}
                                    rows={4}
                                    value={defaultTerms}
                                    onChange={(e) => setDefaultTerms(e.target.value)}
                                    placeholder="Terms and conditions…"
                                    className={fieldControlClasses()}
                                />
                            )}
                        </FormField>
                    </div>
                </Card>

            </form>
        </div>
    );
};

export default DocumentDefaultsPage;
