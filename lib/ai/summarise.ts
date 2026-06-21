/**
 * AI content summarisation.
 * Generates structured summaries (executive, detailed, takeaways) using Claude.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import { SummaryResponseSchema } from '@/lib/validation/ai-schemas';
import type { SummaryResponse } from '@/lib/validation/ai-schemas';
import { toJson } from '@/lib/validation/jsonb';
import type { SummaryData } from '@/types/content';
import { AIServiceError } from '@/lib/ai/errors';
import { assertSuccessfulStop } from '@/lib/ai/stop-reason';
import { logger } from '@/lib/logger';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** @public */
export interface SummariseParams {
  supabase: SupabaseClient<Database>;
  itemId: string;
  force: boolean;
  /** Optional — batch scripts may not have a user context. */
  userId?: string;
}

export interface SummariseResult {
  summary_data: SummaryData;
}

/** @public */
export interface CallSummaryAIParams {
  content: string;
  title: string;
  contentType: string;
  domain: string;
}

/** @public */
export interface CallSummaryAIResult {
  summaryData: SummaryData;
  inputTokens: number;
  outputTokens: number;
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const MAX_CONTENT_LENGTH = 100_000;

// ──────────────────────────────────────────
// Tool schema
// ──────────────────────────────────────────

const SUMMARY_TOOL = {
  name: 'return_summary',
  description: 'Return the generated summary',
  // Grounding shape: forced_tool_strict (B-INV-35,
  // AI_TOUCHPOINT_GROUNDING['summarise.callSummaryAI']).
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      executive: {
        type: 'string',
        description: 'Single sentence summary (max 150 chars)',
      },
      detailed: {
        type: 'string',
        description: '2-3 paragraph detailed summary',
      },
      takeaways: {
        type: 'array',
        items: { type: 'string' },
        description: '3-7 key takeaways',
      },
    },
    required: ['executive', 'detailed', 'takeaways'] as string[],
    additionalProperties: false,
  },
} as const;

// ──────────────────────────────────────────
// Pure AI call
// ──────────────────────────────────────────

/**
 * Pure AI function: call Claude to generate a structured summary.
 * No Supabase dependency — suitable for both the service layer and batch scripts.
 *
 * Content is truncated to MAX_CONTENT_LENGTH internally.
 *
 * @throws AIServiceError on truncated response or invalid structure
 */
export async function callSummaryAI(
  params: CallSummaryAIParams,
): Promise<CallSummaryAIResult> {
  const { title, contentType, domain } = params;

  // Truncate if very long
  const content =
    params.content.length > MAX_CONTENT_LENGTH
      ? params.content.slice(0, MAX_CONTENT_LENGTH)
      : params.content;

  // Build the prompt
  const isTranscript = ['transcript', 'podcast', 'video'].includes(contentType);

  const prompt = `You are summarising content for a knowledge base.
Content type: ${contentType}
Title: ${title}
Domain: ${domain}

Rules:
- 3 to 7 takeaways
- Use UK English
- Be specific and factual, not vague
${isTranscript ? "- This is a transcript/podcast: capture the speaker's key arguments, viewpoints, and any debates or disagreements between speakers" : '- For articles/posts: focus on the thesis, evidence, and conclusions'}
- The executive summary should be self-contained and informative

Content to summarise:
${content}`;

  // Call Claude API
  const client = getAnthropicClient();
  const model = getAIModel();

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [SUMMARY_TOOL],
    tool_choice: { type: 'tool' as const, name: 'return_summary' },
    messages: [{ role: 'user', content: prompt }],
  });

  // B-INV-36: surface refusal / max_tokens explicitly (log + throw), never
  // swallow them. extractToolResult below throws if no tool_use block is present.
  assertSuccessfulStop(response, 'summarise.callSummaryAI');

  const parsed = extractToolResult<SummaryResponse>(
    response,
    'return_summary',
    SummaryResponseSchema,
  );

  // Validate the parsed response
  if (
    !parsed.executive ||
    !parsed.detailed ||
    !Array.isArray(parsed.takeaways)
  ) {
    throw new AIServiceError(
      'Invalid summary structure returned by Claude',
      500,
    );
  }

  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  const summaryData: SummaryData = {
    executive: parsed.executive,
    detailed: parsed.detailed,
    takeaways: parsed.takeaways,
    generated_at: new Date().toISOString(),
    model,
    tokens_used: inputTokens + outputTokens,
  };

  return { summaryData, inputTokens, outputTokens };
}

// ──────────────────────────────────────────
// Service-layer function
// ──────────────────────────────────────────

/**
 * Generate an AI summary for a content item.
 * Fetches the item, calls Claude via callSummaryAI(), stores the result, and returns it.
 *
 * @throws AIServiceError for domain errors (404, 400, 409, 413, 500)
 */
export async function generateSummary(
  params: SummariseParams,
): Promise<SummariseResult> {
  const { supabase, itemId, force, userId } = params;

  // Fetch the content item
  const { data: item, error: fetchError } = await supabase
    .from('content_items')
    .select(
      'id, content, title, suggested_title, content_type, summary, primary_domain, summary_data',
    )
    .eq('id', itemId)
    .single();

  if (fetchError || !item) {
    throw new AIServiceError('Content item not found', 404);
  }

  // Check if summary already exists (unless force=true)
  if (item.summary_data && !force) {
    throw new AIServiceError(
      'Summary already exists. Pass force=true to regenerate.',
      409,
    );
  }

  if (!item.content?.trim()) {
    throw new AIServiceError('Content item has no content to summarise', 400);
  }

  const displayTitle = item.suggested_title || item.title || 'Untitled';
  const contentType = item.content_type || 'article';
  const domain = item.primary_domain || 'unknown';

  // Call the pure AI function
  const { summaryData } = await callSummaryAI({
    content: item.content,
    title: displayTitle,
    contentType,
    domain,
  });

  // Store in Supabase (also sync summary with the higher-quality executive)
  const updatePayload: Database['public']['Tables']['content_items']['Update'] =
    {
      summary_data: toJson(summaryData),
      summary: summaryData.executive,
    };
  if (userId) {
    updatePayload.updated_by = userId;
  }

  const { error: updateError } = await supabase
    .from('content_items')
    .update(updatePayload)
    .eq('id', itemId);

  if (updateError) {
    logger.error(
      { err: updateError, op: 'summarise.store', itemId },
      'Failed to store summary',
    );
    throw new AIServiceError('Summary generated but failed to store', 500);
  }

  return { summary_data: summaryData };
}
