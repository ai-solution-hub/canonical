/**
 * AI structured data extraction from content items.
 * Extracts data according to a user-provided JSON schema.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel, estimateCost } from '@/lib/anthropic';
import { toJson } from '@/lib/validation/jsonb';
import { AIServiceError } from '@/lib/ai/errors';
import { assertSuccessfulStop } from '@/lib/ai/stop-reason';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** @public */
export interface ExtractContentParams {
  supabase: SupabaseClient<Database>;
  itemId: string;
  schema: Record<string, unknown>;
  prompt?: string;
}

/** @public */
export interface ExtractContentResult {
  result: unknown;
  model: string;
  tokens_used: number;
  cost: number;
  warning?: string;
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const MAX_CONTENT_LENGTH = 100_000;

// ──────────────────────────────────────────
// Main function
// ──────────────────────────────────────────

/**
 * Extract structured data from a content item using Claude.
 * Sends content + schema to Claude, parses JSON output, stores in metadata.
 *
 * @throws AIServiceError for domain errors (404, 400, 413, 500)
 */
export async function extractStructuredContent(
  params: ExtractContentParams,
): Promise<ExtractContentResult> {
  const { supabase, itemId, schema, prompt: userPrompt } = params;

  // Fetch the source document. ID-131 {131.17} G-IMS-DELETE KEEP-list:
  // re-pointed off content_items onto source_documents (M3 gave SD the
  // classification family; `content`/`title` have no SD column of the same
  // name — extracted_text / original_filename+filename are the nearest
  // analogs, matching the established idiom in
  // app/reference/[id]/reference-detail-client.tsx:83 and
  // lib/diff/adapters/source-document-revision.ts). `metadata` was selected
  // but never read in this function — dropped rather than mapped to
  // extraction_metadata.
  const { data: item, error: fetchError } = await supabase
    .from('source_documents')
    .select('id, original_filename, filename, extracted_text, content_type')
    .eq('id', itemId)
    .single();

  if (fetchError || !item) {
    throw new AIServiceError('Item not found', 404);
  }

  if (!item.extracted_text || item.extracted_text.length < 50) {
    throw new AIServiceError(
      'Item has insufficient content for extraction',
      400,
    );
  }

  const title = item.original_filename ?? item.filename;

  // Build the extraction prompt
  const defaultPrompt =
    'Extract structured data from the following document according to the provided JSON schema. Be thorough and accurate. If a field cannot be determined from the content, use null.';

  const systemPrompt =
    'You are a document extraction assistant. You extract structured data from documents according to a provided JSON schema. Always return valid JSON that conforms exactly to the schema.';

  const contentSlice = item.extracted_text.slice(0, MAX_CONTENT_LENGTH);

  const fullPrompt = `${userPrompt || defaultPrompt}

## Document Title
${title || 'Untitled'}

## Document Content
${contentSlice}`;

  // Call Claude.
  // Grounding shape: structured_output (B-INV-35,
  // AI_TOUCHPOINT_GROUNDING['extract-content.extractStructuredContent']). The
  // caller-supplied JSON Schema is enforced server-side via output_config.format
  // rather than asked-for in prose, so the response is grounded structured JSON.
  const model = getAIModel();
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: fullPrompt }],
    output_config: {
      format: {
        type: 'json_schema' as const,
        schema: schema as Record<string, unknown>,
      },
    },
  });

  // B-INV-36: surface refusal / max_tokens explicitly first — on a refusal the
  // content is empty, so this must run before the no-text check to report the
  // real cause rather than a misleading "no response".
  assertSuccessfulStop(response, 'extract-content.extractStructuredContent');

  // Extract the text content
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new AIServiceError('No text response from Claude', 500);
  }

  // Parse the JSON from Claude's response. output_config.format guarantees the
  // text block is schema-conformant JSON, so no prose/fence stripping is needed.
  let result: unknown;
  try {
    result = JSON.parse(textBlock.text);
  } catch {
    throw new AIServiceError(
      'Failed to parse structured output from Claude',
      500,
    );
  }

  // Calculate cost using shared pricing constants
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = estimateCost(model, {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });

  // Store the extraction result in metadata using merge_item_metadata RPC
  const { error: mergeError } = await supabase.rpc('merge_item_metadata', {
    p_item_id: itemId,
    p_new_data: toJson({
      structured_extraction: {
        result,
        schema,
        extracted_at: new Date().toISOString(),
        model,
        tokens_used: inputTokens + outputTokens,
      },
    }),
  });

  return {
    result,
    model,
    tokens_used: inputTokens + outputTokens,
    cost: parseFloat(cost.toFixed(4)),
    ...(mergeError
      ? { warning: 'Extraction succeeded but failed to persist to metadata' }
      : {}),
  };
}
