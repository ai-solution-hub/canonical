import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { tryQuery } from '@/lib/supabase/safe';
import { createServiceClient } from '@/lib/supabase/server';
import { parseBody } from '@/lib/validation';
import { EntityMergeBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const EntityMergeResponseSchema = z.object({
  merged: z.boolean(),
  target: z.string(),
  entity_type: z.string(),
  mentions_updated: z.number(),
  duplicates_removed: z.number(),
  // id-400 (Inv-9 RESHAPE — curation pinning): surviving target rows stamped
  // `metadata.curation_pinned = true` post-merge; the ingestion walk may
  // never UPDATE/DELETE a pinned row (stage_5.py + flow.py honour the pin).
  // id-405: this count is the pin statement's own ROW_COUNT — authoritative
  // (uncapped, and all-or-nothing) rather than a tally of per-row writes.
  mentions_pinned: z.number(),
  // Present ONLY when the post-merge pin step faulted. Distinguishes "pin
  // step failed" from an honest "0 mentions to pin" — the merge itself has
  // already committed either way.
  mentions_pin_error: z.string().optional(),
});

export const POST = defineRoute(
  EntityMergeResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user } = auth;

      const { allowed } = checkRateLimit(
        `entities:merge:${user.id}`,
        10,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(EntityMergeBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { sources, target, entity_type } = parsed.data;

      // All source canonical names (including target if present)
      const allSourceNames = [...new Set([...sources, target])];

      // Use service client for atomic RPC merge
      const serviceClient = createServiceClient();

      // Single atomic RPC call — all updates happen in one transaction
      const { data, error } = await serviceClient.rpc('merge_entities', {
        p_source_names: allSourceNames,
        p_target_name: target,
        p_entity_type: entity_type,
      });

      if (error) {
        return NextResponse.json(
          { error: safeErrorMessage(error, 'Failed to merge entities') },
          { status: 500 },
        );
      }

      // ID-70: merge_entities now returns a single typed row (RETURNS TABLE).
      const result = data?.[0];
      if (!result) {
        return NextResponse.json(
          { error: 'Merge returned no result' },
          { status: 500 },
        );
      }

      // id-400 (Inv-9 RESHAPE — curation pinning, TRIAGE §3.1.4): stamp the
      // surviving target rows `metadata.curation_pinned = true` so the
      // ingestion walk can never revert this merge — census #41 failure #1
      // (admin merge reverted on a later walk) is the live symptom this
      // closes. The pipeline honours the pin at three sites: the Stage-5
      // write-back domain + cross-op survivor rule (stage_5.py) and the
      // em-declare carry-forward (flow.py). The merge itself has already
      // committed atomically via the RPC, so a pin-stamp fault never 500s
      // (that would misreport the committed merge as failed) — it is logged
      // and surfaced explicitly via `mentions_pin_error`, distinguishing
      // "pin step failed" from an honest "0 mentions to pin".
      //
      // id-405 (migration 20260730150743): ONE set-based UPDATE, not a read
      // plus a per-row UPDATE loop. `pin_entity_mentions` matches on the
      // EFFECTIVE type (COALESCE(entity_type_override, entity_type)) — the
      // column `merge_entities` actually writes — and returns its own
      // ROW_COUNT, so the pin is atomic (never partial), uncapped (the old
      // read stopped at 1000 rows) and the count below is authoritative.
      let mentionsPinned = 0;
      let mentionsPinError: string | undefined;
      const pinResult = await tryQuery<number>(
        serviceClient.rpc('pin_entity_mentions', {
          p_canonical_name: result.target,
          p_entity_type: result.entity_type,
        }),
        'entity_mentions.curationPin',
      );
      if (pinResult.ok) {
        mentionsPinned = pinResult.data ?? 0;
      } else {
        logger.error(
          { err: pinResult.error, target: result.target },
          'entities/merge: curation pin failed after committed merge — surviving rows are UNPINNED and a later walk may revert the merge',
        );
        mentionsPinError = safeErrorMessage(
          pinResult.error,
          'Pin step failed: surviving mentions could not be pinned',
        );
      }

      return NextResponse.json({
        merged: result.merged,
        target: result.target,
        entity_type: result.entity_type,
        mentions_updated: result.mentions_updated,
        duplicates_removed: result.duplicates_removed,
        mentions_pinned: mentionsPinned,
        ...(mentionsPinError !== undefined
          ? { mentions_pin_error: mentionsPinError }
          : {}),
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to merge entities') },
        { status: 500 },
      );
    }
  },
);
