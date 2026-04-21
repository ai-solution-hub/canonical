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
 * Spec: docs/specs/supersession-model-spec.md §5.4
 * Plan: docs/plans/supersession-model-plan.md §B.2
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';

// Local types bridging the gap until WP-B.7 regenerates
// `supabase/types/database.types.ts` with the superseded_by column added
// in WP-B.1. The generated Row/Update shapes don't know about the column
// yet; intersecting here keeps the helper strongly typed at call sites
// without forcing a mid-session types regen
// (feedback_no_midsession_type_regen).
type ContentItemUpdate =
  Database['public']['Tables']['content_items']['Update'] & {
    superseded_by?: string | null;
  };

type ContentItemSupersessionRow = Pick<
  Database['public']['Tables']['content_items']['Row'],
  'id' | 'title' | 'dedup_status'
> & { superseded_by: string | null };

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

export interface SetSupersessionParams {
  oldId: string;
  newId: string;
  actorUserId: string;
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
 * @param params.oldId — the row being retired (its `superseded_by` gets set)
 * @param params.newId — the row that replaces it (untouched)
 * @param params.actorUserId — UUID for audit context (not persisted to DB
 *   here; callers that need a `content_history` entry write their own
 *   snapshot per the archive/delete precedent in governance tools)
 * @param client — authorised Supabase client (RLS scoped or service role)
 */
export async function setSupersession(
  params: SetSupersessionParams,
  client: SupabaseClient<Database>,
): Promise<SetSupersessionResult> {
  const { oldId, newId, actorUserId } = params;

  if (oldId === newId) {
    throw new SupersessionError(
      'SAME_ID',
      'Cannot supersede an item with itself',
      { oldId, newId },
    );
  }

  // Load both rows. Using maybeSingle so "not found" is data=null, not an
  // error — lets us map to a specific error code instead of a generic PGRST116.
  const [oldRow, newRow] = (await Promise.all([
    sb(
      client
        .from('content_items')
        .select('id, title, superseded_by, dedup_status')
        .eq('id', oldId)
        .maybeSingle(),
      'supersession.load_old',
    ),
    sb(
      client
        .from('content_items')
        .select('id, title, superseded_by, dedup_status')
        .eq('id', newId)
        .maybeSingle(),
      'supersession.load_new',
    ),
  ])) as unknown as [
    ContentItemSupersessionRow | null,
    ContentItemSupersessionRow | null,
  ];

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

  const updatePayload: ContentItemUpdate = {
    superseded_by: newId,
    dedup_status: 'superseded',
  };
  const updated = (await sb(
    client
      .from('content_items')
      .update(updatePayload as ContentItemUpdate)
      .eq('id', oldId)
      .select('id, title, superseded_by, dedup_status')
      .single(),
    'supersession.update_old',
  )) as unknown as ContentItemSupersessionRow;

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
