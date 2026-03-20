/**
 * Template-driven KB completeness — coverage matching engine.
 *
 * Determines how well the KB covers a specific bid template by matching
 * each template requirement against content items using a 3-tier approach:
 *   1. Exact taxonomy match (domain + subtopic)
 *   2. Keyword overlap (requirement matching_keywords vs content ai_keywords)
 *   3. Semantic similarity (pre-computed embeddings, cosine distance)
 *
 * Spec: docs/plans/template-driven-completeness-spec.md §3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum content length (chars) per requirement type. Spec §3.1. */
export const CONTENT_LENGTH_THRESHOLDS: Record<string, number> = {
  declaration: 0,
  data: 0,
  evidence: 100,
  statement: 150,
  reference: 200,
  policy: 300,
  narrative: 500,
};

/**
 * Semantic similarity threshold for "strong" coverage.
 *
 * Calibrated from UAT sessions 77 + 83: Standard SQ (66 reqs), Charnwood ITT
 * (30 reqs), and Method Statement (10 reqs) against 186 KB items. At the
 * original 0.70 threshold, zero requirements achieved "strong" across all
 * three templates. The best real-world match (Charnwood company registration)
 * scored 0.694. Lowering to 0.55 produces a realistic distribution.
 */
export const SIMILARITY_STRONG_THRESHOLD = 0.55;

/**
 * Semantic similarity threshold for "partial" coverage.
 *
 * Calibrated alongside strong threshold. At 0.35, near-miss questions
 * (equalities 0.482, safeguarding 0.466, carbon 0.453) correctly classify
 * as partial rather than gap.
 */
export const SIMILARITY_PARTIAL_THRESHOLD = 0.35;

/** Q&A pairs with answers shorter than this are capped at partial. */
export const QA_FRAGMENT_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoverageStatus = 'strong' | 'partial' | 'gap' | 'na';

export type RequirementType =
  | 'policy'
  | 'statement'
  | 'evidence'
  | 'data'
  | 'narrative'
  | 'declaration'
  | 'reference';

/** Lightweight projection of a template_requirements row for matching. */
export interface TemplateRequirement {
  id: string;
  template_name: string;
  template_version: string | null;
  template_type: string;
  section_ref: string;
  section_name: string;
  question_number: number | null;
  requirement_text: string;
  description: string | null;
  requirement_type: RequirementType;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  matching_keywords: string[] | null;
  matching_guidance: string | null;
  requirement_embedding: number[] | null;
  is_mandatory: boolean | null;
  sector_applicability: string[] | null;
  word_limit_guidance: number | null;
  display_order: number;
}

/** Lightweight projection of a content_items row for matching. */
export interface ContentItemForMatching {
  id: string;
  content: string;
  brief: string | null;
  detail: string | null;
  title: string;
  suggested_title: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  content_type: string;
  ai_keywords: string[] | null;
  embedding: number[] | null;
}

/** Coverage result for a single requirement. */
export interface RequirementCoverage {
  requirement_id: string;
  section_ref: string;
  section_name: string;
  question_number: number | null;
  requirement_text: string;
  description: string | null;
  requirement_type: RequirementType;
  coverage_status: CoverageStatus;
  matching_content_ids: string[];
  best_similarity_score: number;
  content_length_met: boolean;
}

/** Grouped coverage for one template section. */
export interface SectionCoverage {
  section_ref: string;
  section_name: string;
  requirements: RequirementCoverage[];
}

/** Full coverage result for a template. */
export interface TemplateCoverageResult {
  template_name: string;
  template_version: string | null;
  template_type: string;
  total_requirements: number;
  strong_count: number;
  partial_count: number;
  gap_count: number;
  na_count: number;
  score: number;
  sections: SectionCoverage[];
}

/** Summary row returned by listAvailableTemplates. */
export interface TemplateSummary {
  template_name: string;
  template_version: string | null;
  template_type: string;
  requirement_count: number;
  is_current: boolean;
}

// ---------------------------------------------------------------------------
// Cosine similarity (in-memory, for pre-computed embedding vectors)
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector is null/empty.
 */
export function cosineSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ---------------------------------------------------------------------------
// Single-requirement matching
// ---------------------------------------------------------------------------

/**
 * Determine coverage status for a single requirement against a set of
 * content items. Uses the 3-tier matching approach from spec §3.1.
 *
 * @param requirement  The template requirement to match
 * @param contentItems All content items (pre-filtered to exclude archived)
 * @param strongThreshold  Override for similarity strong threshold (default 0.7)
 * @param partialThreshold Override for similarity partial threshold (default 0.5)
 */
export function matchRequirement(
  requirement: TemplateRequirement,
  contentItems: ContentItemForMatching[],
  strongThreshold: number = SIMILARITY_STRONG_THRESHOLD,
  partialThreshold: number = SIMILARITY_PARTIAL_THRESHOLD,
): RequirementCoverage {
  const result: RequirementCoverage = {
    requirement_id: requirement.id,
    section_ref: requirement.section_ref,
    section_name: requirement.section_name,
    question_number: requirement.question_number,
    requirement_text: requirement.requirement_text,
    description: requirement.description,
    requirement_type: requirement.requirement_type,
    coverage_status: 'gap',
    matching_content_ids: [],
    best_similarity_score: 0,
    content_length_met: false,
  };

  // N/A: declarations are always satisfied (yes/no answers, no KB content needed)
  if (requirement.requirement_type === 'declaration') {
    result.coverage_status = 'na';
    return result;
  }

  const contentLengthThreshold =
    CONTENT_LENGTH_THRESHOLDS[requirement.requirement_type] ?? 200;

  // Score each content item against this requirement
  interface ScoredMatch {
    id: string;
    taxonomyMatch: boolean;
    keywordOverlap: number;
    similarity: number;
    contentLength: number;
    isQAFragment: boolean;
  }

  const matches: ScoredMatch[] = [];

  for (const item of contentItems) {
    // --- Tier 1: Taxonomy match ---
    const taxonomyMatch =
      requirement.primary_domain !== null &&
      requirement.primary_subtopic !== null &&
      item.primary_domain !== null &&
      item.primary_subtopic !== null &&
      item.primary_domain.toLowerCase() === requirement.primary_domain.toLowerCase() &&
      item.primary_subtopic.toLowerCase() === requirement.primary_subtopic.toLowerCase();

    // --- Tier 2: Keyword overlap ---
    let keywordOverlap = 0;
    if (requirement.matching_keywords && requirement.matching_keywords.length > 0 && item.ai_keywords) {
      const reqKeywords = new Set(requirement.matching_keywords.map(k => k.toLowerCase()));
      for (const kw of item.ai_keywords) {
        if (reqKeywords.has(kw.toLowerCase())) {
          keywordOverlap++;
        }
      }
    }

    // --- Tier 3: Semantic similarity ---
    const similarity = cosineSimilarity(requirement.requirement_embedding, item.embedding);

    // Skip items with no signal at all
    if (!taxonomyMatch && keywordOverlap === 0 && similarity < partialThreshold) {
      continue;
    }

    // Content length — for Q&A pairs, use the full content (question + answer)
    const contentLength = (item.content ?? '').length;

    // Q&A fragment check: if content_type is q_a_pair and content is very short
    const isQAFragment = item.content_type === 'q_a_pair' && contentLength < QA_FRAGMENT_THRESHOLD;

    matches.push({
      id: item.id,
      taxonomyMatch,
      keywordOverlap,
      similarity,
      contentLength,
      isQAFragment,
    });
  }

  if (matches.length === 0) {
    result.coverage_status = 'gap';
    return result;
  }

  // Sort by composite score: taxonomy match first, then similarity, then keyword overlap
  matches.sort((a, b) => {
    const aScore = (a.taxonomyMatch ? 1000 : 0) + a.similarity * 100 + a.keywordOverlap * 10;
    const bScore = (b.taxonomyMatch ? 1000 : 0) + b.similarity * 100 + b.keywordOverlap * 10;
    return bScore - aScore;
  });

  const best = matches[0];
  result.best_similarity_score = best.similarity;
  result.matching_content_ids = matches.slice(0, 5).map(m => m.id);
  result.content_length_met = best.contentLength >= contentLengthThreshold;

  // Determine coverage status
  const hasStrongSemantic = best.similarity > strongThreshold;
  const hasPartialSemantic = best.similarity > partialThreshold;

  if (best.isQAFragment) {
    // Q&A fragments are capped at partial regardless of other signals
    result.coverage_status = 'partial';
  } else if (best.taxonomyMatch && hasStrongSemantic && result.content_length_met) {
    result.coverage_status = 'strong';
  } else if (hasStrongSemantic && result.content_length_met) {
    // Strong semantic match alone can give strong coverage (spec: "semantic > 0.7")
    result.coverage_status = 'strong';
  } else if (best.taxonomyMatch || hasPartialSemantic || best.keywordOverlap > 0) {
    result.coverage_status = 'partial';
  } else {
    result.coverage_status = 'gap';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Full-template coverage
// ---------------------------------------------------------------------------

/**
 * Compute coverage for an entire template by matching every requirement
 * against the KB content items. Groups results by section.
 *
 * @param templateName    Template identity for the result
 * @param templateVersion Template version for the result
 * @param templateType    Template type for the result
 * @param requirements    All requirements for the template
 * @param contentItems    All content items (pre-filtered to exclude archived)
 * @param strongThreshold Override for similarity strong threshold
 * @param partialThreshold Override for similarity partial threshold
 */
export function computeTemplateCoverage(
  templateName: string,
  templateVersion: string | null,
  templateType: string,
  requirements: TemplateRequirement[],
  contentItems: ContentItemForMatching[],
  strongThreshold: number = SIMILARITY_STRONG_THRESHOLD,
  partialThreshold: number = SIMILARITY_PARTIAL_THRESHOLD,
): TemplateCoverageResult {
  // Match each requirement
  const allCoverage = requirements.map(req =>
    matchRequirement(req, contentItems, strongThreshold, partialThreshold),
  );

  // Group by section
  const sectionMap = new Map<string, RequirementCoverage[]>();
  const sectionNameMap = new Map<string, string>();

  for (const cov of allCoverage) {
    if (!sectionMap.has(cov.section_ref)) {
      sectionMap.set(cov.section_ref, []);
      sectionNameMap.set(cov.section_ref, cov.section_name);
    }
    sectionMap.get(cov.section_ref)!.push(cov);
  }

  // Preserve display_order by using the requirements array ordering
  const sectionOrder: string[] = [];
  for (const req of requirements) {
    if (!sectionOrder.includes(req.section_ref)) {
      sectionOrder.push(req.section_ref);
    }
  }

  const sections: SectionCoverage[] = sectionOrder.map(ref => ({
    section_ref: ref,
    section_name: sectionNameMap.get(ref) ?? ref,
    requirements: sectionMap.get(ref) ?? [],
  }));

  // Compute counts
  let strongCount = 0;
  let partialCount = 0;
  let gapCount = 0;
  let naCount = 0;

  for (const cov of allCoverage) {
    switch (cov.coverage_status) {
      case 'strong': strongCount++; break;
      case 'partial': partialCount++; break;
      case 'gap': gapCount++; break;
      case 'na': naCount++; break;
    }
  }

  // Score: spec §3.2
  const denominator = allCoverage.length - naCount;
  const score = denominator > 0
    ? (strongCount * 1.0 + partialCount * 0.5) / denominator
    : 0;

  return {
    template_name: templateName,
    template_version: templateVersion,
    template_type: templateType,
    total_requirements: allCoverage.length,
    strong_count: strongCount,
    partial_count: partialCount,
    gap_count: gapCount,
    na_count: naCount,
    score: Math.round(score * 1000) / 1000, // 3 decimal places
    sections,
  };
}

// ---------------------------------------------------------------------------
// Data fetching (Supabase)
// ---------------------------------------------------------------------------

type SupabaseClientTyped = SupabaseClient<Database>;

/**
 * Fetch template requirements for a given template.
 * Defaults to `is_current = true` unless a specific version is provided.
 */
export async function fetchTemplateRequirements(
  supabase: SupabaseClientTyped,
  templateName: string,
  templateVersion?: string,
): Promise<TemplateRequirement[]> {
  let query = supabase
    .from('template_requirements')
    .select('id, template_name, template_version, template_type, section_ref, section_name, question_number, requirement_text, description, requirement_type, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, matching_keywords, matching_guidance, requirement_embedding, is_mandatory, sector_applicability, word_limit_guidance, display_order')
    .eq('template_name', templateName)
    .order('display_order');

  if (templateVersion) {
    query = query.eq('template_version', templateVersion);
  } else {
    query = query.eq('is_current', true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch template requirements: ${error.message}`);
  }

  // Parse embedding strings back to number arrays
  return (data ?? []).map(row => ({
    id: row.id,
    template_name: row.template_name,
    template_version: row.template_version,
    template_type: row.template_type,
    section_ref: row.section_ref,
    section_name: row.section_name,
    question_number: row.question_number,
    requirement_text: row.requirement_text,
    description: row.description,
    requirement_type: row.requirement_type as RequirementType,
    primary_domain: row.primary_domain,
    primary_subtopic: row.primary_subtopic,
    secondary_domain: row.secondary_domain,
    secondary_subtopic: row.secondary_subtopic,
    matching_keywords: row.matching_keywords,
    matching_guidance: row.matching_guidance,
    requirement_embedding: row.requirement_embedding
      ? (typeof row.requirement_embedding === 'string'
          ? JSON.parse(row.requirement_embedding)
          : row.requirement_embedding)
      : null,
    is_mandatory: row.is_mandatory,
    sector_applicability: row.sector_applicability,
    word_limit_guidance: row.word_limit_guidance,
    display_order: row.display_order,
  }));
}

/**
 * Fetch content items with the fields needed for coverage matching.
 * Excludes archived items (archived_at IS NULL).
 */
export async function fetchContentForMatching(
  supabase: SupabaseClientTyped,
): Promise<ContentItemForMatching[]> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id, content, brief, detail, title, suggested_title, primary_domain, primary_subtopic, content_type, ai_keywords, embedding')
    .is('archived_at', null);

  if (error) {
    throw new Error(`Failed to fetch content items: ${error.message}`);
  }

  return (data ?? []).map(row => ({
    id: row.id,
    content: row.content,
    brief: row.brief,
    detail: row.detail,
    title: row.title,
    suggested_title: row.suggested_title,
    primary_domain: row.primary_domain,
    primary_subtopic: row.primary_subtopic,
    content_type: row.content_type,
    ai_keywords: row.ai_keywords,
    embedding: row.embedding
      ? (typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : row.embedding)
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Gap summary (cross-template aggregation)
// ---------------------------------------------------------------------------

/** A single gap item in the summary. */
export interface GapDetail {
  template_name: string;
  section_ref: string;
  section_name: string;
  requirement_text: string;
  requirement_type: RequirementType;
}

/** Aggregated gap summary across all templates. */
export interface GapSummary {
  total_gaps: number;
  total_partial: number;
  templates_assessed: number;
  gaps_by_type: Record<string, number>;
  partial_by_type: Record<string, number>;
  gaps_by_template: { template_name: string; gap_count: number; partial_count: number; total: number }[];
  top_gaps: GapDetail[];
}

/**
 * Aggregate gap information across multiple template coverage results.
 * Returns a summary suitable for a dashboard "action required" view.
 *
 * @param results  Coverage results for each template
 * @param maxTopGaps  Maximum number of individual gap details to return (default 10)
 */
export function computeGapSummary(
  results: TemplateCoverageResult[],
  maxTopGaps = 10,
): GapSummary {
  const gapsByType: Record<string, number> = {};
  const partialByType: Record<string, number> = {};
  const topGaps: GapDetail[] = [];
  let totalGaps = 0;
  let totalPartial = 0;

  const gapsByTemplate: GapSummary['gaps_by_template'] = [];

  for (const result of results) {
    gapsByTemplate.push({
      template_name: result.template_name,
      gap_count: result.gap_count,
      partial_count: result.partial_count,
      total: result.total_requirements,
    });

    for (const section of result.sections) {
      for (const req of section.requirements) {
        if (req.coverage_status === 'gap') {
          totalGaps++;
          gapsByType[req.requirement_type] = (gapsByType[req.requirement_type] ?? 0) + 1;

          if (topGaps.length < maxTopGaps) {
            topGaps.push({
              template_name: result.template_name,
              section_ref: req.section_ref,
              section_name: req.section_name,
              requirement_text: req.requirement_text,
              requirement_type: req.requirement_type,
            });
          }
        } else if (req.coverage_status === 'partial') {
          totalPartial++;
          partialByType[req.requirement_type] = (partialByType[req.requirement_type] ?? 0) + 1;
        }
      }
    }
  }

  // Sort templates by gap count descending
  gapsByTemplate.sort((a, b) => b.gap_count - a.gap_count);

  return {
    total_gaps: totalGaps,
    total_partial: totalPartial,
    templates_assessed: results.length,
    gaps_by_type: gapsByType,
    partial_by_type: partialByType,
    gaps_by_template: gapsByTemplate,
    top_gaps: topGaps,
  };
}

/**
 * List available templates with requirement counts.
 * Defaults to current versions only.
 */
export async function listAvailableTemplates(
  supabase: SupabaseClientTyped,
  templateType?: string,
): Promise<TemplateSummary[]> {
  let query = supabase
    .from('template_requirements')
    .select('template_name, template_version, template_type, is_current')
    .eq('is_current', true);

  if (templateType) {
    query = query.eq('template_type', templateType);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch templates: ${error.message}`);
  }

  // Group by template_name + template_version to get counts
  const templateMap = new Map<string, TemplateSummary & { count: number }>();

  for (const row of (data ?? [])) {
    const key = `${row.template_name}||${row.template_version ?? ''}`;
    const existing = templateMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      templateMap.set(key, {
        template_name: row.template_name,
        template_version: row.template_version,
        template_type: row.template_type,
        requirement_count: 0,
        is_current: row.is_current ?? true,
        count: 1,
      });
    }
  }

  return Array.from(templateMap.values()).map(t => ({
    template_name: t.template_name,
    template_version: t.template_version,
    template_type: t.template_type,
    requirement_count: t.count,
    is_current: t.is_current,
  }));
}
