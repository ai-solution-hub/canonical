/**
 * GET /api/coverage/gaps
 *
 * Unified gap endpoint that aggregates gaps from three sources:
 * - Taxonomy (empty subtopics from coverage matrix)
 * - Template (unmet requirements across all current templates)
 * - Guide (empty or stale required sections)
 *
 * Returns a scored, sorted, filterable list with 60-second in-memory cache.
 *
 * Spec: .planning/specs/gaps-view-consolidation-spec.md §6
 */

import { defineRoute } from "@/lib/api/define-route";
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { scoreGap } from '@/lib/coverage/gap-scoring';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import {
    computeTemplateCoverage,
    fetchContentForMatching,
    fetchTemplateRequirements,
    listAvailableTemplates,
} from '@/lib/domains/procurement/form-templating/template-coverage';
import { parseSearchParams } from '@/lib/validation';
import { CoverageGapsParamsSchema } from '@/lib/validation/schemas';
import type {
    GuideGap,
    PriorityTier,
    TaxonomyGap,
    TemplateGap,
    UnifiedGap,
    UnifiedGapSummary,
} from '@/types/unified-gap';
import { NextRequest, NextResponse } from 'next/server';
import { z } from "zod";

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// In-memory cache (60-second TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: UnifiedGapSummary;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/** Clear the in-memory cache. Exported for testing only. */
export function _clearCache() {
  cache.clear();
}

function getCacheKey(params: URLSearchParams): string {
  // Sorted to ensure consistent keys regardless of param order
  const sorted = new URLSearchParams([...params.entries()].sort());
  return sorted.toString();
}

// ---------------------------------------------------------------------------
// Types for RPC responses
// ---------------------------------------------------------------------------

interface CoverageMatrixRow {
  domain_name: string;
  subtopic_name: string;
  item_count: number;
}

interface GuideSectionRow {
  guide_id: string;
  guide_name: string;
  guide_slug: string;
  section_id: string;
  section_name: string;
  is_required: boolean;
  content_count: number;
  fresh_count: number;
  stale_count: number;
}

interface CoverageTargetRow {
  id: string;
  domain_id: string;
  metric_name: string;
  target_value: number;
  taxonomy_domains: { name: string } | null;
}

// ---------------------------------------------------------------------------
// Gap builders
// ---------------------------------------------------------------------------

function buildTaxonomyGaps(
  matrixRows: CoverageMatrixRow[],
  targets: CoverageTargetRow[],
): UnifiedGap[] {
  // Identify empty subtopics
  const emptySubtopics = matrixRows.filter((r) => r.item_count === 0);

  // Build a set of domains that have at least one non-zero subtopic
  const domainsWithContent = new Set<string>();
  for (const row of matrixRows) {
    if (row.item_count > 0) {
      domainsWithContent.add(row.domain_name);
    }
  }

  // Build a set of domain names that have active coverage targets
  const domainsWithTargets = new Set<string>();
  for (const target of targets) {
    const domainName = target.taxonomy_domains?.name;
    if (domainName) {
      domainsWithTargets.add(domainName);
    }
  }

  return emptySubtopics.map((row) => {
    const domainHasZeroItems = !domainsWithContent.has(row.domain_name);
    const targetUnmet = domainsWithTargets.has(row.domain_name);

    const gap: TaxonomyGap = {
      source: 'taxonomy',
      gap_key: `taxonomy:${row.domain_name}:${row.subtopic_name}`,
      title: `${row.subtopic_name} (${row.domain_name})`,
      description: `No content items in the ${row.subtopic_name} subtopic`,
      priority_score: 0,
      priority_tier: 'low',
      domain: row.domain_name,
      subtopic: row.subtopic_name,
      action_href: `/browse?domain=${encodeURIComponent(row.domain_name)}&subtopic=${encodeURIComponent(row.subtopic_name)}`,
      action_label: 'Add content',
      domain_name: row.domain_name,
      subtopic_name: row.subtopic_name,
      target_unmet: targetUnmet,
    };

    return scoreGap(gap, { domain_has_zero_items: domainHasZeroItems });
  });
}

function buildTemplateGaps(
  coverageResults: {
    template_name: string;
    template_type: string;
    sections: {
      section_ref: string;
      section_name: string;
      requirements: {
        requirement_id: string;
        requirement_text: string;
        requirement_type: string;
        coverage_status: string;
        description: string | null;
      }[];
    }[];
  }[],
  requirementsMap: Map<string, { is_mandatory: boolean | null }>,
): UnifiedGap[] {
  const gaps: UnifiedGap[] = [];

  for (const result of coverageResults) {
    for (const section of result.sections) {
      for (const req of section.requirements) {
        if (req.coverage_status !== 'gap') continue;

        const reqData = requirementsMap.get(req.requirement_id);
        const isMandatory = reqData?.is_mandatory ?? null;

        const gap: TemplateGap = {
          source: 'template',
          gap_key: `template:${result.template_name}:${section.section_ref}:${req.requirement_id}`,
          title: `${req.requirement_text}`,
          description: req.description,
          priority_score: 0,
          priority_tier: 'low',
          domain: null,
          subtopic: null,
          action_href: `/coverage?tab=templates&template=${encodeURIComponent(result.template_name)}&section=${encodeURIComponent(section.section_ref)}`,
          action_label: 'View requirement',
          template_name: result.template_name,
          template_type: result.template_type,
          section_ref: section.section_ref,
          section_name: section.section_name,
          requirement_text: req.requirement_text,
          requirement_type: req.requirement_type as TemplateGap['requirement_type'],
          is_mandatory: isMandatory,
        };

        gaps.push(scoreGap(gap));
      }
    }
  }

  return gaps;
}

function buildGuideGaps(rows: GuideSectionRow[]): UnifiedGap[] {
  const gaps: UnifiedGap[] = [];

  for (const row of rows) {
    // Only include sections that are empty or fully stale
    const isEmpty = row.content_count === 0;
    const isStale =
      !isEmpty && row.stale_count > 0 && row.fresh_count === 0;

    if (!isEmpty && !isStale) continue;

    const gap: GuideGap = {
      source: 'guide',
      gap_key: `guide:${row.guide_id}:${row.section_id}`,
      title: `${row.section_name} (${row.guide_name})`,
      description: isEmpty
        ? `No content in the "${row.section_name}" section`
        : `All content in "${row.section_name}" is stale`,
      priority_score: 0,
      priority_tier: 'low',
      domain: null,
      subtopic: null,
      action_href: `/guide/${row.guide_slug}`,
      action_label: 'Open guide',
      guide_id: row.guide_id,
      guide_name: row.guide_name,
      guide_slug: row.guide_slug,
      section_id: row.section_id,
      section_name: row.section_name,
      is_required: row.is_required,
      section_status: isEmpty ? 'empty' : 'stale',
    };

    gaps.push(scoreGap(gap));
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(
  allGaps: UnifiedGap[],
  source?: string,
  priority?: string,
  domain?: string,
  limit = 25,
  offset = 0,
): UnifiedGapSummary {
  // De-duplicate by gap_key. Three sources contribute to allGaps and any of
  // them can structurally produce duplicate keys (e.g. listAvailableTemplates
  // returning two `is_current` versions of the same template_name; or an RPC
  // GROUP BY regression). Without this pass the React render site emits an
  // "Encountered two children with the same key" warning. First-write-wins
  // preserves the earliest scored gap, which is fine because identical keys
  // necessarily carry identical scoring inputs.
  // Regression: kh-prod-readiness-S23 W1 / S22 CI smoke (UUID 21c0a9e8-...).
  const dedupedMap = new Map<string, UnifiedGap>();
  for (const gap of allGaps) {
    if (!dedupedMap.has(gap.gap_key)) {
      dedupedMap.set(gap.gap_key, gap);
    }
  }
  const deduped = Array.from(dedupedMap.values());

  // Count totals BEFORE filtering (for summary stats)
  const totalTaxonomy = deduped.filter((g) => g.source === 'taxonomy').length;
  const totalTemplate = deduped.filter((g) => g.source === 'template').length;
  const totalGuide = deduped.filter((g) => g.source === 'guide').length;

  const tierCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const gap of deduped) {
    tierCounts[gap.priority_tier]++;
  }

  // Apply filters
  let filtered = deduped;

  if (source) {
    filtered = filtered.filter((g) => g.source === source);
  }
  if (priority) {
    filtered = filtered.filter(
      (g) => g.priority_tier === (priority as PriorityTier),
    );
  }
  if (domain) {
    filtered = filtered.filter(
      (g) => g.domain?.toLowerCase() === domain.toLowerCase(),
    );
  }

  // Sort by priority score descending
  filtered.sort((a, b) => b.priority_score - a.priority_score);

  // Paginate
  const paginated = filtered.slice(offset, offset + limit);

  return {
    total_gaps: deduped.length,
    taxonomy_gaps: totalTaxonomy,
    template_gaps: totalTemplate,
    guide_gaps: totalGuide,
    critical: tierCounts.critical,
    high: tierCounts.high,
    medium: tierCounts.medium,
    low: tierCounts.low,
    gaps: paginated,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const GapBaseShape = {
  gap_key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority_score: z.number(),
  priority_tier: z.enum(['critical', 'high', 'medium', 'low']),
  domain: z.string().nullable(),
  subtopic: z.string().nullable(),
  action_href: z.string(),
  action_label: z.string(),
};

const TaxonomyGapSchema = z.object({
  ...GapBaseShape,
  source: z.literal('taxonomy'),
  domain_name: z.string(),
  subtopic_name: z.string(),
  target_unmet: z.boolean(),
});

const TemplateGapSchema = z.object({
  ...GapBaseShape,
  source: z.literal('template'),
  template_name: z.string(),
  template_type: z.string(),
  section_ref: z.string(),
  section_name: z.string(),
  requirement_text: z.string(),
  requirement_type: z.enum([
    'policy',
    'statement',
    'evidence',
    'data',
    'narrative',
    'declaration',
    'reference',
  ]),
  is_mandatory: z.boolean().nullable(),
});

const GuideGapSchema = z.object({
  ...GapBaseShape,
  source: z.literal('guide'),
  guide_id: z.string(),
  guide_name: z.string(),
  guide_slug: z.string(),
  section_id: z.string(),
  section_name: z.string(),
  is_required: z.boolean(),
  section_status: z.enum(['empty', 'stale']),
});

const UnifiedGapSummaryResponseSchema = z.object({
  total_gaps: z.number(),
  taxonomy_gaps: z.number(),
  template_gaps: z.number(),
  guide_gaps: z.number(),
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  gaps: z.array(
    z.union([TaxonomyGapSchema, TemplateGapSchema, GuideGapSchema]),
  ),
});

export const GET = defineRoute(UnifiedGapSummaryResponseSchema, async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);

    const { supabase } = auth;

    // Parse and validate query parameters
    const parsed = parseSearchParams(CoverageGapsParamsSchema, request.nextUrl.searchParams);
    if (!parsed.success) return parsed.response;
    const { source, priority, domain, limit, offset } = parsed.data;

    // Check cache
    const cacheKey = getCacheKey(request.nextUrl.searchParams);
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data);
    }

    // Fetch all gap data in parallel
    const [matrixResult, targetsResult, guideResult, templates] = await Promise.all([
      supabase.rpc('get_coverage_matrix', { p_layer: undefined }),
      supabase
        .from('coverage_targets')
        .select('id, domain_id, metric_name, target_value, taxonomy_domains(name)'),
      supabase.rpc('get_guide_coverage'),
      listAvailableTemplates(supabase),
    ]);

    if (matrixResult.error) {
      logger.error({ err: matrixResult.error }, 'Coverage matrix RPC error');
      return NextResponse.json(
        { error: 'Failed to load taxonomy coverage data' },
        { status: 500 },
      );
    }

    if (targetsResult.error) {
      logger.error({ err: targetsResult.error }, 'Coverage targets query error');
      return NextResponse.json(
        { error: 'Failed to load coverage targets' },
        { status: 500 },
      );
    }

    if (guideResult.error) {
      logger.error({ err: guideResult.error }, 'Guide coverage RPC error');
      return NextResponse.json(
        { error: 'Failed to load guide coverage data' },
        { status: 500 },
      );
    }

    // Build taxonomy gaps
    const taxonomyGaps = buildTaxonomyGaps(
      (matrixResult.data ?? []) as unknown as CoverageMatrixRow[],
      (targetsResult.data ?? []) as unknown as CoverageTargetRow[],
    );

    // Build template gaps (requires computing coverage for each template)
    let templateGaps: UnifiedGap[] = [];
    if (templates.length > 0) {
      const contentItems = await fetchContentForMatching(supabase);

      // Build a requirements map for is_mandatory lookup
      const requirementsMap = new Map<string, { is_mandatory: boolean | null }>();

      const coverageResults = await Promise.all(
        templates.map(async (t) => {
          const requirements = await fetchTemplateRequirements(
            supabase,
            t.template_name,
          );

          // Store requirement metadata for gap building
          for (const req of requirements) {
            requirementsMap.set(req.id, {
              is_mandatory: req.is_mandatory,
            });
          }

          return computeTemplateCoverage(
            t.template_name,
            t.template_version,
            t.template_type,
            requirements,
            contentItems,
          );
        }),
      );

      templateGaps = buildTemplateGaps(coverageResults, requirementsMap);
    }

    // Build guide gaps
    const guideGaps = buildGuideGaps(
      (guideResult.data ?? []) as unknown as GuideSectionRow[],
    );

    // Merge all gaps
    const allGaps: UnifiedGap[] = [...taxonomyGaps, ...templateGaps, ...guideGaps];

    // Build response with filters and pagination
    const summary = buildSummary(allGaps, source, priority, domain, limit, offset);

    // Cache the result
    cache.set(cacheKey, {
      data: summary,
      expires: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to compute unified gaps') },
      { status: 500 },
    );
  }
});
