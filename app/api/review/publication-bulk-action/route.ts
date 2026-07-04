/**
 * POST /api/review/publication-bulk-action — bulk-approve / bulk-return-to-draft
 * for items currently in publication_status='in_review' (§5.3 publication
 * approval gate, Wave 1 server surface).
 *
 * Spec: .planning/.archive/.specs/publication-approval-gate-spec.md §4 + §5 + §6 + §7 (archived S220 W4).
 *
 * Mirrors per-row PATCH semantics at `app/api/items/[id]/route.ts:199-365`
 * for `field='publication_status'`, but iterates over `body.ids` sequentially
 * inside the route handler. Each per-item iteration:
 *
 * 1. SELECTs current state (via `.maybeSingle()` — null → not_found).
 * 2. Pre-loop guard (§5.3 / D-10): if `fromStatus !== 'in_review'`, push
 *    `{ status: 'conflict' }` regardless of role/action. Defence-in-depth
 *    on top of the `.eq('publication_status', 'in_review')` UPDATE filter
 *    so bulk-callers cannot silently flip `'published'` rows to `'draft'`
 *    via `action='return_to_draft'`. AC-bulk-2.5 + AC-bulk-2.10.
 * 3. Role-gate via `computeAllowedTransitions` — empty array OR target not
 *    in array → `{ status: 'forbidden' }`.
 * 4. Optimistic-concurrency UPDATE — `.update(...).eq('id', id)
 *    .eq('publication_status', fromStatus)`. PGRST116 (zero rows matched)
 *    → `{ status: 'conflict' }`. Other PG errors → `{ status: 'error' }`.
 * 5. content_history INSERT via `sb()` — `change_reason='bulk_approve'` or
 *    `'bulk_return_to_draft'`, `change_type='publication_state'`. Mirrors
 *    PATCH route insert shape at line 343-357.
 *
 * Response is ALWAYS HTTP 200 with `{ totalRequested, successCount,
 * failureCount, results }`. Outer try/catch returns 500 on route-level
 * crashes (mirrors `app/api/review/queue/route.ts:320-325`).
 *
 * Decisions ratified S217 W7:
 * - D-3 cap = 50 items per request (NOT authored 100). Halves 30s timeout
 *   exposure under DB-load spikes; trivial to relax later, painful to
 *   tighten later.
 * - D-8 rate limit = 20 req/min per user (NOT authored 10). Aligns with
 *   `POST /api/items/` mutation baseline.
 *
 * @see .planning/.archive/.specs/publication-approval-gate-spec.md §4.3 for verbatim
 *      iteration pseudocode and §4.4 for response-shape contract.
 */
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import {
  applyTransitionSideEffects,
  computeAllowedTransitions,
  type PublicationStatus,
} from '@/lib/governance/publication-transitions';
import { checkRateLimit } from '@/lib/rate-limit';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { PublicationBulkActionBodySchema } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

/** Per-item-result statuses surfaced in the response array. */
type PublicationBulkActionResultStatus =
  | 'success'
  | 'conflict'
  | 'forbidden'
  | 'not_found'
  | 'error';

/** Per-item result envelope — one entry per requested id. */
interface PublicationBulkActionResult {
  id: string;
  status: PublicationBulkActionResultStatus;
  previousStatus?: PublicationStatus;
  newStatus?: PublicationStatus;
  reason?: string;
  error?: string;
}

/** Top-level response envelope. */
interface PublicationBulkActionResponse {
  action: 'approve' | 'return_to_draft';
  totalRequested: number;
  successCount: number;
  failureCount: number;
  results: PublicationBulkActionResult[];
}

// Mirrors PublicationBulkActionResponse / PublicationBulkActionResult above.
// PublicationStatus = 'draft' | 'in_review' | 'published' | 'archived'.
const PublicationBulkActionResultSchema = z.object({
  id: z.string(),
  status: z.enum(['success', 'conflict', 'forbidden', 'not_found', 'error']),
  previousStatus: z
    .enum(['draft', 'in_review', 'published', 'archived'])
    .optional(),
  newStatus: z.enum(['draft', 'in_review', 'published', 'archived']).optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
});

const PublicationBulkActionResponseSchema = z.object({
  action: z.enum(['approve', 'return_to_draft']),
  totalRequested: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
  results: z.array(PublicationBulkActionResultSchema),
});

export const POST = defineRoute(
  PublicationBulkActionResponseSchema,
  async (request: NextRequest) => {
    try {
      // -----------------------------------------------------------------
      // Auth + role check — admin + editor permitted (PR-1: §5.2 RBAC
      // matrix preserved). Per-item role-gate happens inside the loop.
      // -----------------------------------------------------------------
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase, role } = auth;

      // -----------------------------------------------------------------
      // Rate limit: 20 req/min (D-8 RATIFIED S217 close-out — matches the
      // `POST /api/items/` mutation baseline, NOT the authored 10).
      // -----------------------------------------------------------------
      const { allowed } = checkRateLimit(
        `review-publication-bulk:${user.id}`,
        20,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      // -----------------------------------------------------------------
      // Body validation. Use `parseBody` per
      // `feedback_validation_sweep_safeparse_ban` — inline schema-parse calls
      // in route files are banned by the validation-sweep guard test.
      // -----------------------------------------------------------------
      const raw = await request.json();
      const validated = parseBody(PublicationBulkActionBodySchema, raw);
      if (!validated.success) return validated.response;
      const { ids, action } = validated.data;

      // Map action → target publication_status. Both transitions are valid
      // out of 'in_review' per the §5.2 transition matrix (admin + editor).
      const newStatus: PublicationStatus =
        action === 'approve' ? 'published' : 'draft';

      // -----------------------------------------------------------------
      // Per-item iteration. SEQUENTIAL (not Promise.all) — parallel
      // iteration would multiply the read-after-write race window per item;
      // sequential preserves a clear fetch-then-update order per row.
      // Acceptable cost given the 50-item cap (~2.5s typical, well under
      // the 30s Vercel function budget).
      // -----------------------------------------------------------------
      const results: PublicationBulkActionResult[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const id of ids) {
        // Step 1: Fetch current state. ID-131 {131.19}: content_items is
        // dying — publication_status now lives on the owning source_documents
        // row (BI-20 inline hot). title/content/brief/detail/reference are
        // content_history-insert-only fields with NO typed-record home post-
        // refactor (TECH.md BI-11 drops brief/detail/reference; content_history
        // itself is dropped at M6 — the insert below becomes fully vestigial
        // once that lands, out of this Subtask's scope) — the content_history
        // insert at step 5 now uses fallback empty values instead of a fetch.
        const { data: current, error: fetchErr } = await supabase
          .from('source_documents')
          .select('id, publication_status')
          .eq('id', id)
          .maybeSingle();

        if (fetchErr) {
          results.push({ id, status: 'error', error: fetchErr.message });
          failureCount++;
          continue;
        }
        if (!current) {
          // Either truly missing or RLS-hidden from the caller. Both surface
          // identically per spec §7.1 — `'not_found'` is the canonical
          // status for "row is not visible to this caller".
          results.push({ id, status: 'not_found' });
          failureCount++;
          continue;
        }

        const fromStatus = current.publication_status as PublicationStatus;

        // Step 2: Pre-loop fromStatus guard (§5.3 / D-10).
        // Defence-in-depth on top of the `.eq('publication_status',
        // 'in_review')` UPDATE filter at step 4. Without this guard,
        // `action='return_to_draft'` against a 'published' row would
        // silently flip live content to draft (because
        // `computeAllowedTransitions('published', 'admin')` returns
        // ['archived', 'draft']). With the guard, any row whose
        // `fromStatus !== 'in_review'` returns `{ status: 'conflict' }`
        // regardless of role or action. AC-bulk-2.5 + AC-bulk-2.10.
        if (fromStatus !== 'in_review') {
          results.push({
            id,
            status: 'conflict',
            previousStatus: fromStatus,
            reason: `Pre-loop guard: fromStatus '${fromStatus}' is not 'in_review'; bulk endpoint only transitions out of 'in_review'.`,
          });
          failureCount++;
          continue;
        }

        // Step 3: Role-gate via `computeAllowedTransitions`.
        // Same helper as the per-row PATCH — preserves the §5.2 RBAC matrix
        // verbatim (PR-1). For 'in_review' the matrix returns
        // ['published', 'draft'] for admin + editor and [] for viewer; the
        // role gate at the route boundary already excluded viewer, so this
        // path is reachable only in role-set drift edge cases.
        const allowed = computeAllowedTransitions(fromStatus, role);
        if (allowed.length === 0 || !allowed.includes(newStatus)) {
          results.push({
            id,
            status: 'forbidden',
            previousStatus: fromStatus,
            reason: `Role '${role}' cannot transition '${fromStatus}' -> '${newStatus}'`,
          });
          failureCount++;
          continue;
        }

        // Step 4: Optimistic-concurrency UPDATE.
        // `.eq('publication_status', fromStatus)` is the optimistic
        // concurrency guard — if a concurrent writer raced ahead and
        // changed the state, this UPDATE matches zero rows and `.single()`
        // returns PGRST116. Mirrors PATCH route line 299-322.
        //
        // `applyTransitionSideEffects` extends the base payload with
        // `publication_status: newStatus` and (for archive transitions
        // only) archive metadata. For the `in_review → {published, draft}`
        // transitions the bulk endpoint covers, no archive metadata is
        // touched — same path as the per-row PATCH for these targets.
        const { data: updated, error: updateErr } = await supabase
          .from('source_documents')
          .update(
            applyTransitionSideEffects(
              {
                publication_status: newStatus,
                updated_by: user.id,
              },
              fromStatus,
              newStatus,
              user.id,
            ) as Database['public']['Tables']['source_documents']['Update'],
          )
          .eq('id', id)
          .eq('publication_status', fromStatus)
          .select('id, publication_status')
          .single();

        if (updateErr) {
          if (updateErr.code === 'PGRST116') {
            // Race-loss: row's publication_status changed between fetch
            // and update.
            results.push({
              id,
              status: 'conflict',
              previousStatus: fromStatus,
              reason: 'Concurrent state change detected.',
            });
            failureCount++;
            continue;
          }
          results.push({ id, status: 'error', error: updateErr.message });
          failureCount++;
          continue;
        }
        void updated;

        // Step 5: content_history INSERT via `sb()` (fail-fast).
        //
        // `change_reason` carries the BULK literal (`'bulk_approve'` /
        // `'bulk_return_to_draft'`) — distinct from the per-row PATCH
        // phrasing `'Transition from in_review to published'`. This is the
        // primary motivation for a server-side bulk endpoint vs a client
        // loop-over-PATCH (spec §2.3 — audit-trail semantic preservation).
        //
        // `version` is set automatically by the
        // `auto_version_content_history` BEFORE INSERT trigger; payload
        // omits it. The Insert TS type marks `version` required, so the
        // payload is cast to the table's Insert shape — same pattern as
        // PATCH route line 355.
        //
        // change_reason is always present, satisfying the S153 guard test
        // (`feedback_content_history_change_reason_mandatory`).
        const changeReasonLiteral =
          action === 'approve' ? 'bulk_approve' : 'bulk_return_to_draft';

        // ID-131 {131.19}: title/content/brief/detail/reference have no
        // typed-record home post-refactor (BI-11 drop list) — content_history
        // itself is dropped wholesale at M6, so this insert is a documented,
        // bounded degradation (empty/null placeholders) rather than a fetch
        // from a column that no longer has a source.
        await sb(
          supabase.from('content_history').insert({
            content_item_id: id,
            title: '',
            content: '',
            brief: null,
            detail: null,
            reference: null,
            change_summary: `Publication status: ${fromStatus} -> ${newStatus}`,
            change_reason: changeReasonLiteral,
            change_type: 'publication_state',
            created_by: user.id,
          } as Database['public']['Tables']['content_history']['Insert']),
          'review.publication_bulk_action.history_insert',
        );

        results.push({
          id,
          status: 'success',
          previousStatus: fromStatus,
          newStatus,
        });
        successCount++;
      }

      const response: PublicationBulkActionResponse = {
        action,
        totalRequested: ids.length,
        successCount,
        failureCount,
        results,
      };
      return NextResponse.json(response);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to process bulk action') },
        { status: 500 },
      );
    }
  },
);
