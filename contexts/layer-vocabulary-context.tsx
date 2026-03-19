'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { createClient } from '@/lib/supabase/client';
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
// Context + Provider
// ---------------------------------------------------------------------------

const LayerVocabularyContext =
  createContext<LayerVocabularyContextValue | null>(null);

export function LayerVocabularyProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const [layers, setLayers] = useState<LayerDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchLayers = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('layer_vocabulary')
        .select('id, key, label, description, display_order, is_active')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (!isMountedRef.current) return;

      if (fetchError) {
        console.warn(
          'Failed to fetch layer vocabulary, using fallback:',
          fetchError.message,
        );
        // Fall back to static config
        setLayers(
          FALLBACK_LAYERS.map((l, i) => ({
            id: `fallback-${i}`,
            key: l.key,
            label: l.label,
            description: l.description,
            display_order: l.order,
            is_active: true,
          })),
        );
        setError(null); // Don't surface fallback as an error
        setLoading(false);
        return;
      }

      setLayers((data ?? []) as LayerDefinition[]);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.warn('Layer vocabulary fetch exception, using fallback:', err);
      // Fall back to static config
      setLayers(
        FALLBACK_LAYERS.map((l, i) => ({
          id: `fallback-${i}`,
          key: l.key,
          label: l.label,
          description: l.description,
          display_order: l.order,
          is_active: true,
        })),
      );
      setError(null);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetchLayers();
  }, [fetchLayers]);

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      hasFetchedRef.current = false;
      fetchLayers();
    }, 300);
  }, [fetchLayers]);

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
