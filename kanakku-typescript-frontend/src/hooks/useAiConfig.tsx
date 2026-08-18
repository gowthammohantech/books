/**
 * Lightweight hook to read the user's current AiConfig snapshot
 * (Cluster H, slice H.2+).
 *
 * Used by purchase / sidebar / chat-fab components that conditionally
 * render UI based on whether AI is enabled. Single GET per mount,
 * cached in module state so the various consumers share one fetch.
 */
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';

import Constants from '@constants/api';
import type { RootState } from '@store/index';

export interface AiConfigSnapshot {
  provider: 'CLAUDE' | 'OPENAI' | 'MOCK';
  enabled: boolean;
  apiKeyHint: string | null;
  extractionModel: string | null;
  chatModel: string | null;
  monthlyBudgetUsd: number;
  hasApiKey: boolean;
}

interface CacheEntry {
  config: AiConfigSnapshot | null;
  loading: boolean;
}

let cache: CacheEntry = { config: null, loading: false };
const subscribers = new Set<(c: CacheEntry) => void>();

function notify() {
  for (const cb of subscribers) cb(cache);
}

async function loadAiConfig(token: string): Promise<void> {
  if (cache.loading) return;
  cache = { ...cache, loading: true };
  notify();
  try {
    const res = await axios.get(Constants.AI_CONFIG_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const config = res.data?.data?.config ?? null;
    cache = { config, loading: false };
  } catch {
    // Treat any error (401, network) as "AI not configured" so the UI
    // hides AI-only entry points rather than crashing.
    cache = { config: null, loading: false };
  } finally {
    notify();
  }
}

export function useAiConfig(): {
  config: AiConfigSnapshot | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const token = useSelector((s: RootState) => s.auth.token);
  const [state, setState] = useState<CacheEntry>(cache);

  useEffect(() => {
    const cb = (c: CacheEntry) => setState(c);
    subscribers.add(cb);
    if (token && !cache.config && !cache.loading) {
      void loadAiConfig(token);
    }
    return () => {
      subscribers.delete(cb);
    };
  }, [token]);

  return {
    config: state.config,
    loading: state.loading,
    refresh: async () => {
      if (token) {
        cache = { config: null, loading: false };
        await loadAiConfig(token);
      }
    },
  };
}
