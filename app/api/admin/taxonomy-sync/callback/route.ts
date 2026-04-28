/**
 * POST /api/admin/taxonomy-sync/callback
 *
 * Receives workflow completion callbacks from GitHub Actions.
 * Authentication is via HMAC-SHA256 signature — no user session required.
 *
 * Spec: docs/specs/p0-tx-taxonomy-sync-spec.md §5.3
 * ACs: AC-13 (callback verification + state update), AC-15 (replay window)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sb } from '@/lib/supabase/safe';
import { computeTaxonomyHash } from '@/lib/taxonomy/sync-trigger';
import { safeErrorMessage } from '@/lib/error';
import * as Sentry from '@sentry/nextjs';

/** Replay window: reject payloads older than 5 minutes */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

interface CallbackPayload {
  run_id: string;
  status: 'success' | 'failed';
  timestamp: number;
  /** Advisory only — callback computes authoritative hash from DB. */
  new_hash?: string;
  error_message?: string;
}

export async function POST(request: NextRequest) {
  // 1. Read raw body as string — HMAC is computed on raw bytes, not parsed JSON
  const rawBody = await request.text();

  // 2. Read signature header
  const signature = request.headers.get('x-taxonomy-sync-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 401 });
  }

  // 3. Verify server has the HMAC secret configured
  const secret = process.env.TAXONOMY_SYNC_CALLBACK_SECRET;
  if (!secret) {
    Sentry.captureMessage(
      'TAXONOMY_SYNC_CALLBACK_SECRET not configured',
      'error',
    );
    return NextResponse.json(
      { error: 'server_misconfigured' },
      { status: 500 },
    );
  }

  // 4. Compute expected HMAC-SHA256 of raw body
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  // 5. Constant-time comparison via timingSafeEqual
  //    Both must be Buffers of equal length; length mismatch = immediate rejection
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  // 6. Parse the verified body
  const payload: CallbackPayload = JSON.parse(rawBody);

  // 7. Replay-window check (AC-15): reject timestamps > 5 min old
  if (Date.now() - payload.timestamp > REPLAY_WINDOW_MS) {
    return NextResponse.json({ error: 'stale_timestamp' }, { status: 401 });
  }

  try {
    // 8. Process the callback — use service client (no user session; bypasses RLS)
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    if (payload.status === 'success') {
      // Compute the authoritative hash from DB state rather than trusting
      // the workflow payload's advisory new_hash field. This is the single
      // source of truth — the workflow does not need computeTaxonomyHash.
      // sb() returns the data array directly — destructuring `{ data }` was
      // a latent bug masked by the pre-S186-WP-B.7 types. Surfaced by the
      // types regen; trivial fix here.
      const domains = await sb(
        supabase.from('taxonomy_domains').select('*').eq('is_active', true),
        'taxonomy_sync.callback.domains_fetch',
      );
      const subtopics = await sb(
        supabase.from('taxonomy_subtopics').select('*').eq('is_active', true),
        'taxonomy_sync.callback.subtopics_fetch',
      );
      const newHash = computeTaxonomyHash({
        domains: domains ?? [],
        subtopics: subtopics ?? [],
      });

      // Update taxonomy_sync_state singleton with DB-derived hash + timestamp.
      // The ((true)) unique index guarantees exactly one row exists.
      // Filter by not-null id to satisfy Supabase REST's filter requirement.
      await sb(
        supabase
          .from('taxonomy_sync_state')
          .update({
            last_sync_hash: newHash,
            last_sync_at: now,
            synced_by: 'workflow',
            updated_at: now,
          })
          .not('id', 'is', null),
        'taxonomy_sync.callback.state_update',
      );

      // Update pipeline_runs row to completed
      await sb(
        supabase
          .from('pipeline_runs')
          .update({
            status: 'completed',
            completed_at: now,
          })
          .eq('id', payload.run_id),
        'taxonomy_sync.callback.pipeline_runs.complete',
      );
    } else {
      // status === 'failed'
      await sb(
        supabase
          .from('pipeline_runs')
          .update({
            status: 'failed',
            completed_at: now,
            error_message: payload.error_message,
          })
          .eq('id', payload.run_id),
        'taxonomy_sync.callback.pipeline_runs.fail',
      );

      Sentry.captureMessage(
        `Taxonomy sync workflow failed: ${payload.error_message}`,
        'error',
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { pipeline: 'taxonomy_sync', phase: 'callback' },
      extra: { run_id: payload.run_id, status: payload.status },
    });

    return NextResponse.json(
      {
        error: safeErrorMessage(
          err,
          'Failed to process taxonomy sync callback',
        ),
      },
      { status: 500 },
    );
  }
}
