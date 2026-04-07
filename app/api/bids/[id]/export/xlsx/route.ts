import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { generateBidXlsx } from '@/lib/bid/bid-export-xlsx';
import { XlsxExportBodySchema } from '@/lib/validation/schemas';
import { parseBody } from '@/lib/validation';
import {
  fetchBidExportData,
  sanitiseFilename,
} from '@/lib/bid/bid-export-data';

export const maxDuration = 30;

/** POST /api/bids/:id/export/xlsx — generate Excel spreadsheet export */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bidId } = await params;

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
    const result = await fetchBidExportData(auth.supabase, bidId);
    if (result instanceof NextResponse) return result;

    // Generate spreadsheet
    const buffer = await generateBidXlsx(result.metadata, result.questions, {
      includeSummary: options.include_summary,
      includeUnanswered: options.include_unanswered,
      useAdvancedVariant: options.use_advanced_variant,
    });

    const safeName = sanitiseFilename(result.bidName);
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
}
