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
    /** AI integration: AI drafting, classification, Claude bridge */
    ai_integration: FeatureToggle;
    /** Bid management: full bid workflow */
    bid_management: FeatureToggle;
  };
  /** Content layer vocabulary — drives validation, UI labels, coverage grouping */
  layer_vocabulary: LayerDefinition[];
  /** Examples used in AI classification prompts for entity extraction guidance */
  entity_examples: {
    /** Full formal organisation name, e.g. "Example Client Ltd" */
    organisation_name: string;
    /** Short/informal name to avoid, e.g. "example-client" */
    organisation_short: string;
    /** Canonical product name, e.g. "example-client Audit System" */
    product_name: string;
    /** Informal product name to avoid, e.g. "audit system" */
    product_short: string;
  };
  /**
   * Client-specific classification disambiguation rules.
   *
   * Interpolated into the `{CLIENT_DISAMBIGUATION}` placeholder in
   * `lib/ai/skills/classification.md` via `lib/ai/classify.ts` and
   * `scripts/eval-classification.ts`. Each rule may contain
   * `{CLIENT_PRODUCT_NAME}`, `{CLIENT_ORGANISATION_NAME}`, etc.
   * placeholders — these are resolved by the subsequent `.replaceAll`
   * chain at the prompt-assembly call site.
   *
   * Multi-client readiness note: these rules are the only client-
   * specific classification knobs outside the skill file itself. When a
   * new client is onboarded (e.g. demo DB or a client DB branch), their
   * rules go here rather than being hardcoded in `classify.ts`. See
   * `docs/specs/entity-classification-prompt-tightening-spec.md` §13 Q6
   * resolution.
   */
  classification_disambiguation_rules: readonly string[];
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
      enabled: true,
      label: 'Coverage Dashboard',
      description: 'Visualise tag and layer coverage across content',
    },
    content_layers: {
      enabled: true,
      label: 'Content Layers',
      description:
        'Metadata-driven content depth layers (sales_brief → bid_detail → company_reference → research)',
    },
    draft_status: {
      enabled: true,
      label: 'Draft Status',
      description: 'Save items as drafts, hidden from search and matching',
    },
    ai_integration: {
      enabled: true,
      label: 'AI Integration',
      description: 'AI classification, summary generation, and Claude bridge',
    },
    bid_management: {
      enabled: true,
      label: 'Bid Management',
      description: 'Full bid workflow: extraction, drafting, review, export',
    },
  },

  entity_examples: {
    organisation_name: 'Example Client Ltd',
    organisation_short: 'example-client',
    product_name: 'example-client Audit System',
    product_short: 'audit system',
  },

  classification_disambiguation_rules: [
    '"{CLIENT_PRODUCT_NAME}" is a SOFTWARE PRODUCT, not an auditing process. Questions about its features (action plans, invites, reports, exports, user interface) belong in product-feature/*, NOT compliance/audit.',
    'Business continuity and disaster recovery (BC/DR) belong in security/cyber-security, not support/* or product-feature/*.',
    'Security awareness training, confidentiality clauses, and security governance belong in security/data-protection or corporate/staffing, NOT support/sla.',
    'Data security controls (encryption, access control, secure data transfer, infrastructure security) belong in security/*, NOT product-feature/*.',
    'Financial questions (pricing, costs, audited accounts, hidden costs) belong in corporate/financial.',
    'When "{CLIENT_ORGANISATION_NAME}" or its short form "{CLIENT_ORGANISATION_SHORT}" appears verbatim in content — including first-party Q&A answers where it reads as a self-reference (e.g. "{CLIENT_ORGANISATION_SHORT} is complying", "{CLIENT_ORGANISATION_SHORT} must", "{CLIENT_ORGANISATION_SHORT} Project Manager", "Phase 2. Implementation ({CLIENT_ORGANISATION_SHORT})") — extract it as an `organisation` entity. Client self-references are named entities, NOT pronouns. The alias map normalises the short form to the full formal name, so extracting the verbatim short form is correct.',
  ],

  layer_vocabulary: [
    {
      key: 'sales_brief',
      label: 'Sales Brief',
      description: 'Positioning and messaging for internal sales',
      order: 1,
    },
    {
      key: 'bid_detail',
      label: 'Bid Detail',
      description: 'Factual content for tender responses',
      order: 2,
    },
    {
      key: 'company_reference',
      label: 'Company Reference',
      description: 'Controlled corporate documents',
      order: 3,
    },
    {
      key: 'research',
      label: 'Research',
      description: 'Background material and market intelligence',
      order: 4,
    },
  ],
} as const satisfies ClientConfig;

// ---------------------------------------------------------------------------
// Convenience type exports
// ---------------------------------------------------------------------------

export type FeatureName = keyof typeof CLIENT_CONFIG.features;
export type LayerKey = (typeof CLIENT_CONFIG.layer_vocabulary)[number]['key'];

/**
 * Static fallback layer definitions.
 *
 * Used by:
 *   - LayerVocabularyProvider when the DB fetch fails
 *   - Server-side validation (API routes) that cannot use React context
 *   - Python pipeline (via layer-schemas.ts static exports)
 *
 * When adding new layers via the admin UI, also add them here and redeploy
 * so that server-side validation accepts them.
 */
export const FALLBACK_LAYERS: readonly LayerDefinition[] =
  CLIENT_CONFIG.layer_vocabulary;

/**
 * Check whether a feature is enabled in the static config.
 * Usable from both server and client contexts.
 */
export function isFeatureEnabled(feature: FeatureName): boolean {
  return CLIENT_CONFIG.features[feature].enabled;
}

/**
 * Build the `{CLIENT_DISAMBIGUATION}` block inserted into the
 * classification skill prompt. Returns a markdown bullet list of the
 * client's disambiguation rules.
 *
 * Placeholders inside the rules (`{CLIENT_PRODUCT_NAME}` etc.) are NOT
 * resolved here — they are resolved by the caller's subsequent
 * `.replaceAll` chain after `{CLIENT_DISAMBIGUATION}` substitution.
 *
 * Called from:
 *   - `lib/ai/classify.ts` (TypeScript classification pipeline)
 *   - `scripts/eval-classification.ts` (eval harness, kept in sync
 *     with the production pipeline by construction)
 */
export function buildDisambiguationBlock(): string {
  return CLIENT_CONFIG.classification_disambiguation_rules
    .map((rule) => `- ${rule}`)
    .join('\n');
}
