import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { toJson } from '@/lib/validation/jsonb';

export const maxDuration = 60;

/** Maximum PDF size for vision analysis (10 MB — Claude's limit is ~25 MB). */
const MAX_PDF_SIZE = 10 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase, user } = auth;

    const { allowed } = checkRateLimit(`vision:${user.id}`, 5, 60_000);
    if (!allowed) return rateLimitResponse();

    const { id } = await params;

    // Parse optional prompt from request body
    let prompt = 'Analyse this PDF document. Describe any tables, charts, diagrams, or images you see. Extract key data points, figures, and visual information that may not be captured by text extraction alone. Use UK English.';
    try {
      const body = await request.json();
      if (body.prompt && typeof body.prompt === 'string') {
        prompt = body.prompt;
      }
    } catch {
      // No body or invalid JSON — use default prompt
    }

    // Fetch the content item
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select('id, content_type, file_path, source_url, suggested_title, title, metadata')
      .eq('id', id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
    }

    if (item.content_type !== 'pdf') {
      return NextResponse.json(
        { error: 'Visual analysis is only available for PDF items' },
        { status: 400 },
      );
    }

    // Get the PDF data — either from Supabase Storage or source URL
    let pdfBase64: string;

    if (item.file_path) {
      // Download from Supabase Storage (private 'documents' bucket)
      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from('documents')
        .download(item.file_path);

      if (downloadError || !fileData) {
        return NextResponse.json(
          { error: 'Failed to download PDF from storage' },
          { status: 500 },
        );
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      if (buffer.length > MAX_PDF_SIZE) {
        return NextResponse.json(
          { error: `PDF is too large for vision analysis (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 10 MB)` },
          { status: 413 },
        );
      }
      pdfBase64 = buffer.toString('base64');
    } else if (item.source_url) {
      // Download from source URL
      const response = await fetch(item.source_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: `Failed to fetch PDF from source URL (HTTP ${response.status})` },
          { status: 502 },
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('pdf')) {
        return NextResponse.json(
          { error: 'Source URL does not appear to be a PDF' },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_PDF_SIZE) {
        return NextResponse.json(
          { error: `PDF is too large for vision analysis (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 10 MB)` },
          { status: 413 },
        );
      }
      pdfBase64 = buffer.toString('base64');
    } else {
      return NextResponse.json(
        { error: 'No PDF file or source URL available for this item' },
        { status: 400 },
      );
    }

    // Send to Claude with the PDF as a document content block
    const anthropic = getAnthropicClient();
    const model = getAIModel();
    const displayTitle = item.suggested_title || item.title || 'Untitled';

    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `Document title: "${displayTitle}"\n\n${prompt}`,
            },
          ],
        },
      ],
    });

    // Extract text response
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from Claude' },
        { status: 500 },
      );
    }

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0);

    // Store the vision analysis in metadata
    const visionAnalysis = {
      analysis: textBlock.text,
      analysed_at: new Date().toISOString(),
      model,
      tokens_used: tokensUsed,
      prompt,
    };

    const { error: mergeError } = await supabase.rpc('merge_item_metadata', {
      p_item_id: id,
      p_new_data: toJson({ vision_analysis: visionAnalysis }),
    });

    return NextResponse.json({
      analysis: textBlock.text,
      model,
      tokens_used: tokensUsed,
      ...(mergeError ? { warning: 'Analysis succeeded but failed to persist to metadata' } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to perform visual analysis') },
      { status: 500 },
    );
  }
}
