/**
 * Shared setter for the supersession model (S186 WP-B.2).
 *
 * One helper, three callers:
 *   1. UI admin flow (`PATCH /api/items/:id` — see WP-B.5)
 *   2. MCP tool (`supersede_content_item` — see WP-B.4)
 *   3. Python ingest `--auto-supersede` (cocoindex pipeline equivalent)
 *
 * Responsibility: validate inputs, write `superseded_by` on the OLD row,
 * flip its `publication_status` to `'archived'`, and emit a Sentry
 * breadcrumb for observability. Callers handle auth + downstream reads.
 *
 * ID-131.37 F1 (owner S446 ruling) — re-pointed onto q_a_pairs:
 *   This helper originally read/wrote the legacy content-item table (S216
 *   §6.5/§6.6 dual-write: `superseded_by` + `dedup_status='superseded'` +
 *   archive metadata columns). That legacy table is being fully eliminated
 *   (PRODUCT BI-9); this helper now reads/writes `q_a_pairs` instead, using
 *   ONLY the two columns that model carries — `superseded_by` +
 *   `publication_status`. q_a_pairs has no `dedup_status`, no
 *   `archived_at`/`archived_by`/`archive_reason`, so those legs have no
 *   equivalent here and are dropped (not persisted to any column —
 *   `actorUserId`/`archiveReason` are still captured on the Sentry
 *   breadcrumb for audit visibility). The validation guards
 *   (self-supersession, chain checks) already depended only on
 *   `superseded_by`, so their behaviour is unchanged.
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

// Narrow projection of q_a_pairs that the helper touches (ID-131.37 F1
// re-point onto the id-120 archived model). `question_text` is q_a_pairs'
// human-readable equivalent of the retired legacy `title` column — kept in
// the projection so the Sentry breadcrumb + MCP tool's formatted message
// still have something meaningful to show.
type QaPairSupersessionRow = Pick<
  Database['public']['Tables']['q_a_pairs']['Row'],
  'id' | 'question_text' | 'superseded_by' | 'publication_status'
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
  question_text: string;
  superseded_by: string | null;
  publication_status: string;
}

/** @public */
export interface SetSupersessionParams {
  oldId: string;
  newId: string;
  actorUserId: string;
  /**
   * Free-text reason for retiring the OLD row. q_a_pairs has no
   * `archive_reason` column (ID-131.37 F1 re-point onto the id-120 model)
   * — this is captured on the Sentry breadcrumb for audit visibility only,
   * not persisted to a DB column.
   *
   * Optional — defaults to `Superseded by item ${newId}` when omitted, so
   * existing callers (PATCH /api/items/:id, MCP supersede_content_item)
   * require no source changes.
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
 * ID-131.37 F1 (owner S446 ruling) — q_a_pairs archived model:
 *   The OLD row's `superseded_by` is set to `newId` and its
 *   `publication_status` flips to `'archived'`, unifying the "retired"
 *   concept under the id-120 archived model on the two columns q_a_pairs
 *   actually carries. There is no q_a_pairs equivalent of the prior
 *   `dedup_status`/archive-metadata dual-write (S216 §6.5/§6.6) — those
 *   writes are dropped, not silently mis-targeted.
 *
 * @param params.oldId — the row being retired (its `superseded_by` gets set)
 * @param params.newId — the row that replaces it (untouched)
 * @param params.actorUserId — UUID for audit context. q_a_pairs has no
 *   `archived_by`/`updated_by` columns to persist it to, so it is recorded
 *   on the Sentry breadcrumb only.
 * @param params.archiveReason — optional free-text reason for the archive
 *   side-effect, recorded on the Sentry breadcrumb only (q_a_pairs has no
 *   `archive_reason` column). Defaults to `Superseded by item ${newId}`
 *   when omitted.
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
    sb<QaPairSupersessionRow | null>(
      client
        .from('q_a_pairs')
        .select('id, question_text, superseded_by, publication_status')
        .eq('id', oldId)
        .maybeSingle(),
      'supersession.load_old',
    ),
    sb<QaPairSupersessionRow | null>(
      client
        .from('q_a_pairs')
        .select('id, question_text, superseded_by, publication_status')
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

  // ID-131.37 F1 — q_a_pairs archived model. Only the two columns q_a_pairs
  // carries: `superseded_by` (pointer) + `publication_status='archived'`
  // (retired state). No archive-metadata columns to write.
  const resolvedArchiveReason = archiveReason ?? `Superseded by item ${newId}`;
  const updated = await sb<QaPairSupersessionRow>(
    client
      .from('q_a_pairs')
      .update({
        superseded_by: newId,
        publication_status: 'archived',
      })
      .eq('id', oldId)
      .select('id, question_text, superseded_by, publication_status')
      .single(),
    'supersession.update_old',
  );

  // Operational audit breadcrumb — Sentry.addBreadcrumb is a no-op when the
  // SDK is unconfigured (tests, CLI), so no try/catch needed. actorUserId +
  // archiveReason have no q_a_pairs column to land in (see doc comment
  // above), so this breadcrumb is their only audit trail.
  Sentry.addBreadcrumb({
    category: 'supersession.set',
    message: `Item ${oldId} superseded by ${newId}`,
    level: 'info',
    data: {
      oldId,
      newId,
      actorUserId,
      archiveReason: resolvedArchiveReason,
      oldQuestionText: oldRow.question_text,
      newQuestionText: newRow.question_text,
    },
    timestamp: Date.now() / 1000,
  });

  return {
    oldItem: updated,
    newItem: {
      id: newRow.id,
      question_text: newRow.question_text,
      superseded_by: newRow.superseded_by,
      publication_status: newRow.publication_status,
    },
  };
}
