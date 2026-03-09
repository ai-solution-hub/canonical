/**
 * AI structured data extraction from content items.
 * Extracts data according to a user-provided JSON schema.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { toJson } from '@/lib/validation/jsonb';
import { AIServiceError } from '@/lib/ai/errors';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface ExtractContentParams {
  supabase: SupabaseClient<Database>;
  itemId: string;
  schema: Record<string, unknown>;
  prompt?: string;
}

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
export async function extractStructuredContent(params: ExtractContentParams): Promise<ExtractContentResult> {
  const { supabase, itemId, schema, prompt: userPrompt } = params;

  // Fetch the content item
  const { data: item, error: fetchError } = await supabase
    .from('content_items')
    .select('id, title, content, content_type, metadata')
    .eq('id', itemId)
    .single();

  if (fetchError || !item) {
    throw new AIServiceError('Item not found', 404);
  }

  if (!item.content || item.content.length < 50) {
    throw new AIServiceError('Item has insufficient content for extraction', 400);
  }

  // Build the extraction prompt
  const defaultPrompt =
    'Extract structured data from the following document according to the provided JSON schema. Be thorough and accurate. If a field cannot be determined from the content, use null.';

  const systemPrompt =
    'You are a document extraction assistant. You extract structured data from documents according to a provided JSON schema. Always return valid JSON that conforms exactly to the schema.';

  const contentSlice = item.content.slice(0, MAX_CONTENT_LENGTH);

  const fullPrompt = `${userPrompt || defaultPrompt}

## JSON Schema
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

## Document Title
${item.title || 'Untitled'}

## Document Content
${contentSlice}`;

  // Call Claude
  const model = getAIModel();
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: fullPrompt }],
  });

  // Extract the text content
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new AIServiceError('No text response from Claude', 500);
  }

  // Check for truncated output
  if (response.stop_reason === 'max_tokens') {
    throw new AIServiceError(
      'Extraction output was truncated — try a simpler schema or shorter content',
      413,
    );
  }

  // Parse the JSON from Claude's response
  let result: unknown;
  try {
    const text = textBlock.text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    result = JSON.parse(jsonStr);
  } catch {
    throw new AIServiceError('Failed to parse structured output from Claude', 500);
  }

  // Calculate cost (approximate — Sonnet 4 pricing: $3/M input, $15/M output)
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

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
    ...(mergeError ? { warning: 'Extraction succeeded but failed to persist to metadata' } : {}),
  };
}
