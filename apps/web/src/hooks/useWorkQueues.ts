import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import api from '@lib/apiClient';
import Constants from '@constants/api';
import type { RootState } from '@store/index';
import type { WorkQueueCounts } from '@lib/workQueues';

/**
 * The queue counts, shared by the sidebar badges and the dashboard tiles.
 *
 * Module-level cache with a subscriber set, following useAiConfig: the sidebar
 * is mounted on every page and the dashboard mounts alongside it, so a
 * per-component fetch would issue the same request twice on the one screen
 * where both are visible.
 *
 * Failures are swallowed to `null`. A missing badge is a cosmetic loss; a
 * dashboard that refuses to render because a count endpoint was slow is not.
 */
interface CacheEntry {
    counts: WorkQueueCounts | null;
    loading: boolean;
    /** Which tenant the cached counts belong to. */
    tenantId: string | null;
}

let cache: CacheEntry = { counts: null, loading: false, tenantId: null };
const subscribers = new Set<(entry: CacheEntry) => void>();

const notify = () => {
    for (const callback of subscribers) callback(cache);
};

async function load(tenantId: string): Promise<void> {
    if (cache.loading) return;
    cache = { ...cache, loading: true };
    notify();
    try {
        const response = await api.get(Constants.GET_WORK_QUEUES_URL);
        cache = { counts: response.data?.data ?? null, loading: false, tenantId };
    } catch {
        // Non-fatal by design — see the note above.
        cache = { counts: null, loading: false, tenantId };
    }
    notify();
}

/** Drops the cache so the next consumer refetches. */
export const invalidateWorkQueues = (): void => {
    cache = { counts: null, loading: false, tenantId: null };
    notify();
};

export const useWorkQueues = (): { counts: WorkQueueCounts | null; isLoading: boolean } => {
    const { token, activeTenant } = useSelector((state: RootState) => state.auth);
    const tenantId = activeTenant?.id ?? null;
    const [entry, setEntry] = useState<CacheEntry>(cache);

    useEffect(() => {
        subscribers.add(setEntry);
        return () => {
            subscribers.delete(setEntry);
        };
    }, []);

    useEffect(() => {
        if (!token || !tenantId) return;
        // Counts are per workspace. Switching companies does a full page load
        // today, so this is belt-and-braces — but a stale badge naming another
        // company's overdue invoices would be a genuinely misleading bug.
        if (cache.tenantId === tenantId && (cache.counts || cache.loading)) return;
        void load(tenantId);
    }, [token, tenantId]);

    return { counts: entry.counts, isLoading: entry.loading };
};

export default useWorkQueues;
