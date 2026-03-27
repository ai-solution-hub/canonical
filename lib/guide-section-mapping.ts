/**
 * Guide Section Mapping — Suggest Guide Sections for New Content Items
 *
 * Async function that queries `guide_sections` (joined with `guides`) to find
 * published guide sections whose filters match a content item's classification.
 * Returns match suggestions with strength indicators (exact/partial/domain_only).
 *
 * Follows the same async-with-database pattern as `lib/topic-inference.ts`.
 * The matching logic mirrors the `get_guide_content` RPC but in reverse:
 * given an item's classification, find which guide sections it would populate.
 *
 * Spec: docs/specs/guide-section-mapping-spec.md (Phase 1)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuideSectionMatchInput {
  /** Item's classified primary domain */
  primaryDomain: string;
  /** Item's classified primary subtopic */
  primarySubtopic: string;
  /** Item's layer (from inferLayer() or item metadata) */
  layer?: string;
  /** Item's content type (from classification or user input) */
  contentType?: string;
}

export type MatchStrength = 'exact' | 'partial' | 'domain_only';

export interface GuideSectionMatch {
  /** Guide UUID */
  guideId: string;
  /** Human-readable guide name */
  guideName: string;
  /** Guide slug for constructing /guide/{slug} links */
  guideSlug: string;
  /** Section UUID */
  sectionId: string;
  /** Human-readable section name */
  sectionName: string;
  /** Display order within the guide */
  sectionOrder: number;
  /** Whether the section is marked as required */
  isRequired: boolean;
  /** How strongly the item matches this section's filters */
  matchStrength: MatchStrength;
  /** Human-readable explanation of why this section matches */
  matchReason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of suggestions to return */
const MAX_RESULTS = 5;

/** Match strength sort priority (lower = higher priority) */
const MATCH_STRENGTH_ORDER: Record<MatchStrength, number> = {
  exact: 0,
  partial: 1,
  domain_only: 2,
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Suggest guide sections that a content item would populate based on its
 * classification metadata.
 *
 * Performs a single query joining `guide_sections` to `guides`, filtered to
 * published guides whose `domain_filter` matches the item's primary domain.
 * Each candidate section is then evaluated client-side to determine match
 * strength.
 *
 * @param supabase - Authenticated Supabase client
 * @param input    - Classification results for the content item
 * @returns Array of matching guide sections, sorted by match strength then
 *          required status then display order. Maximum 5 results. Empty
 *          array if no matches or on error.
 */
export async function suggestGuideSections(
  supabase: SupabaseClient<Database>,
  input: GuideSectionMatchInput,
): Promise<GuideSectionMatch[]> {
  const { primaryDomain, primarySubtopic, layer, contentType } = input;

  // Guard: domain is required (sections are always scoped to a guide domain)
  if (!primaryDomain) {
    return [];
  }

  // ---------------------------
  // Query: fetch all sections from published guides matching this domain
  // ---------------------------
  const { data: sections, error } = await supabase
    .from('guide_sections')
    .select(
      'id, section_name, subtopic_filter, expected_layer, content_type_filter, display_order, is_required, guides!inner(id, name, slug, domain_filter, display_order, is_published)',
    )
    .eq('guides.is_published', true)
    .eq('guides.domain_filter', primaryDomain);

  if (error || !sections || sections.length === 0) {
    return [];
  }

  // ---------------------------
  // Client-side match evaluation
  // ---------------------------
  const matches: (GuideSectionMatch & { guideDisplayOrder: number })[] = [];

  for (const section of sections) {
    // Extract guide data from the joined relation
    const guide = section.guides as unknown as {
      id: string;
      name: string;
      slug: string;
      domain_filter: string | null;
      display_order: number;
      is_published: boolean;
    };

    if (!guide) continue;

    // Evaluate each non-NULL filter against the item's properties
    const filterChecks: { name: string; matches: boolean }[] = [];

    if (section.subtopic_filter !== null) {
      filterChecks.push({
        name: 'subtopic',
        matches: section.subtopic_filter === primarySubtopic,
      });
    }

    if (section.expected_layer !== null) {
      filterChecks.push({
        name: 'layer',
        matches: section.expected_layer === (layer ?? ''),
      });
    }

    if (section.content_type_filter !== null) {
      filterChecks.push({
        name: 'content type',
        matches: section.content_type_filter === (contentType ?? ''),
      });
    }

    // Determine match strength
    const totalFilters = filterChecks.length;
    const matchedFilters = filterChecks.filter((f) => f.matches);
    const matchedCount = matchedFilters.length;

    let matchStrength: MatchStrength;
    if (totalFilters === 0 || matchedCount === totalFilters) {
      // All non-NULL filters match (vacuously true if no filters)
      matchStrength = 'exact';
    } else if (matchedCount > 0) {
      matchStrength = 'partial';
    } else {
      matchStrength = 'domain_only';
    }

    // Build human-readable reason
    const matchReason = buildMatchReason(
      matchStrength,
      guide.name,
      section.section_name,
      matchedFilters.map((f) => f.name),
      filterChecks.filter((f) => !f.matches).map((f) => f.name),
    );

    matches.push({
      guideId: guide.id,
      guideName: guide.name,
      guideSlug: guide.slug,
      sectionId: section.id,
      sectionName: section.section_name,
      sectionOrder: section.display_order,
      isRequired: section.is_required,
      matchStrength,
      matchReason,
      guideDisplayOrder: guide.display_order,
    });
  }

  // ---------------------------
  // Sort and limit
  // ---------------------------
  matches.sort((a, b) => {
    // 1. Match strength (exact first)
    const strengthDiff =
      MATCH_STRENGTH_ORDER[a.matchStrength] -
      MATCH_STRENGTH_ORDER[b.matchStrength];
    if (strengthDiff !== 0) return strengthDiff;

    // 2. Required sections first
    if (a.isRequired !== b.isRequired) {
      return a.isRequired ? -1 : 1;
    }

    // 3. Guide display order
    const guideOrderDiff = a.guideDisplayOrder - b.guideDisplayOrder;
    if (guideOrderDiff !== 0) return guideOrderDiff;

    // 4. Section display order within the same guide
    return a.sectionOrder - b.sectionOrder;
  });

  // Strip internal guideDisplayOrder before returning
  return matches.slice(0, MAX_RESULTS).map(
    ({ guideDisplayOrder: _guideDisplayOrder, ...match }) => match,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable explanation of why a section matches.
 */
function buildMatchReason(
  strength: MatchStrength,
  guideName: string,
  sectionName: string,
  matchedFilters: string[],
  unmatchedFilters: string[],
): string {
  switch (strength) {
    case 'exact':
      if (matchedFilters.length === 0) {
        return `Matches "${guideName}" > "${sectionName}" — section accepts all content in this domain`;
      }
      return `Matches "${guideName}" > "${sectionName}" — all filters match (${matchedFilters.join(', ')})`;

    case 'partial':
      return `Partially matches "${guideName}" > "${sectionName}" — matches ${matchedFilters.join(', ')} but not ${unmatchedFilters.join(', ')}`;

    case 'domain_only':
      return `Domain match for "${guideName}" > "${sectionName}" — only domain matches (${unmatchedFilters.join(', ')} differ)`;
  }
}
