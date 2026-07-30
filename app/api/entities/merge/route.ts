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
  mentions_pinned: z.number(),
  // Present ONLY when the post-merge pin step faulted (read or one/more
  // writes failed). Distinguishes "pin step failed" from an honest
  // "0 mentions to pin" — the merge itself has already committed either way.
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
      // Accepted follow-up (PR #156 review): collapse the read + per-row
      // UPDATE loop into ONE set-based UPDATE via an RPC using jsonb_set
      // (metadata = jsonb_set(coalesce(metadata,'{}'), '{curation_pinned}',
      // 'true') WHERE canonical_name/entity_type match). Deferred because the
      // migration-serial gate binds this PR — per-row UPDATEs stay for now,
      // with the read explicitly bounded below.
      const PIN_READ_CAP = 1000;
      let mentionsPinned = 0;
      let mentionsPinError: string | undefined;
      const pinRead = await tryQuery(
        serviceClient
          .from('entity_mentions')
          .select('id, metadata')
          .eq('canonical_name', result.target)
          .eq('entity_type', result.entity_type)
          .limit(PIN_READ_CAP),
        'entity_mentions.curationPinRead',
      );
      if (!pinRead.ok) {
        logger.error(
          { err: pinRead.error, target: result.target },
          'entities/merge: curation-pin read failed after committed merge — surviving rows are UNPINNED and a later walk may revert the merge',
        );
        mentionsPinError = safeErrorMessage(
          pinRead.error,
          'Pin step failed: could not read surviving mentions',
        );
      } else {
        for (const row of pinRead.data ?? []) {
          const existing =
            row.metadata && typeof row.metadata === 'object'
              ? (row.metadata as Record<string, unknown>)
              : {};
          const pinWrite = await tryQuery(
            serviceClient
              .from('entity_mentions')
              .update({ metadata: { ...existing, curation_pinned: true } })
              .eq('id', row.id),
            'entity_mentions.curationPinWrite',
          );
          if (pinWrite.ok) {
            mentionsPinned += 1;
          } else {
            logger.error(
              { err: pinWrite.error, mentionId: row.id, target: result.target },
              'entities/merge: curation-pin write failed — this mention is UNPINNED and a later walk may revert it',
            );
            mentionsPinError ??= safeErrorMessage(
              pinWrite.error,
              'Pin step failed: one or more mentions could not be pinned',
            );
          }
        }
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
