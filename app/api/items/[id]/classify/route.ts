import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ClassifyBodySchema } from '@/lib/validation/schemas';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import { generateEmbedding } from '@/lib/embeddings';
import { htmlToPlainText } from '@/lib/editor-utils';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** POST /api/items/:id/classify -- on-demand AI classification */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    // Rate limit: 10 requests per minute
    const { allowed } = checkRateLimit(`classify:${user.id}`, 10, 60 * 1000);
    if (!allowed) return rateLimitResponse();

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(ClassifyBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { force } = parsed.data;

    // Fetch the content item
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'id, title, content, content_type, classified_at, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, ai_keywords, ai_summary, suggested_title, classification_confidence, classification_reasoning',
      )
      .eq('id', id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Content item not found' },
        { status: 404 },
      );
    }

    // If already classified and force is false, return existing classification
    if (item.classified_at && !force) {
      return NextResponse.json({
        primary_domain: item.primary_domain,
        primary_subtopic: item.primary_subtopic,
        secondary_domain: item.secondary_domain,
        secondary_subtopic: item.secondary_subtopic,
        ai_keywords: item.ai_keywords,
        ai_summary: item.ai_summary,
        suggested_title: item.suggested_title,
        classification_confidence: item.classification_confidence,
        classification_reasoning: item.classification_reasoning,
        cached: true,
      });
    }

    if (!item.content?.trim()) {
      return NextResponse.json(
        { error: 'Content item has no content to classify' },
        { status: 400 },
      );
    }

    // Build taxonomy string from DB
    const { data: domains } = await supabase
      .from('taxonomy_domains')
      .select('id, name')
      .eq('is_active', true)
      .order('display_order');

    const { data: subtopics } = await supabase
      .from('taxonomy_subtopics')
      .select('name, domain_id')
      .eq('is_active', true)
      .order('display_order');

    const taxonomyStr = (domains ?? [])
      .map((d) => {
        const subs = (subtopics ?? [])
          .filter((s) => s.domain_id === d.id)
          .map((s) => s.name);
        return `- ${d.name}: ${subs.join(', ')}`;
      })
      .join('\n');

    // Prepare content for classification (truncate at 5000 chars)
    const plainText = htmlToPlainText(item.content);
    const contentForClassification = plainText.slice(0, 5000);

    // Call Claude API
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
- classification_reasoning: brief explanation of the classification`,
        },
      ],
    });

    const result = extractToolResult<ClassificationResult>(
      response,
      'return_classification',
    );

    // Update the content item with classification results
    const updateData: Record<string, unknown> = {
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
      updated_by: user.id,
    };

    // Regenerate embedding with updated keywords
    try {
      const embeddingText = `${result.suggested_title}\n\n${plainText}`;
      const embedding = await generateEmbedding(embeddingText);
      updateData.embedding = JSON.stringify(embedding);
    } catch (embedErr) {
      console.error('Embedding regeneration during classification failed:', embedErr);
    }

    const { error: updateError } = await supabase
      .from('content_items')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      console.error('Failed to update classification:', updateError);
      return NextResponse.json(
        { error: 'Classification succeeded but failed to store' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      primary_domain: result.primary_domain,
      primary_subtopic: result.primary_subtopic,
      secondary_domain: result.secondary_domain ?? null,
      secondary_subtopic: result.secondary_subtopic ?? null,
      ai_keywords: result.ai_keywords,
      ai_summary: result.ai_summary,
      suggested_title: result.suggested_title,
      classification_confidence: result.classification_confidence,
      classification_reasoning: result.classification_reasoning,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to classify content item') },
      { status: 500 },
    );
  }
}
