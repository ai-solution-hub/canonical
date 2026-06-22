import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import {
  fetchProcurementExportData,
  sanitiseFilename,
} from '@/lib/procurement/procurement-export-data';
import { generateBidXlsx } from '@/lib/procurement/procurement-export-xlsx';
import { parseBody } from '@/lib/validation';
import { XlsxExportBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id: procurementId } = await params;

      // Auth — all authenticated users can export (read-only operation)
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);

      // Parse body — empty body is fine, all fields have defaults
      let body = {};
      try {
        body = await request.json();
      } catch {
        // Empty body is acceptable — all fields have defaults
      }
      const parsed = parseBody(XlsxExportBodySchema, body);
      if (!parsed.success) return parsed.response;
      const options = parsed.data;

      // Fetch and transform bid data
      const result = await fetchProcurementExportData(
        auth.supabase,
        procurementId,
      );
      if (result instanceof NextResponse) return result;

      // Generate spreadsheet
      const buffer = await generateBidXlsx(result.metadata, result.questions, {
        includeSummary: options.include_summary,
        includeUnanswered: options.include_unanswered,
        useAdvancedVariant: options.use_advanced_variant,
      });

      const safeName = sanitiseFilename(result.procurementName);
      const bytes = new Uint8Array(buffer);

      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${safeName}-responses.xlsx"`,
          'Content-Length': bytes.length.toString(),
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Export generation failed') },
        { status: 500 },
      );
    }
  },
);
