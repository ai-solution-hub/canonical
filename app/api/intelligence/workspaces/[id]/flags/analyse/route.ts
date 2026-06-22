// app/api/intelligence/workspaces/[id]/flags/analyse/route.ts
//
// POST /api/intelligence/workspaces/:id/flags/analyse
//
// Wraps `analyseFeedFlags()` from `lib/intelligence/flag-analyser.ts` (S155
// WP3) and returns a `FlagAnalysisResult`. Called by the SI prompt
// refinement skill (spec: docs/specs/si-prompt-refinement-skill-spec.md §4
// Task 3).
//
// The caller supplies either an explicit list of flag IDs or a filter
// describing which flags to load. Article + source context is joined at the
// database level; the active scoring prompt and the workspace's linked
// company profile are loaded server-side. No pipeline data is trusted from
// the client.
//
// Errors from the analyser (Claude API failure, JSON parse failure, Zod
// schema failure) are logged via `logBestEffortWarn` and surfaced to the
// client as a generic 500 so raw model output / stack traces never leak.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { sb } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { parseBody } from '@/lib/validation';
import {
  analyseFeedFlags,
  type FlagAnalysisFlag,
} from '@/lib/intelligence/flag-analyser';
import type { CompanyContext } from '@/lib/intelligence/types';
import {
  INTELLIGENCE_WORKSPACE_SELECT,
  extractContextFromSatellite,
  type IntelligenceWorkspaceSatelliteRow,
} from '@/lib/intelligence/workspace-context';
import type { Database } from '@/supabase/types/database.types';

export const runtime = 'nodejs';

type DbClient = SupabaseClient<Database>;
type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────────────────────────
// Request schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accept EITHER an explicit `flag_ids` list OR a `filter` describing which
 * flags to load. Exactly one of the two must be supplied — both missing is a
 * 400, both present is also a 400 (ambiguous contract).
 */
const FlagIdsBodySchema = z.object({
  flag_ids: z.array(z.string().uuid()).min(1),
  filter: z.undefined().optional(),
});

const FilterBodySchema = z.object({
  flag_ids: z.undefined().optional(),
  filter: z.object({
    resolved: z.boolean().optional(),
    flag_type: z.enum(['false_positive', 'false_negative']).optional(),
  }),
});

const AnalyseRequestSchema = z.union([FlagIdsBodySchema, FilterBodySchema]);

type AnalyseRequest = z.infer<typeof AnalyseRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generic error envelope — never leak analyser internals to the client.
// ─────────────────────────────────────────────────────────────────────────────

function errorEnvelope(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

// ─────────────────────────────────────────────────────────────────────────────
// Context loaders
// ─────────────────────────────────────────────────────────────────────────────

interface AccessibleWorkspace {
  id: string;
  intelligence_workspaces:
    | IntelligenceWorkspaceSatelliteRow
    | IntelligenceWorkspaceSatelliteRow[]
    | null;
}

/**
 * Confirm the caller has access to this intelligence workspace. One Supabase
 * project per client (see CLAUDE.md §Supabase) — "access" collapses to "the
 * workspace exists, is an intelligence workspace, and is not archived".
 * Returns the workspace row + satellite projection on success, `null` on forbidden.
 */
async function loadAccessibleWorkspace(
  supabase: DbClient,
  workspaceId: string,
): Promise<AccessibleWorkspace | null> {
  const { data, error } = await supabase
    .from('workspaces')
    .select(INTELLIGENCE_WORKSPACE_SELECT)
    .eq('id', workspaceId)
    .eq('application_types.key', 'intelligence')
    .eq('is_archived', false)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) return null;
  return {
    id: data.id,
    intelligence_workspaces:
      data.intelligence_workspaces as AccessibleWorkspace['intelligence_workspaces'],
  };
}

/** Load the currently-active scoring prompt text for a workspace. */
async function loadActivePromptText(
  supabase: DbClient,
  workspaceId: string,
): Promise<string | null> {
  const row = await sb(
    supabase
      .from('feed_prompts')
      .select('prompt_text')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .maybeSingle(),
    'intelligence.flags.analyse.activePrompt',
  );
  return row?.prompt_text ?? null;
}

/** Load the company profile linked to the workspace (post-T2: typed satellite). */
async function loadCompanyContext(
  supabase: DbClient,
  workspace: AccessibleWorkspace,
): Promise<CompanyContext | null> {
  const context = extractContextFromSatellite(
    workspace.intelligence_workspaces,
  );
  const profileId = context.companyProfileId;
  if (!profileId) return null;

  const profile = await sb(
    supabase
      .from('company_profiles')
      .select(
        'name, sectors, services, key_topics, target_customers, value_proposition',
      )
      .eq('id', profileId)
      .maybeSingle(),
    'intelligence.flags.analyse.companyProfile',
  );

  if (!profile) return null;

  return {
    name: profile.name,
    sectors: profile.sectors ?? [],
    services: profile.services ?? [],
    keyTopics: profile.key_topics ?? [],
    targetCustomers: profile.target_customers,
    valueProposition: profile.value_proposition,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flag loader — returns the shape `analyseFeedFlags` expects.
// ─────────────────────────────────────────────────────────────────────────────

interface FlagJoinRow {
  id: string;
  flag_type: string;
  notes: string | null;
  created_at: string;
  feed_articles: {
    workspace_id: string;
    title: string | null;
    external_url: string | null;
    relevance_score: number | null;
    relevance_reasoning: string | null;
    relevance_category: string | null;
    feed_sources: { name: string | null } | null;
  } | null;
}

/** Load flags for this workspace, optionally filtered by id list or predicate. */
async function loadFlags(
  supabase: DbClient,
  workspaceId: string,
  request: AnalyseRequest,
): Promise<FlagAnalysisFlag[]> {
  const baseSelect = `id, flag_type, notes, created_at,
    feed_articles!inner(
      workspace_id, title, external_url, relevance_score,
      relevance_reasoning, relevance_category,
      feed_sources(name)
    )`;

  let query = supabase
    .from('feed_flags')
    .select(baseSelect)
    .eq('feed_articles.workspace_id', workspaceId);

  if ('flag_ids' in request && request.flag_ids) {
    query = query.in('id', request.flag_ids);
  } else if ('filter' in request && request.filter) {
    const { resolved, flag_type: flagType } = request.filter;
    if (resolved !== undefined) query = query.eq('resolved', resolved);
    if (flagType) query = query.eq('flag_type', flagType);
  }

  query = query.order('created_at', { ascending: false });

  const rows = (await sb(query, 'intelligence.flags.analyse.listFlags')) as
    | FlagJoinRow[]
    | null;

  return (rows ?? [])
    .filter(
      (
        row,
      ): row is FlagJoinRow & {
        feed_articles: NonNullable<FlagJoinRow['feed_articles']>;
      } => row.feed_articles !== null,
    )
    .map((row) => {
      const article = row.feed_articles;
      return {
        flagType: row.flag_type as 'false_positive' | 'false_negative',
        articleTitle: article.title ?? '(untitled)',
        articleUrl: article.external_url ?? '',
        relevanceScore: article.relevance_score ?? 0,
        relevanceReasoning: article.relevance_reasoning ?? '',
        relevanceCategory: article.relevance_category ?? 'unknown',
        userNotes: row.notes,
        sourceName: article.feed_sources?.name ?? 'Unknown source',
        createdAt: row.created_at,
      } satisfies FlagAnalysisFlag;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/intelligence/workspaces/:id/flags/analyse
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id: workspaceId } = await context.params;

  // 1. Auth — admin OR editor may trigger analysis (rollout / application of
  //    the resulting prompt version is admin-only elsewhere).
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { supabase } = auth;

  // 2. Parse body. Reject unknown shapes with a structured 400.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorEnvelope('Request body must be valid JSON', 400);
  }

  const parsed = parseBody(AnalyseRequestSchema, rawBody);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  // 3. Workspace access check — 403 if the caller cannot see this workspace
  //    or it does not exist as a non-archived intelligence workspace.
  let workspace: AccessibleWorkspace | null;
  try {
    workspace = await loadAccessibleWorkspace(supabase, workspaceId);
  } catch (err) {
    logBestEffortWarn(
      'intelligence.flags.analyse',
      'Failed to load workspace for flag analysis',
      { workspaceId, err: err instanceof Error ? err.message : String(err) },
    );
    return errorEnvelope('Failed to analyse flags', 500);
  }
  if (!workspace) {
    return errorEnvelope('Workspace not found or access denied', 403);
  }

  // 4. Load active prompt, company context, and flags in sequence (each
  //    depends on the workspace row). Any PostgREST error bubbles up as a
  //    SupabaseError from `sb()` and is caught by the outer try/catch below.
  try {
    const [promptText, companyContext, flags] = await Promise.all([
      loadActivePromptText(supabase, workspaceId),
      loadCompanyContext(supabase, workspace),
      loadFlags(supabase, workspaceId, body),
    ]);

    if (!promptText) {
      return errorEnvelope(
        'No active scoring prompt found for this workspace',
        400,
      );
    }
    if (!companyContext) {
      return errorEnvelope('Workspace has no linked company profile', 400);
    }

    const result = await analyseFeedFlags({
      currentPromptText: promptText,
      flags,
      companyContext,
    });

    return NextResponse.json(result);
  } catch (err) {
    logBestEffortWarn('intelligence.flags.analyse', 'Flag analysis failed', {
      workspaceId,
      err: err instanceof Error ? err.message : String(err),
    });
    return errorEnvelope('Failed to analyse flags', 500);
  }
}
