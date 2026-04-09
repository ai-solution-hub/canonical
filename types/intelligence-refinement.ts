// types/intelligence-refinement.ts
//
// Shared request/response types for the SI Prompt Refinement flow
// (S158 WP1). Imported by both the mutation hooks (hooks/intelligence/)
// and the refinement UI components (components/intelligence/prompt-refinement/)
// so that neither side has to redefine the wire shapes.
//
// Wire contracts are pinned here to the three Phase 2 backend routes
// shipped in S157 WP5a/b/c:
//   - POST /api/intelligence/workspaces/:id/flags/analyse
//   - POST /api/intelligence/workspaces/:id/prompts/preview
//   - POST /api/intelligence/workspaces/:id/flags/resolve
//
// The authoritative route handlers live at:
//   - app/api/intelligence/workspaces/[id]/flags/analyse/route.ts
//   - app/api/intelligence/workspaces/[id]/prompts/preview/route.ts
//   - app/api/intelligence/workspaces/[id]/flags/resolve/route.ts

import type { FlagAnalysisResult } from '@/lib/intelligence/flag-analyser';

// Re-export so consumers only need to import from this file.
export type { FlagAnalysisResult } from '@/lib/intelligence/flag-analyser';

// ─────────────────────────────────────────────────────────────────────────────
// Analyse flags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request body for `POST /api/intelligence/workspaces/:id/flags/analyse`.
 *
 * Accepts EITHER an explicit list of flag IDs OR a filter predicate.
 * Exactly one must be supplied — both missing and both present are 400s
 * at the route. The Zod schema at the route enforces this as a union.
 */
export type AnalyseFlagsRequest =
  | { flag_ids: string[]; filter?: undefined }
  | {
      flag_ids?: undefined;
      filter: {
        resolved?: boolean;
        flag_type?: 'false_positive' | 'false_negative';
      };
    };

/**
 * Response body for the analyse endpoint.
 *
 * Mirrors `FlagAnalysisResult` from `lib/intelligence/flag-analyser.ts`.
 * Not wrapped in a `warningsEnvelope` — the analyser either returns a
 * full result or the route surfaces a scrubbed 500.
 */
export type AnalyseFlagsResponse = FlagAnalysisResult;

// ─────────────────────────────────────────────────────────────────────────────
// Rescoring preview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request body for `POST /api/intelligence/workspaces/:id/prompts/preview`.
 *
 * `sample_size` defaults to 10 server-side, capped at 20 (anti-runaway).
 * `include_scored` defaults to false — set true if the caller wants the
 * existing relevance reasoning returned alongside the candidate score so
 * the diff UI can show both.
 */
export interface RescoringPreviewRequest {
  prompt_text: string;
  sample_size?: number;
  include_scored?: boolean;
}

/** A single article's before/after score result from the preview endpoint. */
export interface RescoringPreviewResult {
  article_id: string;
  title: string;
  existing_score: number | null;
  candidate_score: number;
  /** Signed delta — positive = candidate scored higher, negative = lower. */
  score_delta: number;
  /** Only present when the request sets `include_scored: true`. */
  existing_reasoning?: string | null;
  candidate_reasoning?: string;
}

/**
 * Response body for the preview endpoint.
 *
 * Uses the sibling-warnings envelope shape from `@/lib/supabase/warnings`:
 * the `warnings` field is omitted when empty. Partial-success semantics —
 * individual article scoring failures populate `warnings` without failing
 * the whole request.
 */
export interface RescoringPreviewResponse {
  samples: number;
  mean_delta: number;
  improved: number;
  regressed: number;
  results: RescoringPreviewResult[];
  warnings?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve flags
// ─────────────────────────────────────────────────────────────────────────────

/** Resolution type enum — matches the DB `feed_flags.resolution_type` CHECK. */
export type FlagResolutionType = 'addressed' | 'dismissed';

/**
 * Request body for `POST /api/intelligence/workspaces/:id/flags/resolve`.
 *
 * `prompt_version_id` is REQUIRED when `resolution_type = 'addressed'`
 * (the route's Zod `.refine()` enforces this). When `dismissed`, it
 * may be null / omitted. `resolved_notes` is optional (max 1000 chars
 * at the route).
 */
export interface ResolveFlagsRequest {
  flag_ids: string[];
  resolution_type: FlagResolutionType;
  prompt_version_id?: string | null;
  resolved_notes?: string;
}

/**
 * Response body for the resolve endpoint.
 *
 * Uses the sibling-warnings envelope. `resolved_count` may be less than
 * `requested_count` when some flags were already-resolved or not found —
 * those are surfaced in `warnings` rather than failing the whole request.
 */
export interface ResolveFlagsResponse {
  resolved_count: number;
  requested_count: number;
  warnings?: readonly string[];
}
