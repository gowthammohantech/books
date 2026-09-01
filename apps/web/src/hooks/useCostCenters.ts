import api from '@lib/apiClient';
import { useState, useEffect, useCallback } from 'react';

import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';

export type CostCenterType = 'PROFIT' | 'COST' | 'BOTH';

export interface CostCenterOption {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    type: CostCenterType;
    isActive: boolean;
    parentId?: string | null;
    parent?: { id: string; code: string; name: string } | null;
    numberPrefix?: string | null;
    nextNumber?: number;
}

/** Which document a picker belongs to, so the list can be filtered sensibly.
 *  A BOTH centre always qualifies — it plays either role. */
export type CostCenterUsage = 'sales' | 'purchase' | 'any';

// Module-level cache so the nine document forms share one fetch rather than
// each firing its own on mount. Mirrors useCurrencies.
let _cached: CostCenterOption[] | null = null;
let _inflight: Promise<CostCenterOption[]> | null = null;

/** Drop the cache so the next mount refetches. Call after any create/edit/delete
 *  on the Profit Centers master, or the forms keep offering a stale list. */
export function invalidateCostCenters(): void {
    _cached = null;
    _inflight = null;
}

export function useCostCenters(usage: CostCenterUsage = 'any') {
    const { token } = useSelector((s: RootState) => s.auth);

    const [costCenters, setCostCenters] = useState<CostCenterOption[]>(_cached ?? []);
    const [loading, setLoading] = useState(!_cached);

    useEffect(() => {
        if (_cached) {
            setCostCenters(_cached);
            setLoading(false);
            return;
        }
        if (!token) return;

        if (!_inflight) {
            _inflight = api
                .get(Constants.FETCH_COST_CENTERS_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                    // all=1: the picker must be able to resolve ANY saved id to a
                    // label. A paginated fetch would render older centres blank.
                    params: { all: 1 },
                })
                .then((res) => {
                    const raw = res.data?.data;
                    const list: CostCenterOption[] = Array.isArray(raw) ? raw : [];
                    _cached = list;
                    return list;
                })
                .catch(() => {
                    _inflight = null;
                    return [];
                });
        }

        setLoading(true);
        _inflight.then((list) => {
            setCostCenters(list);
            setLoading(false);
        });
    }, [token]);

    /** Centres valid for this document type. BOTH always qualifies. */
    const options = useCallback((): CostCenterOption[] => {
        if (usage === 'any') return costCenters;
        const wanted: CostCenterType = usage === 'sales' ? 'PROFIT' : 'COST';
        return costCenters.filter((c) => c.type === wanted || c.type === 'BOTH');
    }, [costCenters, usage])();

    /** Resolve an id to its centre, including one filtered out of `options`
     *  (inactive, or the wrong type for this document). Editing an old document
     *  must not silently drop the tag it was saved with. */
    const resolveCostCenter = useCallback(
        (id: string | null | undefined): CostCenterOption | null => {
            if (!id) return null;
            return (costCenters.length ? costCenters : _cached ?? []).find((c) => c.id === id) ?? null;
        },
        [costCenters],
    );

    const labelFor = useCallback(
        (id: string | null | undefined): string => {
            const found = resolveCostCenter(id);
            return found ? `${found.code} — ${found.name}` : '';
        },
        [resolveCostCenter],
    );

    return { costCenters, options, loading, resolveCostCenter, labelFor };
}
