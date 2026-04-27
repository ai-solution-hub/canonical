/**
 * POST /api/admin/taxonomy-sync
 *
 * Taxonomy sync dispatch endpoint. Compares the current taxonomy hash
 * against the stored `taxonomy_sync_state.last_sync_hash` and, on
 * mismatch, dispatches a GitHub Actions workflow to regenerate the
 * classification prompt, snapshot, and plugin files.
 *
 * Per spec P0-TX §3.1.2 + §5.1 + §5.2:
 * - Hash match (in-sync): records a no-op `pipeline_runs` row, returns
 *   `{ dispatched: false, reason: 'in_sync' }`
 * - Hash mismatch (drift): inserts a 'running' `pipeline_runs` row via
 *   raw `sb()` (per §4.1.1 — `recordPipelineRun()` only accepts terminal
 *   statuses), dispatches to GitHub, returns `{ dispatched: true, run_id }`
 * - GitHub API errors: mapped to actionable 502 responses per §5.2.3 + AC-14
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { computeTaxonomyHash } from '@/lib/taxonomy/sync-trigger';
import { dispatchTaxonomySync } from '@/lib/integrations/github-dispatch';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

const PIPELINE_NAME = 'taxonomy_sync';

export async function POST() {
  try {
    // 1. Admin auth
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // 2. Fetch taxonomy from DB (classification-relevant fields only)
    const domains = await sb(
      supabase
        .from('taxonomy_domains')
        .select('id, name, description, key_signal, display_order, is_active'),
      'taxonomy_sync.domains',
    );

    const subtopics = await sb(
      supabase
        .from('taxonomy_subtopics')
        .select('id, domain_id, name, description, display_order, is_active'),
      'taxonomy_sync.subtopics',
    );

    // 3. Compute current hash
    const currentHash = computeTaxonomyHash({ domains, subtopics });

    // 4. Read stored hash from taxonomy_sync_state singleton
    const syncState = await sb(
      supabase
        .from('taxonomy_sync_state')
        .select('last_sync_hash')
        .not('id', 'is', null)
        .single(),
      'taxonomy_sync.state',
    );

    // 5. If match: record no-op pipeline_runs and return
    if (currentHash === syncState.last_sync_hash) {
      await recordPipelineRun({
        supabase,
        pipelineName: PIPELINE_NAME,
        status: 'completed',
        itemsProcessed: 0,
      });

      return NextResponse.json({
        dispatched: false,
        reason: 'in_sync',
      });
    }

    // 6. Hash mismatch — dispatch sync
    // 6a. Insert initial 'running' pipeline_runs row via raw sb()
    //     Per spec §4.1.1: recordPipelineRun() only accepts terminal statuses
    const runRow = await sb(
      supabase
        .from('pipeline_runs')
        .insert({
          pipeline_name: PIPELINE_NAME,
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single(),
      'taxonomy_sync.pipeline_runs.insert',
    );
    const runId = runRow.id;

    // 6b. Call dispatchTaxonomySync — forward run_id so the workflow
    //     callback can update the correct pipeline_runs row
    const dispatch = await dispatchTaxonomySync(runId);

    // 6c. If dispatch succeeded — pipeline_runs.started_at already
    //     records when dispatch occurred; no separate state update needed.
    if (dispatch.ok) {
      return NextResponse.json({
        dispatched: true,
        run_id: runId,
      });
    }

    // 6d. Dispatch failed — update pipeline_runs to failed + Sentry + 502
    await sb(
      supabase
        .from('pipeline_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message:
            dispatch.error ?? `GitHub API returned ${dispatch.status}`,
        })
        .eq('id', runId),
      'taxonomy_sync.pipeline_runs.fail',
    );

    // Error-status mapping per spec §5.2.3 + AC-14
    const { error, message } = mapGitHubError(dispatch.status, dispatch.error);

    Sentry.captureException(
      new Error(
        `Taxonomy sync dispatch failed: ${dispatch.error ?? dispatch.status}`,
      ),
      {
        tags: { pipeline: PIPELINE_NAME, github_status: dispatch.status },
        extra: { dispatch },
      },
    );

    return NextResponse.json({ error, message }, { status: 502 });
  } catch (err) {
    return NextResponse.json(
      {
        error: safeErrorMessage(err, 'Failed to dispatch taxonomy sync'),
      },
      { status: 500 },
    );
  }
}

/**
 * Map a GitHub API HTTP status to an actionable error response.
 * Per spec §5.2.3 + AC-14.
 */
function mapGitHubError(
  status: number,
  _error?: string,
): { error: string; message: string } {
  if (status === 401 || status === 403) {
    return {
      error: 'github_token_invalid',
      message:
        'GitHub token is invalid or expired. Rotate GITHUB_SYNC_TOKEN in Vercel.',
    };
  }

  if (status === 404 || status === 422) {
    return {
      error: 'github_workflow_missing',
      message:
        'Workflow .github/workflows/taxonomy-sync.yml not found on main.',
    };
  }

  // 5xx or network error (status 0) — retry already exhausted by dispatch helper
  return {
    error: 'github_api_unavailable',
    message:
      'GitHub API temporarily unavailable. The drift banner will retry on next page load.',
  };
}
