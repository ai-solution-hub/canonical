import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FALLBACK_LAYERS } from '@/lib/client-config';
import type { LayerDefinition } from '@/contexts/layer-vocabulary-context';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Server-side layer fetch helper (DB-driven validation — P1-36)
// ---------------------------------------------------------------------------

/**
 * Fetch active layer keys from the `layer_vocabulary` table.
 *
 * Returns `string[]` of `key` values ordered by `display_order` ASC.
 * Throws on Supabase error or empty result — callers should catch and
 * return 503 to the client.
 *
 * Uses the caller's authenticated Supabase client (respects RLS).
 */
export async function fetchActiveLayerKeys(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('layer_vocabulary')
    .select('key')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    throw new Error(`Layer vocabulary fetch failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error('No active layers found in layer_vocabulary');
  }
  return data.map((row) => row.key);
}

// ---------------------------------------------------------------------------
// Static fallback keys (used by server-side code that cannot use React context)
// ---------------------------------------------------------------------------

const FALLBACK_KEYS = FALLBACK_LAYERS.map((l) => l.key);

/**
 * Zod schema for a valid layer key.
 *
 * For server-side validation (API routes), call with no arguments to use
 * the static fallback list. For client-side validation with DB-driven layers,
 * pass the layers array from useLayerVocabulary().
 */
export function getLayerSchema(layers?: LayerDefinition[]) {
  const keys = layers ? layers.map((l) => l.key) : FALLBACK_KEYS;
  if (keys.length === 0) return z.never();
  return z.enum(keys as [string, ...string[]]);
}

/**
 * Schema for metadata updates that include layer content.
 * Each layer key maps to an optional string field.
 */
function getMetadataUpdateBodySchema(layers?: LayerDefinition[]) {
  const vocabulary = layers ?? FALLBACK_LAYERS;
  return z.object(
    Object.fromEntries(
      vocabulary.map((layer) => [
        'key' in layer ? layer.key : (layer as { key: string }).key,
        z.string().max(50_000).optional(),
      ]),
    ),
  );
}

// Test-only export; validates per-layer content shape, not layer key selection.
export const MetadataUpdateBodySchema = getMetadataUpdateBodySchema();

/**
 * Get a human-readable label for a layer key.
 * Returns the key itself if not found in vocabulary.
 *
 * Prefer useLayerVocabulary().getLayerLabel() in React components.
 * This function exists for non-React contexts (server code, MCP tools).
 */
export function getLayerLabel(key: string): string {
  const layer = FALLBACK_LAYERS.find((l) => l.key === key);
  return layer?.label ?? key;
}

/**
 * Get all layer definitions in display order.
 *
 * Prefer useLayerVocabulary().layers in React components.
 * This function exists for non-React contexts.
 */
export function getOrderedLayers() {
  return [...FALLBACK_LAYERS].sort((a, b) => a.order - b.order);
}
