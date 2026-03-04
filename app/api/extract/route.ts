import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { parseBody } from '@/lib/validation';
import { ExtractBodySchema } from '@/lib/validation/schemas';
import { toJson } from '@/lib/validation/jsonb';

export const maxDuration = 60;

const MAX_CONTENT_LENGTH = 100_000;

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { supabase, user } = auth;

    // Rate limit: 5 extractions per minute
    const { allowed } = checkRateLimit(`extract:${user.id}`, 5, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(ExtractBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { itemId, schema, prompt } = parsed.data;

    // Fetch the content item
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select('id, title, content, content_type, metadata')
      .eq('id', itemId)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
    }

    if (!item.content || item.content.length < 50) {
      return NextResponse.json(
        { error: 'Item has insufficient content for extraction' },
        { status: 400 },
      );
    }

    // Build the extraction prompt
    const defaultPrompt =
      'Extract structured data from the following document according to the provided JSON schema. Be thorough and accurate. If a field cannot be determined from the content, use null.';

    const systemPrompt =
      'You are a document extraction assistant. You extract structured data from documents according to a provided JSON schema. Always return valid JSON that conforms exactly to the schema.';

    const contentSlice = item.content.slice(0, MAX_CONTENT_LENGTH);

    const userPrompt = `${prompt || defaultPrompt}

## JSON Schema
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

## Document Title
${item.title || 'Untitled'}

## Document Content
${contentSlice}`;

    // Call Claude with the model from env var (defaults to claude-sonnet-4-6)
    const model = getAIModel();
    const anthropic = getAnthropicClient();

    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract the text content
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from Claude' },
        { status: 500 },
      );
    }

    // Check for truncated output
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json(
        {
          error:
            'Extraction output was truncated — try a simpler schema or shorter content',
        },
        { status: 413 },
      );
    }

    // Parse the JSON from Claude's response
    let result: unknown;
    try {
      // Try to extract JSON from the response (may be wrapped in markdown code block)
      const text = textBlock.text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
      result = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse structured output from Claude' },
        { status: 500 },
      );
    }

    // Calculate cost (approximate — Sonnet 4 pricing: $3/M input, $15/M output)
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    // Store the extraction result in metadata using merge_item_metadata RPC
    // This merges into existing metadata without overwriting other keys
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

    return NextResponse.json({
      result,
      model,
      tokens_used: inputTokens + outputTokens,
      cost: parseFloat(cost.toFixed(4)),
      ...(mergeError ? { warning: 'Extraction succeeded but failed to persist to metadata' } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to extract structured data') },
      { status: 500 },
    );
  }
}
