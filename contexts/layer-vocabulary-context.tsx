'use client';

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query/query-keys';
import { FALLBACK_LAYERS } from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayerDefinition {
  id: string;
  key: string;
  label: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

interface LayerVocabularyContextValue {
  /** All active layers, ordered by display_order */
  layers: LayerDefinition[];
  /** Whether layer data is still loading */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Get ordered array of layer keys */
  getLayerKeys: () => string[];
  /** Get human-readable label for a layer key */
  getLayerLabel: (key: string) => string;
  /** Get description for a layer key */
  getLayerDescription: (key: string) => string | null;
  /** Force re-fetch from DB (called after admin mutations) */
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Fallback layers (used when DB fetch fails)
// ---------------------------------------------------------------------------

const FALLBACK_LAYER_DEFINITIONS: LayerDefinition[] = FALLBACK_LAYERS.map(
  (l, i) => ({
    id: `fallback-${i}`,
    key: l.key,
    label: l.label,
    description: l.description,
    display_order: l.order,
    is_active: true,
  }),
);

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchLayerVocabulary(): Promise<LayerDefinition[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('layer_vocabulary')
    .select('id, key, label, description, display_order, is_active')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.warn(
      'Failed to fetch layer vocabulary, using fallback:',
      error.message,
    );
    return FALLBACK_LAYER_DEFINITIONS;
  }

  return (data ?? []) as LayerDefinition[];
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const LayerVocabularyContext =
  createContext<LayerVocabularyContextValue | null>(null);

export function LayerVocabularyProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  const {
    data: layers = FALLBACK_LAYER_DEFINITIONS,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.layers.list,
    queryFn: fetchLayerVocabulary,
    // On error, the queryFn itself returns fallback data, so this shouldn't
    // normally fire. But if an unexpected exception occurs, staleTime ensures
    // we don't hammer the DB.
    staleTime: 5 * 60 * 1000,
  });

  // Map TanStack Query error to string (matching original context API)
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load layers') : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.layers.all });
  }, [queryClient]);

  // Build lookup map for efficient label/description access
  const layerByKey = useMemo(() => {
    const map = new Map<string, LayerDefinition>();
    for (const l of layers) {
      map.set(l.key, l);
    }
    return map;
  }, [layers]);

  const getLayerKeys = useCallback(
    (): string[] => layers.map((l) => l.key),
    [layers],
  );

  const getLayerLabel = useCallback(
    (key: string): string => layerByKey.get(key)?.label ?? key,
    [layerByKey],
  );

  const getLayerDescription = useCallback(
    (key: string): string | null => layerByKey.get(key)?.description ?? null,
    [layerByKey],
  );

  const contextValue: LayerVocabularyContextValue = useMemo(
    () => ({
      layers,
      loading,
      error,
      getLayerKeys,
      getLayerLabel,
      getLayerDescription,
      refresh,
    }),
    [layers, loading, error, getLayerKeys, getLayerLabel, getLayerDescription, refresh],
  );

  return (
    <LayerVocabularyContext.Provider value={contextValue}>
      {children}
    </LayerVocabularyContext.Provider>
  );
}

export function useLayerVocabulary(): LayerVocabularyContextValue {
  const ctx = useContext(LayerVocabularyContext);
  if (!ctx)
    throw new Error(
      'useLayerVocabulary must be used within LayerVocabularyProvider',
    );
  return ctx;
}
