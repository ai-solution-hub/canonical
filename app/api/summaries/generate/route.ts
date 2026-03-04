import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { SummaryGenerateBodySchema } from '@/lib/validation/schemas';
import { SummaryResponseSchema } from '@/lib/validation/ai-schemas';
import type { SummaryResponse } from '@/lib/validation/ai-schemas';
import { toJson } from '@/lib/validation/jsonb';
import type { SummaryData } from '@/types/content';

export const maxDuration = 30;

const MAX_CONTENT_LENGTH = 100_000;

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { user, supabase } = auth;

    // Rate limit: 10 requests per minute
    const { allowed } = checkRateLimit(`summaries:${user.id}`, 10, 60 * 1000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const validated = parseBody(SummaryGenerateBodySchema, raw);
    if (!validated.success) return validated.response;
    const { item_id, force } = validated.data;

    // 1. Fetch the content item
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'id, content, title, suggested_title, content_type, ai_summary, primary_domain, summary_data',
      )
      .eq('id', item_id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Content item not found' },
        { status: 404 },
      );
    }

    // Check if summary already exists (unless force=true)
    if (item.summary_data && !force) {
      return NextResponse.json(
        { error: 'Summary already exists. Pass force=true to regenerate.' },
        { status: 409 },
      );
    }

    if (!item.content?.trim()) {
      return NextResponse.json(
        { error: 'Content item has no content to summarise' },
        { status: 400 },
      );
    }

    // 2. Prepare content (truncate if very long)
    const content =
      item.content.length > MAX_CONTENT_LENGTH
        ? item.content.slice(0, MAX_CONTENT_LENGTH)
        : item.content;

    const displayTitle = item.suggested_title || item.title || 'Untitled';
    const contentType = item.content_type || 'article';
    const domain = item.primary_domain || 'unknown';

    // 3. Build the prompt
    const isTranscript = ['transcript', 'podcast', 'video'].includes(
      contentType,
    );

    const prompt = `You are summarising content for a personal knowledge management system.
Content type: ${contentType}
Title: ${displayTitle}
Domain: ${domain}

Rules:
- 3 to 7 takeaways
- Use UK English
- Be specific and factual, not vague
${isTranscript ? "- This is a transcript/podcast: capture the speaker's key arguments, viewpoints, and any debates or disagreements between speakers" : '- For articles/posts: focus on the thesis, evidence, and conclusions'}
- The executive summary should be self-contained and informative

Content to summarise:
${content}`;

    // 4. Call Claude API
    const client = getAnthropicClient();
    const model = getAIModel();

    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      tools: [
        {
          name: 'return_summary',
          description: 'Return the generated summary',
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
            required: ['executive', 'detailed', 'takeaways'],
          },
        },
      ],
      tool_choice: { type: 'tool' as const, name: 'return_summary' },
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // 5. Extract and parse the response
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json(
        {
          error:
            'Content too long for summary generation — response was truncated',
        },
        { status: 413 },
      );
    }

    const parsed = extractToolResult<SummaryResponse>(
      response,
      'return_summary',
      SummaryResponseSchema,
    );

    // 6. Validate the parsed response
    if (
      !parsed.executive ||
      !parsed.detailed ||
      !Array.isArray(parsed.takeaways)
    ) {
      return NextResponse.json(
        { error: 'Invalid summary structure returned by Claude' },
        { status: 500 },
      );
    }

    // 7. Build the SummaryData object
    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0);

    const summaryData: SummaryData = {
      executive: parsed.executive,
      detailed: parsed.detailed,
      takeaways: parsed.takeaways,
      generated_at: new Date().toISOString(),
      model,
      tokens_used: tokensUsed,
    };

    // 8. Store in Supabase (also sync ai_summary with the higher-quality executive)
    const { error: updateError } = await supabase
      .from('content_items')
      .update({
        summary_data: toJson(summaryData),
        ai_summary: summaryData.executive,
        updated_by: user.id,
      })
      .eq('id', item_id);

    if (updateError) {
      console.error('Failed to store summary:', updateError);
      return NextResponse.json(
        { error: 'Summary generated but failed to store' },
        { status: 500 },
      );
    }

    return NextResponse.json({ summary_data: summaryData });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate summary') },
      { status: 500 },
    );
  }
}
