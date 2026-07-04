/**
 * GET /api/admin/provenance/export/verification-history
 *
 * Admin-only endpoint that generates a downloadable PDF of verification
 * history for a given date range.
 *
 * Query params:
 *   from  - YYYY-MM-DD (default: today - 30 days)
 *   to    - YYYY-MM-DD (default: today)
 *
 * Returns application/pdf with Content-Disposition attachment.
 */

import type { VerificationRow } from '@/components/provenance/report-document';
import ReportDocument from '@/components/provenance/report-document';
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { sb } from '@/lib/supabase/safe';
import { resolveUserDisplayNames } from '@/lib/users/display-names';
import { parseSearchParams } from '@/lib/validation';
import { VerificationHistoryExportParamsSchema } from '@/lib/validation/schemas';
import { renderToBuffer } from '@react-pdf/renderer';
import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { z } from 'zod';

export const maxDuration = 60;

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = thirtyDaysAgo.toISOString().slice(0, 10);
  return { from, to };
}

// ──────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────

// The only 2xx return is a binary application/pdf NextResponse (Uint8Array),
// not a JSON body — defineRoute never validates non-JSON 2xx responses, so this
// schema is unreachable at runtime; z.unknown() documents the opaque PDF stream.
const VerificationHistoryExportResponseSchema = z.unknown();

export const GET = defineRoute(
  VerificationHistoryExportResponseSchema,
  async (request: NextRequest) => {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    // Parse + validate query params
    const parsed = parseSearchParams(
      VerificationHistoryExportParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    const defaults = defaultDateRange();
    const from = parsed.data.from ?? defaults.from;
    const to = parsed.data.to ?? defaults.to;

    // Date range for query: from 00:00:00 to to 23:59:59
    const fromIso = `${from}T00:00:00.000Z`;
    const toIso = `${to}T23:59:59.999Z`;

    try {
      // Query verification_history joined with source_documents for titles.
      // ID-131 {131.29} re-parent: content_item_id -> source_document_id.
      // NOTE: governance_review_status moved to the record_lifecycle facet
      // (PRODUCT BI-20), but api.record_lifecycle does not exist yet — it is
      // authored by {131.19}'s whole-surface regen. Until then the exported
      // governance_status is always null (see the mapping below); a follow-up
      // should re-wire this via a facet lookup (owner_kind='source_document',
      // owner_id=source_document_id) once that view lands.
      const rawRows = await sb(
        supabase
          .from('verification_history')
          .select(
            'id, source_document_id, action_type, performed_by, performed_at, note, source_documents!inner(suggested_title)',
          )
          .gte('performed_at', fromIso)
          .lte('performed_at', toIso)
          .order('performed_at', { ascending: false })
          .limit(5000),
        'provenance.export.verification_history',
      );

      // Resolve reviewer display names
      const performerIds = [
        ...new Set(
          rawRows.map((r: Record<string, unknown>) => r.performed_by as string),
        ),
      ];
      let displayNames = new Map<string, { display_name: string }>();
      try {
        displayNames = await resolveUserDisplayNames(supabase, performerIds);
      } catch {
        // Fall back to user IDs if display name resolution fails (OQ-5 RLS)
      }

      // Resolve the exporter's display name
      let exporterName = 'Admin';
      try {
        const exporterNames = await resolveUserDisplayNames(supabase, [
          user.id,
        ]);
        const info = exporterNames.get(user.id);
        if (info) exporterName = info.display_name;
      } catch {
        // Fall back to 'Admin'
      }

      // Map to report rows
      const rows: VerificationRow[] = rawRows.map(
        (r: Record<string, unknown>) => {
          const sourceDocument = r.source_documents as Record<
            string,
            unknown
          > | null;
          const performerId = r.performed_by as string;
          const nameInfo = displayNames.get(performerId);

          return {
            id: r.id as string,
            source_document_id: r.source_document_id as string,
            action_type: r.action_type as string,
            performed_by: performerId,
            performed_at: r.performed_at as string,
            note: r.note as string | null,
            title: (sourceDocument?.suggested_title as string | null) ?? null,
            reviewer_name: nameInfo?.display_name ?? 'A team member',
            // governance_status is not sourced today — see the query comment
            // above (api.record_lifecycle doesn't exist until {131.19}).
            governance_status: null,
          };
        },
      );

      // Generate PDF
      const element = React.createElement(ReportDocument, {
        rows,
        from,
        to,
        generatedBy: exporterName,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- renderToBuffer expects ReactElement<DocumentProps> but JSX.Element is structurally compatible
      const pdfBuffer = await renderToBuffer(element as any);

      // Log access
      await recordPipelineRun({
        supabase,
        pipelineName: 'provenance_audit_pdf',
        status: 'completed',
        itemsProcessed: rows.length,
        result: {
          from,
          to,
          row_count: rows.length,
          exported_by: user.id,
        },
      });

      // Return PDF response — convert Buffer to Uint8Array for NextResponse
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="verification-history-${from}-to-${to}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      // Log failed export
      await recordPipelineRun({
        supabase,
        pipelineName: 'provenance_audit_pdf',
        status: 'failed',
        errorMessage:
          err instanceof Error ? err.message : 'Unknown export error',
        result: { from, to, exported_by: user.id },
      });

      return NextResponse.json(
        {
          error: safeErrorMessage(
            err,
            'Failed to generate verification history PDF',
          ),
        },
        { status: 500 },
      );
    }
  },
);
