import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ItemCreateBodySchema } from '@/lib/validation/schemas';
import { generateEmbedding } from '@/lib/ai/embed';
import { htmlToPlainText } from '@/lib/editor-utils';

export const maxDuration = 30;

/** POST /api/items -- create new content item */
export async function POST(request: NextRequest) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Rate limit: 20 requests per minute
    const { allowed } = checkRateLimit(`items:create:${user.id}`, 20, 60 * 1000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(ItemCreateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const {
      title,
      content,
      content_type,
      primary_domain,
      primary_subtopic,
      secondary_domain,
      secondary_subtopic,
      priority,
      user_tags,
      ai_keywords,
      author_name,
      source_url,
      brief,
      detail,
      reference,
      auto_classify,
      auto_summarise,
      auto_embed,
      governance_review_status,
    } = parsed.data;

    // Generate embedding synchronously before INSERT (fast, ~200ms)
    let embeddingValue: string | undefined;
    if (auto_embed) {
      try {
        const plainText = htmlToPlainText(content);
        const embeddingText = `${title}\n\n${plainText}`;
        const embedding = await generateEmbedding(embeddingText);
        embeddingValue = JSON.stringify(embedding);
      } catch (embedErr) {
        console.error('Embedding generation failed:', embedErr);
        // Continue without embedding -- item is still usable
      }
    }

    // Build the insert payload
    const insertData: Record<string, unknown> = {
      title,
      content,
      content_type,
      suggested_title: title,
      platform: 'manual',
      captured_date: new Date().toISOString(),
      created_by: user.id,
    };

    // Optional fields
    if (primary_domain) insertData.primary_domain = primary_domain;
    if (primary_subtopic) insertData.primary_subtopic = primary_subtopic;
    if (secondary_domain) insertData.secondary_domain = secondary_domain;
    if (secondary_subtopic) insertData.secondary_subtopic = secondary_subtopic;
    if (priority) insertData.priority = priority;
    if (user_tags?.length) insertData.user_tags = user_tags;
    if (ai_keywords?.length) insertData.ai_keywords = ai_keywords;
    if (author_name) insertData.author_name = author_name;
    if (source_url) insertData.source_url = source_url;
    if (brief) insertData.brief = brief;
    if (detail) insertData.detail = detail;
    if (reference) insertData.reference = reference;
    if (embeddingValue) insertData.embedding = embeddingValue;
    if (governance_review_status) insertData.governance_review_status = governance_review_status;

    // Single INSERT with embedding included
    const { data: newItem, error: insertError } = await supabase
      .from('content_items')
      .insert(insertData as never)
      .select('id, title, content_type, created_at')
      .single();

    if (insertError || !newItem) {
      console.error('Failed to create content item:', insertError);
      return NextResponse.json(
        { error: 'Failed to create content item' },
        { status: 500 },
      );
    }

    // Create version 1 entry in content_history (best-effort)
    try {
      await supabase.from('content_history').insert({
        content_item_id: newItem.id,
        version: 1,
        title,
        content,
        brief: brief ?? null,
        detail: detail ?? null,
        reference: reference ?? null,
        change_summary: 'Initial creation',
        change_type: 'create',
        created_by: user.id,
      });
    } catch (historyErr) {
      console.error('Failed to create initial version history:', historyErr);
    }

    // Background tasks (fire-and-forget)
    const backgroundTasks: Record<string, string> = {};

    if (auto_embed && embeddingValue) {
      backgroundTasks.embedding = 'complete';
    } else if (auto_embed) {
      backgroundTasks.embedding = 'failed';
    }

    if (auto_classify) {
      backgroundTasks.classification = 'queued';
      classifyInBackground(newItem.id, user.id).catch((err) =>
        console.error('Background classification failed:', err),
      );
    }

    if (auto_summarise) {
      backgroundTasks.summary = 'queued';
      summariseInBackground(newItem.id, user.id).catch((err) =>
        console.error('Background summary generation failed:', err),
      );
    }

    return NextResponse.json(
      {
        id: newItem.id,
        title: newItem.title,
        content_type: newItem.content_type,
        created_at: newItem.created_at,
        background_tasks: backgroundTasks,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create content item') },
      { status: 500 },
    );
  }
}

/**
 * Fire-and-forget background classification.
 * Calls the classify endpoint internally.
 */
async function classifyInBackground(
  itemId: string,
  userId: string,
): Promise<void> {
  try {
    // Use service-role client for background tasks — cookie-based clients
    // may not have access to cookies after the response has been sent
    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();

    const { data: item } = await supabase
      .from('content_items')
      .select('title, content, content_type, classified_at')
      .eq('id', itemId)
      .single();

    if (!item?.content) return;

    // Call Anthropic for classification
    const { getAnthropicClient, getAIModel } = await import('@/lib/anthropic');
    const { extractToolResult } = await import('@/lib/ai-parse');

    const plainText = htmlToPlainText(item.content);
    const contentForClassification = plainText.slice(0, 5000);

    // Fetch taxonomy for prompt
    const { data: domains } = await supabase
      .from('taxonomy_domains')
      .select('name')
      .eq('is_active', true)
      .order('display_order');

    const { data: subtopics } = await supabase
      .from('taxonomy_subtopics')
      .select('name, domain_id, taxonomy_domains(name)')
      .eq('is_active', true);

    const taxonomyStr = (domains ?? [])
      .map((d) => {
        const subs = (subtopics ?? [])
          .filter((s: Record<string, unknown>) => {
            const td = s.taxonomy_domains as { name: string } | null;
            return td?.name === d.name;
          })
          .map((s: Record<string, unknown>) => s.name as string);
        return `- ${d.name}: ${subs.join(', ')}`;
      })
      .join('\n');

    const client = getAnthropicClient();
    const model = getAIModel();

    const response = await client.messages.create({
      model,
      max_tokens: 1500,
      tools: [
        {
          name: 'return_classification',
          description: 'Return the classification result',
          input_schema: {
            type: 'object' as const,
            properties: {
              primary_domain: { type: 'string' },
              primary_subtopic: { type: 'string' },
              secondary_domain: { type: ['string', 'null'] },
              secondary_subtopic: { type: ['string', 'null'] },
              ai_keywords: { type: 'array', items: { type: 'string' } },
              ai_summary: { type: 'string' },
              suggested_title: { type: 'string' },
              classification_confidence: { type: 'number' },
              classification_reasoning: { type: 'string' },
            },
            required: [
              'primary_domain',
              'primary_subtopic',
              'ai_keywords',
              'ai_summary',
              'suggested_title',
              'classification_confidence',
              'classification_reasoning',
            ],
          },
        },
      ],
      tool_choice: { type: 'tool' as const, name: 'return_classification' },
      messages: [
        {
          role: 'user',
          content: `You are classifying content for a UK SMB knowledge base focused on bid management.

Available domains and subtopics:
${taxonomyStr}

Content type: ${item.content_type}
Title: ${item.title}

Content:
${contentForClassification}

Classify this content. Return a JSON object with:
- primary_domain: the best-fitting domain
- primary_subtopic: the best-fitting subtopic within that domain
- secondary_domain: a second relevant domain (or null)
- secondary_subtopic: a second relevant subtopic (or null)
- ai_keywords: 3-8 descriptive keywords
- ai_summary: one sentence summary (max 200 chars)
- suggested_title: a clear, descriptive title (40-100 chars)
- classification_confidence: 0.0-1.0
- classification_reasoning: brief explanation`,
        },
      ],
    });

    interface ClassificationResult {
      primary_domain: string;
      primary_subtopic: string;
      secondary_domain?: string | null;
      secondary_subtopic?: string | null;
      ai_keywords: string[];
      ai_summary: string;
      suggested_title: string;
      classification_confidence: number;
      classification_reasoning: string;
    }

    const result = extractToolResult<ClassificationResult>(
      response,
      'return_classification',
    );

    // Update the content item
    await supabase
      .from('content_items')
      .update({
        primary_domain: result.primary_domain,
        primary_subtopic: result.primary_subtopic,
        secondary_domain: result.secondary_domain ?? null,
        secondary_subtopic: result.secondary_subtopic ?? null,
        ai_keywords: result.ai_keywords,
        ai_summary: result.ai_summary,
        suggested_title: result.suggested_title,
        classification_confidence: result.classification_confidence,
        classification_reasoning: result.classification_reasoning,
        classified_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', itemId);
  } catch (err) {
    console.error(`Background classification failed for ${itemId}:`, err);
  }
}

/**
 * Fire-and-forget background summary generation.
 */
async function summariseInBackground(
  itemId: string,
  userId: string,
): Promise<void> {
  try {
    // Use service-role client for background tasks — cookie-based clients
    // may not have access to cookies after the response has been sent
    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();

    const { data: item } = await supabase
      .from('content_items')
      .select(
        'id, content, title, suggested_title, content_type, primary_domain, summary_data',
      )
      .eq('id', itemId)
      .single();

    if (!item?.content?.trim()) return;
    if (item.summary_data) return; // Already has summary

    const { getAnthropicClient, getAIModel } = await import('@/lib/anthropic');
    const { extractToolResult } = await import('@/lib/ai-parse');
    const { toJson } = await import('@/lib/validation/jsonb');

    const content =
      item.content.length > 100_000
        ? item.content.slice(0, 100_000)
        : item.content;

    const displayTitle = item.suggested_title || item.title || 'Untitled';
    const contentType = item.content_type || 'article';
    const domain = item.primary_domain || 'unknown';

    const isTranscript = ['transcript', 'podcast', 'video'].includes(
      contentType,
    );

    const prompt = `You are summarising content for a knowledge base.
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
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'max_tokens') return;

    interface SummaryResult {
      executive: string;
      detailed: string;
      takeaways: string[];
    }

    const parsed = extractToolResult<SummaryResult>(
      response,
      'return_summary',
    );

    if (!parsed.executive || !parsed.detailed || !Array.isArray(parsed.takeaways))
      return;

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0);

    const summaryData = {
      executive: parsed.executive,
      detailed: parsed.detailed,
      takeaways: parsed.takeaways,
      generated_at: new Date().toISOString(),
      model,
      tokens_used: tokensUsed,
    };

    await supabase
      .from('content_items')
      .update({
        summary_data: toJson(summaryData),
        ai_summary: summaryData.executive,
        updated_by: userId,
      })
      .eq('id', itemId);
  } catch (err) {
    console.error(`Background summary failed for ${itemId}:`, err);
  }
}
