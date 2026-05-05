/**
 * Shared setter for the supersession model (S186 WP-B.2).
 *
 * One helper, three callers:
 *   1. UI admin flow (`PATCH /api/items/:id` — see WP-B.5)
 *   2. MCP tool (`supersede_content_item` — see WP-B.4)
 *   3. Python ingest `--auto-supersede` (Python equivalent in
 *      `scripts/kb_pipeline/supersede.py`)
 *
 * Responsibility: validate inputs, write `superseded_by` on the OLD row,
 * flip its `dedup_status` to `'superseded'`, and emit a Sentry breadcrumb
 * for observability. Callers handle auth + downstream reads.
 *
 * TS ⇄ Python parity notes (B.2 verifier M1/L3/L5):
 *   - This helper emits `SupersessionError.context` keys in camelCase
 *     (`oldId`, `existingSupersededBy`); the Python equivalent emits the
 *     same semantic fields in snake_case (`old_id`,
 *     `existing_superseded_by`). Each language follows its own idiom —
 *     callers are language-local so there is no cross-boundary inspection.
 *   - TS loads old + new rows via `Promise.all`; Python does it
 *     sequentially. Observable error codes are identical (OLD_NOT_FOUND
 *     wins when both are missing) so the divergence is latency-only.
 *   - Error messages include raw UUIDs. This is safe because all routes
 *     that surface these errors are admin-only per spec §6; if a
 *     non-admin route ever calls this helper, it MUST NOT leak the
 *     SupersessionError message directly — treat it as internal-only.
 *
 * Concurrency note (B.2 verifier L2 — TOCTOU):
 *   Two concurrent callers can both pass the OLD_ALREADY_SUPERSEDED
 *   validation, then both issue the UPDATE. The second UPDATE wins and
 *   silently overwrites `superseded_by` with a different `newId`. The
 *   DB CHECK only prevents self-ref, not conflicting-pointer races.
 *   Worst case: old row points to the wrong successor — not corruption.
 *   Acceptable pre-launch because supersession is admin-only + low
 *   volume; revisit post-launch if audit evidence shows the race.
 *
 * Spec: docs/specs/supersession-model-spec.md §5.4
 * Plan: docs/plans/supersession-model-plan.md §B.2
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';

// Narrow projection of content_items that the helper touches. The
// generated types now include superseded_by (WP-B.7 regen picked up the
// WP-B.1 migration), so no intersection is needed any more.
//
// S216 Phase 5 (§6.5): the helper now also writes
//   publication_status / archived_at / archived_by / archive_reason
// on the OLD row, but the projected return type still surfaces the
// classic four columns (id/title/superseded_by/dedup_status). Callers
// that need the new fields read them via a follow-up SELECT (production
// callers don't today). Keeping the return shape minimal preserves
// backwards-compat for `app/api/items/[id]/route.ts:138` and
// `app/api/admin/content-dedup/[id]/supersede/route.ts:130` and
// `app/api/admin/content-dedup/near-duplicates/[pairId]/merge/route.ts:110`
// — none of which read fields beyond the four returned today.
type ContentItemSupersessionRow = Pick<
  Database['public']['Tables']['content_items']['Row'],
  'id' | 'title' | 'superseded_by' | 'dedup_status'
>;

/** @public */
export type SupersessionErrorCode =
  | 'SAME_ID'
  | 'OLD_NOT_FOUND'
  | 'NEW_NOT_FOUND'
  | 'OLD_ALREADY_SUPERSEDED'
  | 'NEW_ALREADY_SUPERSEDED';

export class SupersessionError extends Error {
  readonly name = 'SupersessionError';
  readonly code: SupersessionErrorCode;
  readonly context: Record<string, unknown> | undefined;

  constructor(
    code: SupersessionErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.context = context;
  }
}

interface SupersessionRowSnapshot {
  id: string;
  title: string | null;
  superseded_by: string | null;
  dedup_status: string;
}

/** @public */
export interface SetSupersessionParams {
  oldId: string;
  newId: string;
  actorUserId: string;
  /**
   * Free-text reason for retiring the OLD row. Persisted to
   * `content_items.archive_reason` on the OLD row (S216 Phase 5 §6.5).
   *
   * Optional — defaults to `Superseded by item ${newId}` when omitted, so
   * existing callers (PATCH /api/items/:id, MCP supersede_content_item,
   * admin dedup supersede + near-dup merge) require no source changes.
   */
  archiveReason?: string;
}

export interface SetSupersessionResult {
  oldItem: SupersessionRowSnapshot;
  newItem: SupersessionRowSnapshot;
}

/**
 * Mark `oldId` as superseded by `newId`.
 *
 * Rejects with `SupersessionError`:
 *   - `SAME_ID` — oldId === newId
 *   - `OLD_NOT_FOUND` / `NEW_NOT_FOUND` — row does not exist
 *   - `OLD_ALREADY_SUPERSEDED` — old row already has `superseded_by` set.
 *     Prevents one side of a chain (`X → old → new`).
 *   - `NEW_ALREADY_SUPERSEDED` — new row already has `superseded_by` set.
 *     Prevents the other side of a chain (`old → new → Y`).
 *
 * On success, the OLD row is updated. NEW row is unchanged.
 *
 * S216 §5.2 Phase 5 — §6.5 wiring:
 *   The OLD row is now ALSO archived as part of supersession. The UPDATE
 *   sets `publication_status='archived'`, `archived_at=NOW()`,
 *   `archived_by=actorUserId`, `archive_reason=archiveReason ?? <default>`,
 *   and `updated_by=actorUserId` in addition to the legacy
 *   `superseded_by` + `dedup_status='superseded'` writes. The §6.6
 *   BIDIRECTIONAL trigger (`enforce_archive_state_consistency`) is
 *   idempotent for this payload — Direction 1 sees both `publication_status`
 *   AND `archived_at` already populated and is a no-op.
 *
 *   Default `archive_reason` is `Superseded by item ${newId}` so any
 *   caller omitting `params.archiveReason` produces a meaningful audit
 *   trail. Per spec §6.5 lines 1019-1031, this unifies the "retired"
 *   concept under `publication_status='archived'` while preserving
 *   `superseded_by` as the metadata "by what?" pointer.
 *
 * @param params.oldId — the row being retired (its `superseded_by` gets set)
 * @param params.newId — the row that replaces it (untouched)
 * @param params.actorUserId — UUID for audit context. Persisted to
 *   `archived_by` and `updated_by` on the OLD row (S216 §6.5). Callers
 *   that need a `content_history` entry still write their own snapshot
 *   per the archive/delete precedent in governance tools.
 * @param params.archiveReason — optional free-text reason for the archive
 *   side-effect. Defaults to `Superseded by item ${newId}` when omitted —
 *   existing callers see a meaningful default without code changes.
 * @param client — authorised Supabase client (RLS scoped or service role)
 */
export async function setSupersession(
  params: SetSupersessionParams,
  client: SupabaseClient<Database>,
): Promise<SetSupersessionResult> {
  const { oldId, newId, actorUserId, archiveReason } = params;

  if (oldId === newId) {
    throw new SupersessionError(
      'SAME_ID',
      'Cannot supersede an item with itself',
      { oldId, newId },
    );
  }

  // Load both rows. Using maybeSingle so "not found" is data=null, not an
  // error — lets us map to a specific error code instead of a generic PGRST116.
  const [oldRow, newRow] = await Promise.all([
    sb<ContentItemSupersessionRow | null>(
      client
        .from('content_items')
        .select('id, title, superseded_by, dedup_status')
        .eq('id', oldId)
        .maybeSingle(),
      'supersession.load_old',
    ),
    sb<ContentItemSupersessionRow | null>(
      client
        .from('content_items')
        .select('id, title, superseded_by, dedup_status')
        .eq('id', newId)
        .maybeSingle(),
      'supersession.load_new',
    ),
  ]);

  if (!oldRow) {
    throw new SupersessionError(
      'OLD_NOT_FOUND',
      `Old item not found: ${oldId}`,
      { oldId },
    );
  }
  if (!newRow) {
    throw new SupersessionError(
      'NEW_NOT_FOUND',
      `New item not found: ${newId}`,
      { newId },
    );
  }

  if (oldRow.superseded_by) {
    throw new SupersessionError(
      'OLD_ALREADY_SUPERSEDED',
      `Old item ${oldId} is already superseded by ${oldRow.superseded_by}`,
      { oldId, existingSupersededBy: oldRow.superseded_by },
    );
  }
  if (newRow.superseded_by) {
    throw new SupersessionError(
      'NEW_ALREADY_SUPERSEDED',
      `New item ${newId} is already superseded by ${newRow.superseded_by}; cannot form a chain`,
      { newId, existingSupersededBy: newRow.superseded_by },
    );
  }

  // S216 §5.2 Phase 5 — §6.5 wiring. In addition to the legacy
  // superseded_by/dedup_status writes, retire the OLD row by setting
  // publication_status='archived' + archived_at/archived_by/archive_reason.
  // The §6.6 trigger Direction 1 sees publication_status AND archived_at
  // already populated and is a no-op — this payload upholds the
  // bidirectional invariant on its own.
  const archivedAt = new Date().toISOString();
  const resolvedArchiveReason = archiveReason ?? `Superseded by item ${newId}`;
  const updated = await sb<ContentItemSupersessionRow>(
    client
      .from('content_items')
      .update({
        superseded_by: newId,
        dedup_status: 'superseded',
        publication_status: 'archived',
        archived_at: archivedAt,
        archived_by: actorUserId,
        archive_reason: resolvedArchiveReason,
        updated_by: actorUserId,
      })
      .eq('id', oldId)
      .select('id, title, superseded_by, dedup_status')
      .single(),
    'supersession.update_old',
  );

  // Operational audit breadcrumb — Sentry.addBreadcrumb is a no-op when the
  // SDK is unconfigured (tests, CLI), so no try/catch needed.
  Sentry.addBreadcrumb({
    category: 'supersession.set',
    message: `Item ${oldId} superseded by ${newId}`,
    level: 'info',
    data: {
      oldId,
      newId,
      actorUserId,
      oldTitle: oldRow.title,
      newTitle: newRow.title,
    },
    timestamp: Date.now() / 1000,
  });

  return {
    oldItem: updated,
    newItem: {
      id: newRow.id,
      title: newRow.title,
      superseded_by: newRow.superseded_by,
      dedup_status: newRow.dedup_status,
    },
  };
}
