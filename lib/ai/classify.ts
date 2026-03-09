/**
 * AI content classification.
 * Classifies a KB content item using Claude and updates the record.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import { generateEmbedding } from '@/lib/ai/embed';
import { htmlToPlainText } from '@/lib/editor-utils';
import { AIServiceError } from '@/lib/ai/errors';
import { loadSkill } from '@/lib/ai/skills/loader';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface ClassificationResult {
  primary_domain: string;
  primary_subtopic: string;
  secondary_domain?: string | null;
  secondary_subtopic?: string | null;
  ai_keywords: string[];
  ai_summary: string;
  suggested_title: string;
  classification_confidence: number;
  classification_reasoning: string;
  cached?: boolean;
}

export interface ClassifyParams {
  supabase: SupabaseClient<Database>;
  itemId: string;
  force: boolean;
  userId: string;
}

// ──────────────────────────────────────────
// Main function
// ──────────────────────────────────────────

/**
 * Classify a content item using Claude AI.
 * Fetches the item, calls Claude, updates the record, and returns the result.
 *
 * @throws AIServiceError for domain errors (404, 400, 500 on update)
 */
export async function classifyContent(params: ClassifyParams): Promise<ClassificationResult> {
  const { supabase, itemId, force, userId } = params;

  // Fetch the content item
  const { data: item, error: fetchError } = await supabase
    .from('content_items')
    .select(
      'id, title, content, content_type, classified_at, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, ai_keywords, ai_summary, suggested_title, classification_confidence, classification_reasoning',
    )
    .eq('id', itemId)
    .single();

  if (fetchError || !item) {
    throw new AIServiceError('Content item not found', 404);
  }

  // If already classified and force is false, return existing classification
  if (item.classified_at && !force) {
    return {
      primary_domain: item.primary_domain!,
      primary_subtopic: item.primary_subtopic!,
      secondary_domain: item.secondary_domain,
      secondary_subtopic: item.secondary_subtopic,
      ai_keywords: item.ai_keywords ?? [],
      ai_summary: item.ai_summary ?? '',
      suggested_title: item.suggested_title ?? '',
      classification_confidence: item.classification_confidence ?? 0,
      classification_reasoning: item.classification_reasoning ?? '',
      cached: true,
    };
  }

  if (!item.content?.trim()) {
    throw new AIServiceError('Content item has no content to classify', 400);
  }

  // Load classification skill for enhanced prompt context
  let classificationSkill = '';
  try {
    classificationSkill = await loadSkill('classification');
  } catch {
    // Skill file not available — proceed without it
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
        content: `${classificationSkill ? `${classificationSkill}\n\n` : ''}You are classifying content for a UK SMB knowledge base focused on bid management.

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
    updated_by: userId,
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
    .eq('id', itemId);

  if (updateError) {
    console.error('Failed to update classification:', updateError);
    throw new AIServiceError('Classification succeeded but failed to store', 500);
  }

  return {
    primary_domain: result.primary_domain,
    primary_subtopic: result.primary_subtopic,
    secondary_domain: result.secondary_domain ?? null,
    secondary_subtopic: result.secondary_subtopic ?? null,
    ai_keywords: result.ai_keywords,
    ai_summary: result.ai_summary,
    suggested_title: result.suggested_title,
    classification_confidence: result.classification_confidence,
    classification_reasoning: result.classification_reasoning,
  };
}
