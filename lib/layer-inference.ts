/**
 * Layer Inference — Deterministic Content Layer Suggestion
 *
 * Pure TypeScript function that suggests a content layer assignment
 * based on information known at creation time. No AI calls, no database
 * queries — evaluates rules in priority order and returns the first match.
 *
 * Spec: docs/specs/layer-suggestion-spec.md (Section 3)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayerInferenceInput {
  /** Content type (e.g. 'q_a_pair', 'article', 'policy') */
  contentType: string;
  /** Plain text length in characters */
  contentLength: number;
  /** How the item was created */
  ingestionSource: 'manual' | 'url_import' | 'upload' | 'bid_library';
  /** Whether progressive depth fields are populated */
  hasBrief: boolean;
  hasDetail: boolean;
  hasReference: boolean;
  /** Whether the item originated from a bid workspace */
  isBidDiscovered: boolean;
  /** Title text (for keyword heuristics) */
  title: string;
}

/** @public */
export interface LayerSuggestion {
  /** Suggested layer key (e.g. 'sales_brief') */
  suggestedLayer: string;
  /** Human-readable explanation */
  reason: string;
  /** Confidence: 'high', 'medium', 'low' */
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Layer key constants — sourced from CLIENT_CONFIG.layer_vocabulary
// ---------------------------------------------------------------------------

/** @see lib/client-config.ts — FALLBACK_LAYERS */
const LAYER_SALES_BRIEF = 'sales_brief';
const LAYER_BID_DETAIL = 'bid_detail';
const LAYER_COMPANY_REFERENCE = 'company_reference';
const LAYER_RESEARCH = 'research';

// ---------------------------------------------------------------------------
// Content type sets for Rule 4
// ---------------------------------------------------------------------------

const COMPANY_REFERENCE_TYPES = new Set([
  'policy',
  'compliance',
  'certification',
]);
const BID_DETAIL_TYPES = new Set([
  'product_description',
  'capability',
  'methodology',
]);

// ---------------------------------------------------------------------------
// Inference function
// ---------------------------------------------------------------------------

/**
 * Infer the most appropriate content layer for a new item.
 *
 * Evaluates 7 rules in strict priority order (top-to-bottom) and returns
 * the first match. Every code path returns a valid `LayerSuggestion` —
 * the final rule is a catch-all default.
 *
 * This is a **pure function**: no side effects, no database access,
 * no asynchronous operations.
 */
export function inferLayer(input: LayerInferenceInput): LayerSuggestion {
  // Rule 1: Procurement-discovered content
  if (input.isBidDiscovered) {
    return {
      suggestedLayer: LAYER_BID_DETAIL,
      reason:
        'Content discovered through a bid workspace is typically bid-level detail',
      confidence: 'high',
    };
  }

  // Rule 2: Procurement library Q&A pairs
  if (
    input.ingestionSource === 'bid_library' &&
    input.contentType === 'q_a_pair'
  ) {
    return {
      suggestedLayer: LAYER_BID_DETAIL,
      reason: 'Q&A pairs imported from bid documents are bid-level detail',
      confidence: 'high',
    };
  }

  // Rule 3: Progressive depth field presence
  if (input.hasReference) {
    return {
      suggestedLayer: LAYER_COMPANY_REFERENCE,
      reason: 'Reference field populated — company reference layer',
      confidence: 'high',
    };
  }

  if (input.hasDetail && input.hasBrief) {
    return {
      suggestedLayer: LAYER_BID_DETAIL,
      reason: 'Both brief and detail fields populated — bid-level depth',
      confidence: 'medium',
    };
  }

  if (input.hasBrief && !input.hasDetail) {
    return {
      suggestedLayer: LAYER_SALES_BRIEF,
      reason: 'Brief field populated without detail — sales brief depth',
      confidence: 'medium',
    };
  }

  // Rule 4: Content type mapping
  if (COMPANY_REFERENCE_TYPES.has(input.contentType)) {
    return {
      suggestedLayer: LAYER_COMPANY_REFERENCE,
      reason:
        'Policies and compliance documents are typically company reference material',
      confidence: 'medium',
    };
  }

  if (input.contentType === 'research') {
    return {
      suggestedLayer: LAYER_RESEARCH,
      reason: 'Research content type maps directly to the research layer',
      confidence: 'high',
    };
  }

  if (input.contentType === 'case_study') {
    return {
      suggestedLayer: LAYER_BID_DETAIL,
      reason: 'Case studies are typically used as bid evidence',
      confidence: 'medium',
    };
  }

  if (BID_DETAIL_TYPES.has(input.contentType)) {
    return {
      suggestedLayer: LAYER_BID_DETAIL,
      reason: 'Product/capability descriptions are typically bid-level detail',
      confidence: 'medium',
    };
  }

  // Rule 5: Content length heuristics
  if (input.contentType === 'q_a_pair' && input.contentLength < 500) {
    return {
      suggestedLayer: LAYER_SALES_BRIEF,
      reason: 'Short Q&A pair — likely sales-brief depth',
      confidence: 'low',
    };
  }

  if (input.contentType === 'q_a_pair' && input.contentLength >= 500) {
    return {
      suggestedLayer: LAYER_BID_DETAIL,
      reason: 'Detailed Q&A pair — likely bid-detail depth',
      confidence: 'low',
    };
  }

  if (input.contentLength < 300) {
    return {
      suggestedLayer: LAYER_SALES_BRIEF,
      reason: 'Very short content — likely a brief or positioning piece',
      confidence: 'low',
    };
  }

  if (input.contentLength > 3000) {
    return {
      suggestedLayer: LAYER_COMPANY_REFERENCE,
      reason: 'Long content — likely reference or detailed documentation',
      confidence: 'low',
    };
  }

  // Rule 6: Source-based fallback
  //
  // NOTE (ID-110): The manual URL-paste route (POST /api/ingest/url) no longer
  // calls inferLayer — it writes the reference layer directly. This branch is
  // NOT dead, however: the batch-reclassify queue handler still maps
  // `platform === 'web'` → `'url_import'` and passes it here
  // (lib/queue/handlers/batch-reclassify.ts:910/918), and /api/items accepts an
  // `ingestion_source: 'url_import'` (app/api/items/route.ts:281). Retained as a
  // live content_items classification path; do not remove without re-pointing
  // those callers.
  if (input.ingestionSource === 'url_import') {
    return {
      suggestedLayer: LAYER_RESEARCH,
      reason: 'Web-imported content is often research or background material',
      confidence: 'low',
    };
  }

  // Rule 7: Default
  return {
    suggestedLayer: LAYER_BID_DETAIL,
    reason: 'Default suggestion — bid detail is the most common layer',
    confidence: 'low',
  };
}
