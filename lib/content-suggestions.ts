/**
 * Smart Content Suggestion Engine
 *
 * Analyses coverage gaps and returns prioritised suggestions for content
 * creation. Data sources:
 *   - taxonomy_domains + taxonomy_subtopics (full taxonomy)
 *   - content_items (items grouped by domain/subtopic with freshness)
 *   - workspaces (active bids — used to elevate priority)
 *   - template_requirements (template gap analysis)
 *
 * Priority ranking:
 *   1. Critical — Empty subtopics in domains with active bids
 *   2. High    — Template gaps (requirements with no matching content)
 *   3. High    — Stale-only subtopics (all content expired/stale)
 *   4. Medium  — Thin coverage (< 3 items in a subtopic)
 *   5. Low     — Missing layer coverage
 *
 * Spec: docs/plans/content-lifecycle-spec.md §3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentSuggestion {
  id: string;
  suggestion_type: 'empty_subtopic' | 'thin_coverage' | 'stale_only' | 'template_gap' | 'missing_layer';
  priority: 'critical' | 'high' | 'medium' | 'low';
  domain: string;
  subtopic: string;
  title: string;
  description: string;
  suggested_content_type?: string;
  suggested_layer?: string;
  related_template?: string;
  item_count: number;
  freshness_breakdown?: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
}

export interface SuggestionParams {
  supabase: SupabaseClient<Database>;
  maxSuggestions?: number;
  domainFilter?: string;
  includeTemplateGaps?: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TaxonomyDomain {
  id: string;
  name: string;
  display_order: number;
}

interface TaxonomySubtopic {
  id: string;
  name: string;
  domain_id: string;
  display_order: number;
}

interface ContentItemRow {
  primary_domain: string | null;
  primary_subtopic: string | null;
  freshness: string | null;
  content_type: string | null;
}

interface SubtopicStats {
  total: number;
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
  contentTypes: Set<string>;
}

// ---------------------------------------------------------------------------
// Priority ordering for sorting
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a deterministic ID from domain + subtopic + suggestion_type.
 * Uses MD5 for consistency (not security).
 */
function createSuggestionId(domain: string, subtopic: string, type: string): string {
  const hash = createHash('md5')
    .update(`${domain}|${subtopic}|${type}`)
    .digest('hex');
  return hash.slice(0, 12);
}

/**
 * Suggest a content type based on domain and existing coverage pattern.
 */
function suggestContentType(domain: string, _subtopic: string): string {
  // Domain-based heuristics for content type suggestions
  const domainLower = domain.toLowerCase();
  if (domainLower.includes('compliance') || domainLower.includes('security')) {
    return 'policy';
  }
  if (domainLower.includes('product') || domainLower.includes('methodology')) {
    return 'guide';
  }
  if (domainLower.includes('corporate')) {
    return 'article';
  }
  return 'article';
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export async function generateContentSuggestions(
  params: SuggestionParams,
): Promise<ContentSuggestion[]> {
  const {
    supabase,
    maxSuggestions = 10,
    domainFilter,
    includeTemplateGaps = true,
  } = params;

  const suggestions: ContentSuggestion[] = [];

  // -------------------------------------------------------------------------
  // 1. Fetch taxonomy (domains + subtopics)
  // -------------------------------------------------------------------------

  const [domainsResult, subtopicsResult] = await Promise.all([
    supabase
      .from('taxonomy_domains')
      .select('id, name, display_order')
      .order('display_order'),
    supabase
      .from('taxonomy_subtopics')
      .select('id, name, domain_id, display_order')
      .order('display_order'),
  ]);

  const domains = (domainsResult.data ?? []) as TaxonomyDomain[];
  const subtopics = (subtopicsResult.data ?? []) as TaxonomySubtopic[];

  // Build domain ID to name map
  const domainMap = new Map<string, string>();
  for (const d of domains) {
    domainMap.set(d.id, d.name);
  }

  // -------------------------------------------------------------------------
  // 2. Fetch content items (domain, subtopic, freshness, content_type)
  // -------------------------------------------------------------------------

  const { data: contentItems } = await supabase
    .from('content_items')
    .select('primary_domain, primary_subtopic, freshness, content_type')
    .is('archived_at', null);

  // Build counts per domain+subtopic
  const statsMap = new Map<string, SubtopicStats>();
  for (const item of (contentItems ?? []) as ContentItemRow[]) {
    if (!item.primary_domain || !item.primary_subtopic) continue;
    const key = `${item.primary_domain}|${item.primary_subtopic}`;
    const existing = statsMap.get(key) ?? {
      total: 0,
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
      contentTypes: new Set<string>(),
    };
    existing.total++;
    if (item.freshness === 'fresh') existing.fresh++;
    else if (item.freshness === 'aging') existing.aging++;
    else if (item.freshness === 'stale') existing.stale++;
    else if (item.freshness === 'expired') existing.expired++;
    if (item.content_type) existing.contentTypes.add(item.content_type);
    statsMap.set(key, existing);
  }

  // -------------------------------------------------------------------------
  // 3. Fetch active bids (domains with active bids get priority boost)
  // -------------------------------------------------------------------------

  const { data: activeBids } = await supabase
    .from('workspaces')
    .select('id, name, domain_metadata')
    .eq('type', 'bid')
    .is('archived_at', null);

  // Extract domains mentioned in active bid metadata
  const activeBidDomains = new Set<string>();
  for (const bid of (activeBids ?? [])) {
    const meta = bid.domain_metadata as Record<string, unknown> | null;
    if (meta?.primary_domain) {
      activeBidDomains.add(meta.primary_domain as string);
    }
    // Some bids reference domains through their questions
    if (meta?.domains && Array.isArray(meta.domains)) {
      for (const d of meta.domains) {
        if (typeof d === 'string') activeBidDomains.add(d);
      }
    }
  }
  // If there are active bids, consider all domains as potentially bid-related
  const hasActiveBids = (activeBids ?? []).length > 0;

  // -------------------------------------------------------------------------
  // 4. Analyse gaps — build suggestions
  // -------------------------------------------------------------------------

  for (const st of subtopics) {
    const domainName = domainMap.get(st.domain_id);
    if (!domainName) continue;

    // Apply domain filter if specified
    if (domainFilter && domainName !== domainFilter) continue;

    const key = `${domainName}|${st.name}`;
    const stats = statsMap.get(key);

    // 4a. Empty subtopics
    if (!stats || stats.total === 0) {
      const inBidDomain = activeBidDomains.has(domainName) || hasActiveBids;
      const priority = inBidDomain ? 'critical' : 'medium';

      suggestions.push({
        id: createSuggestionId(domainName, st.name, 'empty_subtopic'),
        suggestion_type: 'empty_subtopic',
        priority,
        domain: domainName,
        subtopic: st.name,
        title: `No content for ${st.name}`,
        description: inBidDomain
          ? `${domainName} has an active bid but zero content for ${st.name}. Creating content here directly supports bid responses.`
          : `${domainName} / ${st.name} has no content items. Adding content improves coverage completeness.`,
        suggested_content_type: suggestContentType(domainName, st.name),
        item_count: 0,
      });
      continue;
    }

    // 4b. Stale-only subtopics (all items are stale or expired)
    if (stats.stale + stats.expired === stats.total && stats.total > 0) {
      suggestions.push({
        id: createSuggestionId(domainName, st.name, 'stale_only'),
        suggestion_type: 'stale_only',
        priority: 'high',
        domain: domainName,
        subtopic: st.name,
        title: `All content stale in ${st.name}`,
        description: `${domainName} / ${st.name} has ${stats.total} ${stats.total === 1 ? 'item' : 'items'}, all stale or expired. Refresh existing content or create new items.`,
        item_count: stats.total,
        freshness_breakdown: {
          fresh: stats.fresh,
          aging: stats.aging,
          stale: stats.stale,
          expired: stats.expired,
        },
      });
      continue;
    }

    // 4c. Thin coverage (< 3 items)
    if (stats.total < 3) {
      suggestions.push({
        id: createSuggestionId(domainName, st.name, 'thin_coverage'),
        suggestion_type: 'thin_coverage',
        priority: 'medium',
        domain: domainName,
        subtopic: st.name,
        title: `Thin coverage for ${st.name}`,
        description: `${domainName} / ${st.name} has only ${stats.total} ${stats.total === 1 ? 'item' : 'items'}. Adding more content improves search quality and bid response options.`,
        suggested_content_type: suggestContentType(domainName, st.name),
        item_count: stats.total,
        freshness_breakdown: {
          fresh: stats.fresh,
          aging: stats.aging,
          stale: stats.stale,
          expired: stats.expired,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Template gap analysis (if enabled)
  // -------------------------------------------------------------------------

  if (includeTemplateGaps) {
    const { data: templates } = await supabase
      .from('template_requirements')
      .select('template_name, section_name, requirement_text, primary_domain, primary_subtopic')
      .eq('is_current', true)
      .eq('coverage_status', 'gap');

    for (const req of (templates ?? [])) {
      const domain = (req.primary_domain as string) ?? 'Unknown';
      const subtopic = (req.primary_subtopic as string) ?? 'General';

      // Apply domain filter if specified
      if (domainFilter && domain !== domainFilter) continue;

      suggestions.push({
        id: createSuggestionId(domain, subtopic, `template_gap_${req.template_name}`),
        suggestion_type: 'template_gap',
        priority: 'high',
        domain,
        subtopic,
        title: `Template gap: ${req.section_name ?? req.template_name}`,
        description: `The "${req.template_name}" template has a requirement with no matching KB content: "${truncateText(req.requirement_text ?? '', 120)}"`,
        related_template: req.template_name as string,
        item_count: 0,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Sort by priority then domain
  // -------------------------------------------------------------------------

  suggestions.sort((a, b) => {
    const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    return a.domain.localeCompare(b.domain);
  });

  // -------------------------------------------------------------------------
  // 7. Deduplicate and limit
  // -------------------------------------------------------------------------

  const seen = new Set<string>();
  const deduplicated: ContentSuggestion[] = [];
  for (const s of suggestions) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    deduplicated.push(s);
    if (deduplicated.length >= maxSuggestions) break;
  }

  return deduplicated;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
