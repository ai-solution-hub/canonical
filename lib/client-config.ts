/**
 * Client Feature Configuration
 *
 * Single source of truth for all client-specific feature toggles and
 * layer vocabulary. This file drives:
 *   - Feature gate checks (via useClientFeatures() or direct import)
 *   - Zod validation schemas (lib/validation/layer-schemas.ts)
 *   - UI labels and coverage RPC grouping
 *
 * Storage is currently file-based. When multi-client support is added,
 * this config can migrate to a database table without changing consumers.
 */

// ---------------------------------------------------------------------------
// Feature toggle type
// ---------------------------------------------------------------------------

export interface FeatureToggle {
  /** Whether the feature is enabled for this client */
  enabled: boolean;
  /** Human-readable label for the feature */
  label: string;
  /** Brief description shown in settings / admin UI */
  description: string;
}

// ---------------------------------------------------------------------------
// Layer vocabulary type
// ---------------------------------------------------------------------------

export interface LayerDefinition {
  /** Internal identifier (used in DB, URLs, API) */
  key: string;
  /** Human-readable label for UI display */
  label: string;
  /** Brief description of what this layer contains */
  description: string;
  /** Display order in UI (lower = higher) */
  order: number;
}

// ---------------------------------------------------------------------------
// Client config shape
// ---------------------------------------------------------------------------

export interface ClientConfig {
  /** Unique client identifier */
  client_id: string;
  /** Display name for the client */
  client_name: string;
  /** Feature toggles keyed by feature name */
  features: {
    /** Tag management: rename, merge, delete, autocomplete */
    tag_management: FeatureToggle;
    /** Coverage dashboard: tag/layer coverage visualisation */
    coverage_dashboard: FeatureToggle;
    /** Content layers: metadata-driven content depth layers */
    content_layers: FeatureToggle;
    /** Draft status: lightweight draft workflow on governance */
    draft_status: FeatureToggle;
    /** AI integration: CopilotKit, AI drafting, classification */
    ai_integration: FeatureToggle;
    /** Bid management: full bid workflow */
    bid_management: FeatureToggle;
  };
  /** Content layer vocabulary — drives validation, UI labels, coverage grouping */
  layer_vocabulary: LayerDefinition[];
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const CLIENT_CONFIG = {
  client_id: 'default',
  client_name: 'Knowledge Hub',

  features: {
    tag_management: {
      enabled: true,
      label: 'Tag Management',
      description: 'Rename, merge, and delete tags across the knowledge base',
    },
    coverage_dashboard: {
      enabled: false,
      label: 'Coverage Dashboard',
      description: 'Visualise tag and layer coverage across content',
    },
    content_layers: {
      enabled: false,
      label: 'Content Layers',
      description: 'Metadata-driven content depth layers (brief → detail → reference)',
    },
    draft_status: {
      enabled: true,
      label: 'Draft Status',
      description: 'Save items as drafts, hidden from search and matching',
    },
    ai_integration: {
      enabled: true,
      label: 'AI Integration',
      description: 'CopilotKit chat, AI classification, and summary generation',
    },
    bid_management: {
      enabled: true,
      label: 'Bid Management',
      description: 'Full bid workflow: extraction, drafting, review, export',
    },
  },

  layer_vocabulary: [
    {
      key: 'brief',
      label: 'Brief',
      description: 'Executive summary — one paragraph overview',
      order: 1,
    },
    {
      key: 'detail',
      label: 'Detail',
      description: 'Expanded explanation with supporting context',
      order: 2,
    },
    {
      key: 'reference',
      label: 'Reference',
      description: 'Technical or source-level detail for deep dives',
      order: 3,
    },
  ],
} as const satisfies ClientConfig;

// ---------------------------------------------------------------------------
// Convenience type exports
// ---------------------------------------------------------------------------

export type FeatureName = keyof typeof CLIENT_CONFIG.features;
export type LayerKey = (typeof CLIENT_CONFIG.layer_vocabulary)[number]['key'];

/**
 * Check whether a feature is enabled in the static config.
 * Usable from both server and client contexts.
 */
export function isFeatureEnabled(feature: FeatureName): boolean {
  return CLIENT_CONFIG.features[feature].enabled;
}
