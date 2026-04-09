/**
 * Shared test fixtures for the SI prompt refinement UI components.
 *
 * Every component test file under this folder imports its fixture factories
 * from here so the fixture shapes stay in sync with the shared types. All
 * UUID values are RFC 4122 v4 compliant so strict Zod validation elsewhere
 * in the app is not broken if these values leak into server-side code
 * during integration work.
 */
import type {
  FlagAnalysisResult,
  RescoringPreviewResponse,
  RescoringPreviewResult,
  AnalyseFlagsResponse,
  ResolveFlagsResponse,
  AnalyseFlagsRequest,
  RescoringPreviewRequest,
  ResolveFlagsRequest,
} from '@/types/intelligence-refinement';
import type { WorkspaceFlag } from '@/hooks/intelligence/use-workspace-flags';
import type { UseMutationResult } from '@tanstack/react-query';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// FlagAnalysisResult
// ---------------------------------------------------------------------------

export function makeFlagAnalysisResult(
  overrides: Partial<FlagAnalysisResult> = {},
): FlagAnalysisResult {
  return {
    summary:
      'Two clusters identified: policy announcements scoring too high, and MAT finance stories scoring too low.',
    falsePositivePatterns: [
      {
        pattern: 'Generic DfE policy updates',
        articleCount: 3,
        articles: [
          'DfE updates statutory guidance',
          'Ofsted publishes new framework',
          'DfE consultation on funding',
        ],
        rootCause:
          'Prompt weights any mention of statutory guidance as highly relevant, regardless of whether the article affects procurement decisions.',
      },
    ],
    falseNegativePatterns: [
      {
        pattern: 'MAT merger and finance stories',
        articleCount: 2,
        articles: ['Large MAT acquires 12 schools', 'Trust reports deficit'],
        rootCause:
          'Prompt does not mention multi-academy trust financial movement as a key signal.',
      },
    ],
    recommendations: [
      {
        type: 'add',
        section: 'Key signals',
        currentText: null,
        proposedText:
          'Multi-academy trust financial movement (mergers, acquisitions, deficits) affects procurement cycles.',
        reasoning:
          'Captures the MAT finance cluster identified as false negatives.',
        affectedFlags: 2,
      },
      {
        type: 'remove',
        section: 'Relevance criteria',
        currentText:
          'Any mention of statutory guidance is highly relevant to the sector.',
        proposedText:
          'Statutory guidance is relevant only when it changes procurement, safeguarding, or compliance obligations.',
        reasoning:
          'Over-broad rule that caused the policy-announcement false positive cluster.',
        affectedFlags: 3,
      },
      {
        type: 'reword',
        section: 'Scoring scale',
        currentText: 'Score 0.8+ for statutory updates.',
        proposedText:
          'Score 0.8+ only when the statutory update creates a new compliance action for schools.',
        reasoning:
          'Tightens the high-end of the scoring scale to match the refined signal.',
        affectedFlags: 1,
      },
    ],
    proposedPromptText:
      'You are scoring articles for an education-sector SMB supplier.\n\nKey signals:\n- Multi-academy trust financial movement (mergers, acquisitions, deficits)\n- Procurement framework changes\n- Safeguarding compliance obligations\n\nRelevance criteria:\n- Statutory guidance is relevant only when it changes procurement, safeguarding, or compliance obligations.\n\nScoring scale:\n- Score 0.8+ only when the statutory update creates a new compliance action for schools.',
    confidenceNotes:
      'High confidence on the false positive cluster (clear over-weighting). Medium confidence on the MAT finance signal — only 2 flags observed.',
    analysedFlagCount: 5,
    truncated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RescoringPreviewResponse
// ---------------------------------------------------------------------------

export function makeRescoringPreviewResult(
  overrides: Partial<RescoringPreviewResult> = {},
): RescoringPreviewResult {
  return {
    article_id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'KCSIE update published',
    existing_score: 0.82,
    candidate_score: 0.45,
    score_delta: -0.37,
    ...overrides,
  };
}

export function makeRescoringPreviewResponse(
  overrides: Partial<RescoringPreviewResponse> = {},
): RescoringPreviewResponse {
  return {
    samples: 5,
    mean_delta: -0.02,
    improved: 1,
    regressed: 1,
    results: [
      makeRescoringPreviewResult({
        article_id: '550e8400-e29b-41d4-a716-446655440001',
        title: 'KCSIE update published',
        existing_score: 0.82,
        candidate_score: 0.45,
        score_delta: -0.37,
      }),
      makeRescoringPreviewResult({
        article_id: '550e8400-e29b-41d4-a716-446655440002',
        title: 'Large MAT merger announced',
        existing_score: 0.42,
        candidate_score: 0.71,
        score_delta: 0.29,
      }),
      makeRescoringPreviewResult({
        article_id: '550e8400-e29b-41d4-a716-446655440003',
        title: 'DfE consultation response',
        existing_score: 0.65,
        candidate_score: 0.68,
        score_delta: 0.03,
      }),
      makeRescoringPreviewResult({
        article_id: '550e8400-e29b-41d4-a716-446655440004',
        title: 'New Ofsted framework',
        existing_score: 0.55,
        candidate_score: 0.55,
        score_delta: 0,
      }),
      makeRescoringPreviewResult({
        article_id: '550e8400-e29b-41d4-a716-446655440005',
        title: 'School funding allocation',
        existing_score: 0.3,
        candidate_score: 0.32,
        score_delta: 0.02,
      }),
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WorkspaceFlag
// ---------------------------------------------------------------------------

export function makeWorkspaceFlag(
  overrides: Partial<WorkspaceFlag> = {},
): WorkspaceFlag {
  return {
    id: '550e8400-e29b-41d4-a716-446655440010',
    feed_article_id: '550e8400-e29b-41d4-a716-446655440011',
    flag_type: 'false_positive',
    flagged_by: '550e8400-e29b-41d4-a716-446655440012',
    notes: 'Not procurement-relevant.',
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    resolved_notes: null,
    resolution_type: null,
    prompt_version_id: null,
    created_at: '2026-04-01T09:00:00.000Z',
    article_title: 'DfE updates statutory guidance',
    article_external_url: 'https://example.com/article-1',
    article_relevance_score: 0.78,
    article_relevance_reasoning: 'Mentions statutory guidance.',
    article_relevance_category: 'high',
    article_passed: true,
    source_name: 'GOV.UK education',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mutation mocks — typed UseMutationResult stand-ins for prop injection
// ---------------------------------------------------------------------------

/**
 * Build a partial `UseMutationResult` stand-in that the component can
 * consume as a prop. We do not run a real `QueryClientProvider` because
 * the container uses only the mutation object's fields (no cache reads).
 */
export function mockMutation<TData, TError = Error, TVars = unknown>(
  overrides: Partial<UseMutationResult<TData, TError, TVars>> = {},
): UseMutationResult<TData, TError, TVars> {
  const base = {
    data: undefined,
    error: null,
    isError: false,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    status: 'idle' as const,
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    context: undefined,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    submittedAt: 0,
    variables: undefined,
  };
  return { ...base, ...overrides } as unknown as UseMutationResult<
    TData,
    TError,
    TVars
  >;
}

// Convenience typed aliases for the three mutations the container accepts.
export type AnalyseFlagsMutation = UseMutationResult<
  AnalyseFlagsResponse,
  Error,
  AnalyseFlagsRequest
>;
export type RescoringPreviewMutation = UseMutationResult<
  RescoringPreviewResponse,
  Error,
  RescoringPreviewRequest
>;
export type ResolveFlagsMutation = UseMutationResult<
  ResolveFlagsResponse,
  Error,
  ResolveFlagsRequest
>;
