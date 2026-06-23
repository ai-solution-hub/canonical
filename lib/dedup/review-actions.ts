/**
 * Shared admin dedup-review action helpers (jscpd Wave-5 C3).
 *
 * Three admin routes resolve a `content_items` dedup subject and append a
 * `content_history` audit row when an operator confirms / supersedes a
 * suspected duplicate:
 *   - `app/api/admin/content-dedup/[id]/confirm-duplicate/route.ts`
 *   - `app/api/admin/content-dedup/[id]/confirm-unique/route.ts`
 *   - `app/api/admin/content-dedup/[id]/supersede/route.ts`
 *
 * Before this module each route hand-rolled (a) the subject load + the three
 * idempotency guards and (b) the next-version lookup + history insert. Those
 * two facts are extracted here. Following the C2 lesson, the callers diverge
 * only on response/error policy, so the helpers return data / swallow
 * best-effort and let each route own its exact `NextResponse`, status codes,
 * log channel and message strings — no behaviour is changed by the extraction.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { logger } from '@/lib/logger';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

/**
 * Narrow projection of `content_items` that every dedup-review route loads.
 * The column list is byte-identical to the inline `.select(...)` the routes
 * used previously, including `archived_at` / `superseded_by` (selected for
 * historical parity even though the action handlers do not read them).
 */
export type DedupSubject = Pick<
  Database['public']['Tables']['content_items']['Row'],
  | 'id'
  | 'title'
  | 'suggested_title'
  | 'content'
  | 'brief'
  | 'detail'
  | 'reference'
  | 'metadata'
  | 'dedup_status'
  | 'archived_at'
  | 'superseded_by'
>;

/**
 * Tagged result of {@link resolveDedupSubject}. The helper never builds a
 * `NextResponse` — each caller maps these reasons to its own status/body so
 * the per-route error strings and response shapes are preserved exactly.
 */
export type ResolveDedupSubjectResult =
  | { ok: true; subject: DedupSubject }
  | { ok: false; reason: 'load_error' }
  | { ok: false; reason: 'not_found' }
  | {
      ok: false;
      reason: 'already_resolved';
      currentStatus: DedupSubject['dedup_status'];
    };

/**
 * Load the dedup subject row and run the three shared guards:
 *   1. real load error (≠ PGRST116) → `load_error` (logged here via the
 *      caller's `op`, mirroring the previous inline `logger.error`).
 *   2. row absent → `not_found`.
 *   3. row not in the `suspected_duplicate` flow → `already_resolved`.
 *
 * @param op full log namespace for the load-error log, e.g.
 *   `admin.content-dedup.confirm-duplicate.load_subject`.
 */
export async function resolveDedupSubject(
  supabase: SupabaseClient<Database>,
  id: string,
  op: string,
): Promise<ResolveDedupSubjectResult> {
  const { data: subject, error: subjectErr } = await supabase
    .from('content_items')
    .select(
      'id, title, suggested_title, content, brief, detail, reference, metadata, dedup_status, archived_at, superseded_by',
    )
    .eq('id', id)
    .single();

  if (subjectErr && subjectErr.code !== 'PGRST116') {
    logger.error({ err: subjectErr, op }, 'Failed to load dedup subject');
    return { ok: false, reason: 'load_error' };
  }
  if (!subject) {
    return { ok: false, reason: 'not_found' };
  }
  if (subject.dedup_status !== 'suspected_duplicate') {
    return {
      ok: false,
      reason: 'already_resolved',
      currentStatus: subject.dedup_status,
    };
  }
  return { ok: true, subject };
}

/**
 * The `title` / `content` snapshot projection repeated across the routes:
 * `title || suggested_title || 'Untitled'`, `content || ''`, brief/detail/
 * reference passed through. NOT used for the synthetic retired-canonical row
 * in the supersede Direction-B path (which carries hand-built literals).
 */
export function subjectHistorySnapshot(subject: DedupSubject): {
  title: string;
  content: string;
  brief: string | null;
  detail: string | null;
  reference: string | null;
} {
  return {
    title: subject.title || subject.suggested_title || 'Untitled',
    content: subject.content || '',
    brief: subject.brief,
    detail: subject.detail,
    reference: subject.reference,
  };
}

type ContentHistoryMetadata =
  Database['public']['Tables']['content_history']['Insert']['metadata'];

export interface WriteDedupHistoryInput {
  contentItemId: string;
  title: string;
  content: string;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  metadata: ContentHistoryMetadata;
  changeType: 'archive' | 'metadata_change' | 'merge';
  changeSummary: string;
  changeReason: string;
  createdBy: string;
}

export interface WriteDedupHistoryOptions {
  /**
   * Base log namespace; the helper suffixes `.history_version_lookup` and
   * `.history_insert` internally (e.g. base
   * `admin.content-dedup.confirm-duplicate` or `admin.dedup.supersede`).
   */
  op: string;
  /**
   * `logger` → `logger.error({ err, op }, …)` (confirm-* parity);
   * `bestEffort` → `logBestEffortWarn(op, …, { ...warnContext, error })`
   * (supersede parity).
   */
  errorChannel: 'logger' | 'bestEffort';
  /** message for the version-lookup failure log. */
  versionLookupMessage: string;
  /** message for the insert failure log. */
  insertMessage: string;
  /** extra structured context merged into `bestEffort` logs (ignored for `logger`). */
  warnContext?: Record<string, unknown>;
}

/**
 * Append one `content_history` row for a dedup-review action.
 *
 * Keeps the two-step shape the routes used: the next-version lookup is
 * awaited on the SAME client BEFORE the insert is awaited, so the
 * mock-chain call ORDER the route specs assert on is preserved. Both the
 * version-lookup error and the insert error are swallowed best-effort
 * (never throws, never surfaces a 500) and logged via the requested channel
 * with the per-row message — exactly the prior inline behaviour.
 */
export async function writeDedupHistory(
  supabase: SupabaseClient<Database>,
  input: WriteDedupHistoryInput,
  opts: WriteDedupHistoryOptions,
): Promise<void> {
  const { data: latestHistory, error: latestHistoryErr } = await supabase
    .from('content_history')
    .select('version')
    .eq('content_item_id', input.contentItemId)
    .order('version', { ascending: false })
    .limit(1);

  if (latestHistoryErr) {
    logDedupHistoryError(
      opts,
      `${opts.op}.history_version_lookup`,
      opts.versionLookupMessage,
      latestHistoryErr,
    );
  }

  const nextVersion = (latestHistory?.[0]?.version ?? 0) + 1;

  const { error: historyErr } = await supabase.from('content_history').insert({
    content_item_id: input.contentItemId,
    version: nextVersion,
    title: input.title,
    content: input.content,
    brief: input.brief,
    detail: input.detail,
    reference: input.reference,
    metadata: input.metadata,
    change_type: input.changeType,
    change_summary: input.changeSummary,
    change_reason: input.changeReason,
    created_by: input.createdBy,
  });

  if (historyErr) {
    logDedupHistoryError(
      opts,
      `${opts.op}.history_insert`,
      opts.insertMessage,
      historyErr,
    );
  }
}

/** Channel-aware swallow log for the two best-effort history failure points. */
function logDedupHistoryError(
  opts: WriteDedupHistoryOptions,
  fullOp: string,
  message: string,
  err: unknown,
): void {
  if (opts.errorChannel === 'logger') {
    logger.error({ err, op: fullOp }, message);
    return;
  }
  logBestEffortWarn(fullOp, message, { ...opts.warnContext, error: err });
}
