import { z } from 'zod';
import { CLIENT_CONFIG } from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Layer keys derived from config
// ---------------------------------------------------------------------------

const LAYER_KEYS = CLIENT_CONFIG.layer_vocabulary.map((l) => l.key);

/**
 * Zod schema for a valid layer key.
 * Rejects any value not in CLIENT_CONFIG.layer_vocabulary.
 */
export function getLayerSchema() {
  if (LAYER_KEYS.length === 0) {
    return z.never();
  }
  return z.enum(LAYER_KEYS as [string, ...string[]]);
}

/**
 * Schema for metadata updates that include layer content.
 * Each layer key maps to an optional string field.
 *
 * Example valid body: { sales_brief: "Positioning text", bid_detail: "Factual content" }
 */
export const MetadataUpdateBodySchema = z.object(
  Object.fromEntries(
    CLIENT_CONFIG.layer_vocabulary.map((layer) => [
      layer.key,
      z.string().max(50_000).optional(),
    ]),
  ),
);

/**
 * Get a human-readable label for a layer key.
 * Returns the key itself if not found in vocabulary.
 */
export function getLayerLabel(key: string): string {
  const layer = CLIENT_CONFIG.layer_vocabulary.find((l) => l.key === key);
  return layer?.label ?? key;
}

/**
 * Get all layer definitions in display order.
 */
export function getOrderedLayers() {
  return [...CLIENT_CONFIG.layer_vocabulary].sort((a, b) => a.order - b.order);
}
