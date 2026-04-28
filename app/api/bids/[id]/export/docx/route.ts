import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { generateBidDocx } from '@/lib/bid/bid-export-docx';
import { DocxExportBodySchema } from '@/lib/validation/schemas';
import { parseBody } from '@/lib/validation';
import {
  fetchBidExportData,
  sanitiseFilename,
} from '@/lib/bid/bid-export-data';

export const maxDuration = 30;

/** POST /api/bids/:id/export/docx — generate Word document export */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth — all authenticated users can export (read-only operation)
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);

    const { id: bidId } = await params;

    // Parse body — empty body is fine, all fields have defaults
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is acceptable — all fields have defaults
    }
    const parsed = parseBody(DocxExportBodySchema, body);
    if (!parsed.success) return parsed.response;
    const options = parsed.data;

    // Fetch and transform bid data
    const result = await fetchBidExportData(auth.supabase, bidId);
    if (result instanceof NextResponse) return result;

    // Generate document
    const buffer = await generateBidDocx(result.metadata, result.questions, {
      includeCover: options.include_cover,
      includeToc: options.include_toc,
      includeCitations: options.include_citations,
      includeUnanswered: options.include_unanswered,
      useAdvancedVariant: options.use_advanced_variant,
      companyName: options.company_name,
    });

    const safeName = sanitiseFilename(result.bidName);
    const bytes = new Uint8Array(buffer);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeName}-responses.docx"`,
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
