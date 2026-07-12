import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { tryQuery } from '@/lib/supabase/safe';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  ProcurementCreateBodySchema,
  ProcurementListParamsSchema,
  parseProcurementMetadata,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// GET returns a paged list of procurement workspaces. Each bid is the selected
// `workspaces` row (application_types projection stripped) with `domain_metadata`
// replaced by the parsed procurement metadata (or the raw jsonb on parse-fail)
// and a `question_stats` enrichment. The selected columns are nullable DB
// values; `status` is .optional() (absent on some 2xx projections).
const ProcurementBidSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  // domain_metadata is parsed ProcurementMetadata when valid, else the raw
  // jsonb value passed through — opaque jsonb either way.
  domain_metadata: z.unknown(),
  is_archived: z.boolean().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  // question_stats is the get_form_question_stats[_batch] RPC `Json` row or
  // null — opaque RPC return per OPS-T1 rule 4.
  question_stats: z.unknown(),
});
const GetProcurementResponseSchema = z.object({
  procurements: z.array(ProcurementBidSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  // Sibling field present only when the per-bid stats fallback produced a
  // failure (H13 "absent when empty" convention).
  failed_procurement_ids: z.array(z.string()).optional(),
});
export const GET = defineRoute(
  GetProcurementResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const parsed = parseSearchParams(
        ProcurementListParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const { status, limit, offset } = parsed.data;

      // Post-T2: discriminator is application_type_id via application_types join.
      // 'bid' → 'procurement' per Q-OQR1-02.
      let query = supabase
        .from('workspaces')
        .select(
          'id, name, description, status, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by, application_types!inner(key)',
          { count: 'exact' },
        )
        .eq('application_types.key', 'procurement')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data: workspaces, error, count } = await query;

      if (error) {
        logger.error({ err: error }, 'Failed to fetch bids');
        return NextResponse.json(
          { error: 'Failed to fetch bids' },
          { status: 500 },
        );
      }

      // Enrich each bid with question statistics (batch to avoid N+1)
      const procurementIds = (workspaces ?? []).map((p) => p.id);
      const statsMap = new Map<string, Record<string, unknown>>();
      // Track per-bid stats failures so the response can surface them as a
      // sibling `failed_procurement_ids` field. Mirrors the H13 pattern in
      // `app/api/freshness/calculate/route.ts` (S151 silent-failure remediation).
      const failedProcurementIds: string[] = [];

      if (procurementIds.length > 0) {
        const { data: batchStats, error: batchError } = await supabase.rpc(
          'get_form_question_stats_batch',
          { p_project_ids: procurementIds },
        );

        if (batchError) {
          // Fallback to per-bid calls if batch RPC doesn't exist
          logger.warn(
            { err: batchError.message },
            'Batch stats RPC unavailable, falling back to per-bid calls',
          );
          const fallbackResults = await Promise.all(
            procurementIds.map(async (procurementId) => {
              const { data: stats, error: statsError } = await supabase.rpc(
                'get_form_question_stats',
                {
                  p_project_id: procurementId,
                },
              );
              if (statsError) {
                logger.error(
                  { err: statsError, procurementId },
                  'Per-bid stats RPC failed (fallback path) for bid',
                );
                return { procurementId, stats: null, failed: true };
              }
              return {
                procurementId,
                stats: stats?.[0] ?? null,
                failed: false,
              };
            }),
          );
          for (const { procurementId, stats, failed } of fallbackResults) {
            if (stats) statsMap.set(procurementId, stats);
            if (failed) failedProcurementIds.push(procurementId);
          }
        } else if (batchStats) {
          for (const row of batchStats) {
            statsMap.set(row.workspace_id, row);
          }
        }
      }

      // Strip the joined application_types projection from the response shape —
      // callers only need the flat workspace fields plus enrichments.
      const bids = (workspaces ?? []).map((workspace) => {
        const { application_types: _appTypes, ...wsRest } = workspace;
        return {
          ...wsRest,
          domain_metadata:
            parseProcurementMetadata(wsRest.domain_metadata) ??
            wsRest.domain_metadata,
          question_stats: statsMap.get(wsRest.id) ?? null,
        };
      });

      // `failed_procurement_ids` is a sibling field, only present when the
      // fallback loop produced at least one failure. Matches the H13 "absent
      // when empty" convention so existing consumers see no shape change in
      // the happy path.
      const response: {
        procurements: typeof bids;
        total: number;
        limit: number;
        offset: number;
        failed_procurement_ids?: string[];
      } = {
        procurements: bids,
        total: count ?? bids.length,
        limit,
        offset,
      };
      if (failedProcurementIds.length > 0) {
        response.failed_procurement_ids = failedProcurementIds;
      }
      return NextResponse.json(response);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch bids') },
        { status: 500 },
      );
    }
  },
);

/**
 * `estimated_value` is a free-text field in the creation wizard (placeholder
 * "e.g. £50,000") but a native `numeric` column on `form_instances`
 * post-{145.6} M3 (BI-5 — first-class form attribute, no longer nested,
 * unvalidated JSONB). Strip everything but digits/decimal point and
 * best-effort parse; unparseable/empty input maps to NULL rather than
 * rejecting the whole create — the field is optional and the common failure
 * mode is a stray currency symbol or thousands separator, not malicious
 * input.
 */
function parseEstimatedValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// POST mints the item's `form_instances` row directly (ID-145 {145.8},
// BI-7) — the item IS the form, never a bare `workspaces` row (the
// born-formless root cause: the pre-{145.8} handler inserted only
// `.from('workspaces')`, RESEARCH §6 root cause 1). The FormTypePicker's
// confirmed choice (`form_type`) is required, never silently defaulted
// (B-14 precedent, ARCH-REVIEW §6 BI-11 gate carries over unchanged).
const CreateFormInstanceBodySchema = ProcurementCreateBodySchema.extend({
  // The closed CV enum lives in `api.form_types` (DB) + the
  // `form_instances_form_type_fkey` FK — Zod only guards shape here rather
  // than duplicating the 7-value tuple a third time (server
  // `lib/validation/schemas.ts` and client `form-type-picker.tsx` already
  // keep their own compile-time copies for documented reasons, and neither
  // file is in this Subtask's file-ownership boundary).
  form_type: z.string().trim().min(1, 'Form type is required').max(50),
});

// Response = the created `form_instances` row (the item IS the form,
// BI-1/BI-7) — replaces the pre-{145.8} bare `workspaces` row projection.
// `estimated_value` is the native numeric column (see parseEstimatedValue).
const ProcurementCreateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  form_type: z.string().nullable().optional(),
  processing_status: z.string().nullable().optional(),
  workflow_state: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  issuing_organisation: z.string().nullable().optional(),
  reference_number: z.string().nullable().optional(),
  estimated_value: z.number().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
export const POST = defineRoute(
  ProcurementCreateResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { allowed } = checkRateLimit(
        `procurement-create:${user.id}`,
        10,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(CreateFormInstanceBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const {
        name,
        description,
        buyer,
        deadline,
        reference_number,
        estimated_value,
        notes,
        form_type,
      } = parsed.data;

      // ID-145 {145.8} (BI-7): mint the form_instances row directly — no
      // `workspaces` insert, no `application_types` resolution (that
      // discriminator belongs to the workspace stratum, which W1 (M5)
      // deletes wholesale for procurement; form_instances carries no
      // workspace concept post-{145.6} M3). No document exists yet at
      // blank-creation time, so the doc-identity columns get the
      // {130.13}-style placeholder mint convention; `ingest_source='minted'`
      // is the re-cut CHECK's reserved value for exactly this docless-mint
      // case (never 'app_upload', which now means a real uploaded document —
      // TECH.md §2 M3).
      const insertResult = await tryQuery<Record<string, unknown>>(
        supabase
          .from('form_instances')
          .insert({
            name,
            // `notes`/`tender_source`/`outcome_notes` predate the form-first
            // model and have no column home post-{145.6} M3 (die with the
            // workspace rows, BI-5). Fold `notes` into `description` (the
            // one free-text column that survives) rather than silently
            // dropping the caller's input.
            description: description?.trim() || notes?.trim() || null,
            issuing_organisation: buyer,
            deadline: deadline ?? null,
            reference_number: reference_number ?? null,
            estimated_value: parseEstimatedValue(estimated_value),
            form_type,
            filename: 'app-created-form.pdf',
            storage_path: `app-created/${crypto.randomUUID()}`,
            file_size: 0,
            mime_type: 'application/pdf',
            ingest_source: 'minted',
            created_by: user.id,
          })
          .select(
            'id, name, description, form_type, processing_status, workflow_state, deadline, issuing_organisation, reference_number, estimated_value, created_by, created_at, updated_at',
          )
          .single(),
        'procurement.create',
      );

      if (!insertResult.ok) {
        logger.error(
          { err: insertResult.error },
          'Failed to create procurement item',
        );
        return NextResponse.json(
          { error: 'Failed to create procurement item' },
          { status: 500 },
        );
      }

      return NextResponse.json(insertResult.data, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(err, 'Failed to create procurement item'),
        },
        { status: 500 },
      );
    }
  },
);
