/**
 * Unified gap types for the Priority Gaps view.
 *
 * Discriminated union representing gaps from three sources:
 * - Taxonomy (empty subtopics in the coverage matrix)
 * - Template (unmet requirements in bid templates)
 * - Guide (empty or stale required sections)
 *
 * Spec: .planning/specs/gaps-view-consolidation-spec.md §3
 */

import type { RequirementType } from '@/lib/domains/procurement/form-templating/template-coverage';

// ---------------------------------------------------------------------------
// Base type shared by all gap variants
// ---------------------------------------------------------------------------

/** Common fields shared by all gap types */
interface GapBase {
  /** Unique stable key for React rendering and deduplication */
  gap_key: string;
  /** Human-readable title for display */
  title: string;
  /** Optional description / context */
  description: string | null;
  /** Computed priority score (0-100, higher = more urgent) */
  priority_score: number;
  /** Priority tier derived from score for display */
  priority_tier: 'critical' | 'high' | 'medium' | 'low';
  /** Taxonomy domain this gap relates to (if known) */
  domain: string | null;
  /** Taxonomy subtopic this gap relates to (if known) */
  subtopic: string | null;
  /** Action URL -- where to go to fix this gap */
  action_href: string;
  /** Human-readable action label */
  action_label: string;
}

// ---------------------------------------------------------------------------
// Source-specific gap variants
// ---------------------------------------------------------------------------

/** A taxonomy gap: subtopic with 0 content items */
export interface TaxonomyGap extends GapBase {
  source: 'taxonomy';
  /** The domain name from the coverage matrix */
  domain_name: string;
  /** The subtopic name with 0 items */
  subtopic_name: string;
  /** Whether a coverage target exists and is unmet */
  target_unmet: boolean;
}

/** A template gap: requirement with coverage_status = 'gap' */
export interface TemplateGap extends GapBase {
  source: 'template';
  /** Template this gap belongs to */
  template_name: string;
  template_type: string;
  /** Section within the template */
  section_ref: string;
  section_name: string;
  /** The requirement text */
  requirement_text: string;
  /** Imported from lib/template-coverage.ts (not a shared types file) */
  requirement_type: RequirementType;
  /** Whether the requirement is mandatory (null treated as false in scoring) */
  is_mandatory: boolean | null;
}

/** A guide gap: section with 0 content or only stale content */
export interface GuideGap extends GapBase {
  source: 'guide';
  /** Guide identity */
  guide_id: string;
  guide_name: string;
  guide_slug: string;
  /** Section identity */
  section_id: string;
  section_name: string;
  /** Whether this section is marked as required */
  is_required: boolean;
  /** Section status */
  section_status: 'empty' | 'stale';
}

// ---------------------------------------------------------------------------
// Discriminated union + response envelope
// ---------------------------------------------------------------------------

/** Discriminated union of all gap types */
export type UnifiedGap = TaxonomyGap | TemplateGap | GuideGap;

/** Priority tier type for reuse */
export type PriorityTier = 'critical' | 'high' | 'medium' | 'low';

/** Aggregated gaps response returned by GET /api/coverage/gaps */
export interface UnifiedGapSummary {
  /** Total gaps across all sources */
  total_gaps: number;
  /** Breakdown by source */
  taxonomy_gaps: number;
  template_gaps: number;
  guide_gaps: number;
  /** Breakdown by priority tier */
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** Top-N gaps sorted by priority score descending */
  gaps: UnifiedGap[];
}
