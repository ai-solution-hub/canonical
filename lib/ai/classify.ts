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
import { canonicalise } from '@/lib/entity-dedup';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface ExtractedEntity {
  name: string;
  type:
    | 'organisation'
    | 'certification'
    | 'regulation'
    | 'framework'
    | 'capability'
    | 'person'
    | 'technology'
    | 'project'
    | 'sector';
  canonical_name: string;
}

export interface ExtractedRelationship {
  source: string;
  relationship:
    | 'holds'
    | 'complies_with'
    | 'delivers_to'
    | 'uses'
    | 'demonstrated_by'
    | 'requires'
    | 'part_of'
    | 'supersedes'
    | 'references'
    | 'evidences';
  target: string;
}

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
  entities?: ExtractedEntity[];
  relationships?: ExtractedRelationship[];
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
    max_tokens: 2500,
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
            entities: {
              type: 'array',
              description:
                'Named entities extracted from the content',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Entity name as it appears in the text',
                  },
                  type: {
                    type: 'string',
                    enum: [
                      'organisation',
                      'certification',
                      'regulation',
                      'framework',
                      'capability',
                      'person',
                      'technology',
                      'project',
                      'sector',
                    ],
                  },
                  canonical_name: {
                    type: 'string',
                    description:
                      'Normalised form for deduplication (e.g. "ISO 27001" not "ISO27001")',
                  },
                },
                required: ['name', 'type', 'canonical_name'],
              },
            },
            relationships: {
              type: 'array',
              description:
                'Relationships between extracted entities',
              items: {
                type: 'object',
                properties: {
                  source: {
                    type: 'string',
                    description: 'Canonical name of the source entity',
                  },
                  relationship: {
                    type: 'string',
                    enum: [
                      'holds',
                      'complies_with',
                      'delivers_to',
                      'uses',
                      'demonstrated_by',
                      'requires',
                      'part_of',
                      'supersedes',
                      'references',
                      'evidences',
                    ],
                  },
                  target: {
                    type: 'string',
                    description: 'Canonical name of the target entity',
                  },
                },
                required: ['source', 'relationship', 'target'],
              },
            },
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
- classification_reasoning: brief explanation of the classification

Also extract named entities and relationships from the content:
- entities: organisations, certifications (e.g. ISO 27001, Cyber Essentials), regulations, frameworks, capabilities, people, technologies, projects, sectors mentioned in the text. For each entity provide its name as found in the text, its type, and a canonical_name (normalised form for deduplication, e.g. "ISO 27001" not "ISO27001").
- relationships: how entities relate to each other. Use relationship types: holds, complies_with, delivers_to, uses, demonstrated_by, requires, part_of, supersedes, references, evidences. Each relationship has a source (canonical name), relationship type, and target (canonical name).
Only include entities and relationships that are clearly stated or strongly implied in the content. If none are found, omit the arrays.`,
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

  // Store extracted entities (non-blocking — failures must not break classification)
  // Note: the entity_mentions table has a `context_snippet` column that is
  // reserved for future use (short excerpt showing where the entity was found).
  // It is intentionally not populated during classification — a future enhancement
  // could extract surrounding text from the content to populate it.
  if (result.entities?.length) {
    try {
      const entityRows = result.entities.map((e) => ({
        content_item_id: itemId,
        entity_type: e.type,
        entity_name: e.name,
        canonical_name: canonicalise(e.canonical_name),
        confidence: 1.0,
      }));

      const { error: entityError } = await supabase
        .from('entity_mentions')
        .upsert(entityRows, {
          onConflict: 'canonical_name,entity_type,content_item_id',
          ignoreDuplicates: true,
        });

      if (entityError) {
        console.error('Failed to store entity mentions:', entityError);
      }
    } catch (entityErr) {
      console.error('Entity mention storage failed:', entityErr);
    }
  }

  // Store extracted relationships (non-blocking)
  if (result.relationships?.length) {
    try {
      const relRows = result.relationships.map((r) => ({
        source_entity: canonicalise(r.source),
        relationship_type: r.relationship,
        target_entity: canonicalise(r.target),
        source_item_id: itemId,
        confidence: 1.0,
      }));

      const { error: relError } = await supabase
        .from('entity_relationships')
        .insert(relRows);

      if (relError) {
        console.error('Failed to store entity relationships:', relError);
      }
    } catch (relErr) {
      console.error('Entity relationship storage failed:', relErr);
    }
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
    entities: result.entities,
    relationships: result.relationships,
  };
}
