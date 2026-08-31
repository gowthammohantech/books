import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';

export interface DocumentDefaults {
    defaultCurrencyCode: string;
    defaultSignType: 'none' | 'digitalSignature' | 'eSignature';
    defaultSignatureId: string | null;
    paymentTermsDays: number | null;
    defaultNotes: string;
    defaultTerms: string;
}

const SAFE_FALLBACK: DocumentDefaults = {
    defaultCurrencyCode: '',
    defaultSignType: 'none',
    defaultSignatureId: null,
    paymentTermsDays: null,
    defaultNotes: '',
    defaultTerms: '',
};

// Module-level cache so all hook instances share one fetch
let _cached: DocumentDefaults | null = null;
let _inflight: Promise<DocumentDefaults> | null = null;

export function useDocumentDefaults() {
    const { token } = useSelector((s: RootState) => s.auth);

    const [defaults, setDefaults] = useState<DocumentDefaults>(_cached ?? SAFE_FALLBACK);
    const [loading, setLoading] = useState(!_cached);

    const doFetch = useCallback((): Promise<DocumentDefaults> => {
        if (!_inflight) {
            _inflight = axios
                .get(Constants.GET_DOCUMENT_DEFAULTS_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                .then((res) => {
                    const raw = res.data?.data ?? {};
                    const result: DocumentDefaults = {
                        defaultCurrencyCode: raw.defaultCurrencyCode ?? '',
                        defaultSignType: raw.defaultSignType ?? 'none',
                        defaultSignatureId: raw.defaultSignatureId ?? null,
                        paymentTermsDays:
                            raw.paymentTermsDays != null ? Number(raw.paymentTermsDays) : null,
                        defaultNotes: raw.defaultNotes ?? '',
                        defaultTerms: raw.defaultTerms ?? '',
                    };
                    _cached = result;
                    return result;
                })
                .catch(() => {
                    _inflight = null;
                    return SAFE_FALLBACK;
                });
        }
        return _inflight;
    }, [token]);

    useEffect(() => {
        if (_cached) {
            setDefaults(_cached);
            setLoading(false);
            return;
        }
        if (!token) return;

        setLoading(true);
        doFetch().then((data) => {
            setDefaults(data);
            setLoading(false);
        });
    }, [token, doFetch]);

    /** Force a fresh fetch (e.g. after saving). Busts the module-level cache. */
    const refetch = useCallback(() => {
        if (!token) return;
        _cached = null;
        _inflight = null;
        setLoading(true);
        doFetch().then((data) => {
            setDefaults(data);
            setLoading(false);
        });
    }, [token, doFetch]);

    return { defaults, loading, refetch };
}
