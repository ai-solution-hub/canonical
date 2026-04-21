/**
 * GET /api/admin/taxonomy-sync/status
 *
 * Drift-detection status endpoint. Returns whether the current taxonomy
 * state matches the last synced hash. Used by the TaxonomyDriftBanner
 * component on Settings page load.
 *
 * Per spec P0-TX §3.2.3 + §5.4.3:
 * - Before returning, sweeps stale 'running' pipeline_runs rows older
 *   than 10 minutes (AC-16: workflow_callback_timeout)
 * - Returns `{ in_sync, last_sync_at, current_hash, synced_hash }`
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { computeTaxonomyHash } from '@/lib/taxonomy/sync-trigger';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 15;

const PIPELINE_NAME = 'taxonomy_sync';
const STALE_THRESHOLD_MINUTES = 10;

export async function GET() {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // 1. Stale-run sweep (spec §5.4.3 + AC-16)
    //    Mark any taxonomy_sync runs that have been 'running' for > 10 min
    //    as 'failed' with a timeout error message.
    const staleThreshold = new Date(
      Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000,
    ).toISOString();

    await sb(
      supabase
        .from('pipeline_runs')
        .update({
          status: 'failed',
          error_message: 'workflow_callback_timeout',
          completed_at: new Date().toISOString(),
        })
        .eq('pipeline_name', PIPELINE_NAME)
        .eq('status', 'running')
        .lt('started_at', staleThreshold),
      'taxonomy_sync.stale_sweep',
    );

    // 2. Fetch current taxonomy + compute hash
    const domains = await sb(
      supabase
        .from('taxonomy_domains')
        .select('id, name, description, key_signal, display_order, is_active'),
      'taxonomy_sync.status.domains',
    );

    const subtopics = await sb(
      supabase
        .from('taxonomy_subtopics')
        .select('id, domain_id, name, description, display_order, is_active'),
      'taxonomy_sync.status.subtopics',
    );

    const currentHash = computeTaxonomyHash({ domains, subtopics });

    // 3. Fetch taxonomy_sync_state
    const syncState = await sb(
      supabase
        .from('taxonomy_sync_state')
        .select('last_sync_hash, last_sync_at')
        .limit(1)
        .single(),
      'taxonomy_sync.status.state',
    );

    // 4. Return drift status
    return NextResponse.json({
      in_sync: currentHash === syncState.last_sync_hash,
      last_sync_at: syncState.last_sync_at,
      current_hash: currentHash,
      synced_hash: syncState.last_sync_hash,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: safeErrorMessage(err, 'Failed to check taxonomy sync status'),
      },
      { status: 500 },
    );
  }
}
