/**
 * AI visual analysis for PDF documents.
 * Sends PDFs to Claude for visual analysis (tables, charts, diagrams, images).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { toJson } from '@/lib/validation/jsonb';
import { AIServiceError } from '@/lib/ai/errors';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** @public */
export interface VisionParams {
  supabase: SupabaseClient<Database>;
  itemId: string;
  prompt?: string;
}

/** @public */
export interface VisionResult {
  analysis: string;
  model: string;
  tokens_used: number;
  warning?: string;
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

/** Maximum PDF size for vision analysis (10 MB — Claude's limit is ~25 MB). */
const MAX_PDF_SIZE = 10 * 1024 * 1024;

const DEFAULT_PROMPT =
  'Analyse this PDF document. Describe any tables, charts, diagrams, or images you see. Extract key data points, figures, and visual information that may not be captured by text extraction alone. Use UK English.';

// ──────────────────────────────────────────
// Main function
// ──────────────────────────────────────────

/**
 * Perform visual analysis on a PDF content item using Claude.
 * Downloads the PDF, sends to Claude, stores the analysis in metadata.
 *
 * @throws AIServiceError for domain errors (404, 400, 413, 500, 502)
 */
export async function analyseVision(
  params: VisionParams,
): Promise<VisionResult> {
  const { supabase, itemId, prompt = DEFAULT_PROMPT } = params;

  // Fetch the content item
  const { data: item, error: fetchError } = await supabase
    .from('content_items')
    .select(
      'id, content_type, file_path, source_url, suggested_title, title, metadata',
    )
    .eq('id', itemId)
    .single();

  if (fetchError || !item) {
    throw new AIServiceError('Item not found', 404);
  }

  if (item.content_type !== 'pdf') {
    throw new AIServiceError(
      'Visual analysis is only available for PDF items',
      400,
    );
  }

  // Get the PDF data — either from Supabase Storage or source URL
  let pdfBase64: string;

  if (item.file_path) {
    // Download from Supabase Storage (private 'documents' bucket)
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(item.file_path);

    if (downloadError || !fileData) {
      throw new AIServiceError('Failed to download PDF from storage', 500);
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    if (buffer.length > MAX_PDF_SIZE) {
      throw new AIServiceError(
        `PDF is too large for vision analysis (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 10 MB)`,
        413,
      );
    }
    pdfBase64 = buffer.toString('base64');
  } else if (item.source_url) {
    // Download from source URL
    const response = await fetch(item.source_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new AIServiceError(
        `Failed to fetch PDF from source URL (HTTP ${response.status})`,
        502,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('pdf')) {
      throw new AIServiceError('Source URL does not appear to be a PDF', 400);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PDF_SIZE) {
      throw new AIServiceError(
        `PDF is too large for vision analysis (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 10 MB)`,
        413,
      );
    }
    pdfBase64 = buffer.toString('base64');
  } else {
    throw new AIServiceError(
      'No PDF file or source URL available for this item',
      400,
    );
  }

  // Send to Claude with the PDF as a document content block.
  // Grounding shape: n/a (B-INV-35,
  // AI_TOUCHPOINT_GROUNDING['vision.analyseVision']). This touchpoint produces a
  // free-form prose description of the document; there is no structured schema
  // or citation grounding to apply, so it declares the `n/a` shape.
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
    throw new AIServiceError('No text response from Claude', 500);
  }

  const tokensUsed =
    (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  // Store the vision analysis in metadata
  const visionAnalysis = {
    analysis: textBlock.text,
    analysed_at: new Date().toISOString(),
    model,
    tokens_used: tokensUsed,
    prompt,
  };

  const { error: mergeError } = await supabase.rpc('merge_item_metadata', {
    p_item_id: itemId,
    p_new_data: toJson({ vision_analysis: visionAnalysis }),
  });

  return {
    analysis: textBlock.text,
    model,
    tokens_used: tokensUsed,
    ...(mergeError
      ? { warning: 'Analysis succeeded but failed to persist to metadata' }
      : {}),
  };
}
