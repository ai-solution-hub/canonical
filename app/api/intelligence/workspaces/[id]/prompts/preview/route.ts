// app/api/intelligence/workspaces/[id]/prompts/preview/route.ts
//
// POST /api/intelligence/workspaces/:id/prompts/preview
//
// Re-score the N most recent feed articles in the workspace against a
// candidate prompt and return a before/after comparison. Heaviest of the
// WP5 tasks: performs multiple `scoreRelevance` (Claude) calls in a batch
// with a concurrency cap to avoid runaway cost. Per-article failures are
// surfaced via `warningsEnvelope` (partial-success semantics).
//
// See docs/specs/si-prompt-refinement-skill-spec.md §4 Task 4.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb, tryQuery, isOk } from '@/lib/supabase/safe';
import {
  createWarningsCollector,
  warningsEnvelope,
} from '@/lib/supabase/warnings';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { scoreRelevance } from '@/lib/intelligence/relevance-scorer';
import type { CompanyContext } from '@/lib/intelligence/types';
import {
  INTELLIGENCE_WORKSPACE_SELECT,
  extractContextFromSatellite,
} from '@/lib/intelligence/workspace-context';

type RouteContext = { params: Promise<{ id: string }> };

// Anti-runaway cap — never re-score more than this in a single request.
const MAX_SAMPLE_SIZE = 20;
const DEFAULT_SAMPLE_SIZE = 10;
// Claude API concurrency cap. Keep small: each call is a full model
// invocation, and we do not want to cascade rate-limit errors.
const MAX_CONCURRENCY = 3;

const PreviewSchema = z.object({
  prompt_text: z.string().min(10).max(5000),
  sample_size: z
    .number()
    .int()
    .min(1)
    .max(MAX_SAMPLE_SIZE)
    .optional()
    .default(DEFAULT_SAMPLE_SIZE),
  include_scored: z.boolean().optional().default(false),
});

interface PreviewResult {
  article_id: string;
  title: string;
  existing_score: number | null;
  candidate_score: number;
  score_delta: number;
  existing_reasoning?: string | null;
  candidate_reasoning?: string;
}

/** POST /api/intelligence/workspaces/:id/prompts/preview */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: workspaceId } = await context.params;

    // 1. Auth — admin OR editor.
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // 2. Parse + validate body.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = parseBody(PreviewSchema, body);
    if (!parsed.success) return parsed.response;
    const {
      prompt_text: promptText,
      sample_size: sampleSize,
      include_scored: includeScored,
    } = parsed.data;

    // 3. Workspace access check + satellite-projected context load — one
    //    round-trip via JOIN through application_types + intelligence_workspaces.
    //    403 rather than 404 to avoid leaking workspace existence.
    const workspaceResult = await tryQuery(
      supabase
        .from('workspaces')
        .select(INTELLIGENCE_WORKSPACE_SELECT)
        .eq('id', workspaceId)
        .eq('application_types.key', 'intelligence')
        .eq('is_archived', false)
        .maybeSingle(),
      'workspaces.byId.preview',
    );
    if (!isOk(workspaceResult) || !workspaceResult.data) {
      return NextResponse.json(
        { error: 'Workspace not found or access denied' },
        { status: 403 },
      );
    }

    // 4. Load company context from the satellite.
    const workspaceContext = extractContextFromSatellite(
      workspaceResult.data.intelligence_workspaces,
    );
    const profileId = workspaceContext.companyProfileId;
    if (!profileId) {
      return NextResponse.json(
        {
          error:
            'Workspace has no linked company profile — cannot preview scoring',
        },
        { status: 400 },
      );
    }

    const profile = await sb(
      supabase
        .from('company_profiles')
        .select(
          'name, sectors, services, key_topics, target_customers, value_proposition',
        )
        .eq('id', profileId)
        .maybeSingle(),
      'company_profiles.byId.preview',
    );
    if (!profile) {
      return NextResponse.json(
        { error: 'Linked company profile not found' },
        { status: 400 },
      );
    }

    const company: CompanyContext = {
      name: profile.name,
      sectors: profile.sectors ?? [],
      services: profile.services ?? [],
      keyTopics: profile.key_topics ?? [],
      targetCustomers: profile.target_customers,
      valueProposition: profile.value_proposition,
    };

    // 5. Fetch the most recent N articles with content.
    const articlesResult = await tryQuery(
      supabase
        .from('feed_articles')
        .select('id, title, raw_content, relevance_score, relevance_reasoning')
        .eq('workspace_id', workspaceId)
        .not('raw_content', 'is', null)
        .order('ingested_at', { ascending: false })
        .limit(sampleSize),
      'feed_articles.recent.preview',
    );
    if (!isOk(articlesResult)) {
      return NextResponse.json(
        { error: 'Failed to load sample articles' },
        { status: 500 },
      );
    }

    const articles = articlesResult.data ?? [];
    const warnings = createWarningsCollector();

    if (articles.length === 0) {
      return warningsEnvelope(
        {
          samples: 0,
          mean_delta: 0,
          improved: 0,
          regressed: 0,
          results: [] as PreviewResult[],
        },
        warnings,
      );
    }

    // 6. Re-score with concurrency cap (simple semaphore pattern).
    const results: PreviewResult[] = [];
    let cursor = 0;

    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= articles.length) return;
        const article = articles[i];
        const content = article.raw_content ?? '';
        if (!content) {
          warnings.add(`Article ${article.id} skipped: no raw content`);
          continue;
        }
        try {
          const scored = await scoreRelevance(
            article.title,
            content,
            company,
            undefined, // default threshold
            promptText,
          );
          const existing = article.relevance_score;
          const delta =
            scored.score - (typeof existing === 'number' ? existing : 0);
          const entry: PreviewResult = {
            article_id: article.id,
            title: article.title,
            existing_score: existing ?? null,
            candidate_score: scored.score,
            score_delta: Number(delta.toFixed(4)),
            candidate_reasoning: scored.reasoning,
          };
          if (includeScored) {
            entry.existing_reasoning = article.relevance_reasoning ?? null;
          }
          results.push(entry);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          // Back off on rate limits — stop pulling more work but keep
          // what we have so the caller can render a partial result.
          if (/rate|429/i.test(msg)) {
            warnings.add(
              `Rate limit hit while scoring article ${article.id}; returning partial results`,
            );
            cursor = articles.length; // stop other workers taking new work
            return;
          }
          warnings.add(`Failed to score article ${article.id}: ${msg}`);
        }
      }
    }

    const workerCount = Math.min(MAX_CONCURRENCY, articles.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    // 7. Aggregate stats.
    const improved = results.filter((r) => r.score_delta > 0).length;
    const regressed = results.filter((r) => r.score_delta < 0).length;
    const meanDelta =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.score_delta, 0) / results.length
        : 0;

    return warningsEnvelope(
      {
        samples: results.length,
        mean_delta: Number(meanDelta.toFixed(4)),
        improved,
        regressed,
        results,
      },
      warnings,
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to preview prompt scoring') },
      { status: 500 },
    );
  }
}
