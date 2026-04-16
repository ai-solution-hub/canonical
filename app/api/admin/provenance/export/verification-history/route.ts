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

import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { parseSearchParams } from '@/lib/validation';
import { VerificationHistoryExportParamsSchema } from '@/lib/validation/schemas';
import { resolveUserDisplayNames } from '@/lib/users/display-names';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { safeErrorMessage } from '@/lib/error';
import ReportDocument from '@/components/provenance/report-document';
import type { VerificationRow } from '@/components/provenance/report-document';

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

export async function GET(request: NextRequest) {
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
    // Query verification_history joined with content_items for titles
    const rawRows = await sb(
      supabase
        .from('verification_history')
        .select(
          'id, content_item_id, action_type, performed_by, performed_at, note, content_items!inner(suggested_title, governance_review_status)',
        )
        .gte('performed_at', fromIso)
        .lte('performed_at', toIso)
        .order('performed_at', { ascending: false })
        .limit(5000),
      'provenance.export.verification_history',
    );

    // Resolve reviewer display names
    const performerIds = [
      ...new Set(rawRows.map((r: Record<string, unknown>) => r.performed_by as string)),
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
      const exporterNames = await resolveUserDisplayNames(supabase, [user.id]);
      const info = exporterNames.get(user.id);
      if (info) exporterName = info.display_name;
    } catch {
      // Fall back to 'Admin'
    }

    // Map to report rows
    const rows: VerificationRow[] = rawRows.map(
      (r: Record<string, unknown>) => {
        const ci = r.content_items as Record<string, unknown> | null;
        const performerId = r.performed_by as string;
        const nameInfo = displayNames.get(performerId);

        return {
          id: r.id as string,
          content_item_id: r.content_item_id as string,
          action_type: r.action_type as string,
          performed_by: performerId,
          performed_at: r.performed_at as string,
          note: r.note as string | null,
          title: (ci?.suggested_title as string | null) ?? null,
          reviewer_name: nameInfo?.display_name ?? 'A team member',
          governance_status:
            (ci?.governance_review_status as string | null) ?? null,
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
}
