/**
 * AI content classification.
 * Classifies a KB content item using Claude and updates the record.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import { generateEmbedding } from '@/lib/ai/embed';
import { htmlToPlainText } from '@/lib/editor-utils';
import { AIServiceError } from '@/lib/ai/errors';
import { loadSkill } from '@/lib/ai/skills/loader';
import { canonicalise } from '@/lib/entities/entity-dedup';
import { resolveAlias, loadAliases } from '@/lib/entities/entity-aliases';
import { extractEntityContext } from '@/lib/entities/entity-context';
import { bridgeTemporalReferencesToEntities } from '@/lib/entities/entity-metadata-bridge';
import { normaliseTag } from '@/lib/validation/schemas';
import { CLIENT_CONFIG } from '@/lib/client-config';

// ──────────────────────────────────────────
// Identifier exclusion patterns
// ──────────────────────────────────────────

/** Patterns matching non-entity identifiers that should be excluded from extraction */
const EXCLUDED_PATTERNS = [
  /^SIC\s*Code/i,                          // SIC classification codes
  /^VAT\s*(Registration|Reg)/i,            // VAT registration numbers
  /^DUNS\s*Number/i,                       // D-U-N-S identifiers
  /^\d{4,}$/,                              // Pure numeric identifiers
  /^[A-Z]{2}\s*\d{3}\s*\d{4}\s*\d{2}$/i,  // VAT number format
];

/** Check whether an entity name matches an excluded identifier pattern */
export function isExcludedEntity(name: string): boolean {
  return EXCLUDED_PATTERNS.some((p) => p.test(name));
}

// ──────────────────────────────────────────
// Domain validation
// ──────────────────────────────────────────

/**
 * Normalise an AI-returned domain string to a valid taxonomy slug.
 * Converts to lowercase kebab-case, strips non-alphanumeric characters,
 * then matches against the list of valid domain slugs.
 */
export function validateDomain(domain: string, validDomains: string[]): string {
  const slug = domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const exact = validDomains.find((d) => d === slug);
  if (exact) return exact;
  // Fuzzy match: find closest valid domain by substring containment
  const closest = validDomains.find((d) => d.includes(slug) || slug.includes(d));
  return closest ?? validDomains[0]; // Fallback to first domain
}

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
    | 'sector'
    | 'product'
    | 'standard'
    | 'methodology';
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

/** AI-extracted temporal reference from content classification. */
export interface ClassificationTemporalReference {
  /** ISO 8601 date string */
  date: string;
  /** What this date refers to (e.g. "ICO registration expiry") */
  context: string;
  /** Classification of the date's purpose */
  context_type: 'expiry' | 'effective' | 'historical' | 'unknown';
  /** Canonical name of the entity this temporal reference relates to, if any */
  related_entity?: string;
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
  /** AI-extracted temporal references — optional, returned when Claude detects dates */
  temporal_references?: ClassificationTemporalReference[];
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
      'id, title, content, content_type, classified_at, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, ai_keywords, ai_summary, suggested_title, classification_confidence, classification_reasoning, metadata',
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
                    description:
                      'Entity type. organisation: named companies/bodies. certification: accreditations held (ISO 27001, Cyber Essentials). regulation: laws with legal force (GDPR, DPA 2018, Equality Act 2010). framework: external standards, methodologies, or best-practice frameworks an organisation adopts (ITIL, PRINCE2, COBIT) — do NOT use for internal policies or procedures. capability: something the organisation does, provides, or maintains — includes internal policies (Information Security Policy, Acceptable Use Policy), service offerings, and operational competencies. person: named individuals. technology: general technology categories (cloud computing, AI, blockchain). project: named projects or programmes. sector: industry sectors. product: commercial products, platforms, or named software systems (WordPress, SharePoint). standard: published technical standards (BS 5839, WCAG 2.1, HL7). methodology: delivery approaches and principles (Agile, Lean, Six Sigma).',
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
                      'product',
                      'standard',
                      'methodology',
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
            temporal_references: {
              type: 'array',
              description:
                'Dates and temporal references found in the content (expiry dates, renewal dates, effective dates, etc.). For each date, identify which entity it relates to if possible.',
              items: {
                type: 'object',
                properties: {
                  date: {
                    type: 'string',
                    description: 'ISO 8601 date string (YYYY-MM-DD) or ISO 8601 duration (e.g. P1Y, P3M)',
                  },
                  context: {
                    type: 'string',
                    description:
                      'What this date refers to (e.g. "ICO registration expiry")',
                  },
                  context_type: {
                    type: 'string',
                    enum: ['expiry', 'effective', 'historical', 'unknown'],
                    description:
                      'Classification: expiry (when something becomes invalid), effective (when something started), historical (background context), unknown',
                  },
                  related_entity: {
                    type: ['string', 'null'],
                    description:
                      'The canonical name of the entity this date relates to (e.g. "ISO 27001" for an ISO 27001 certification expiry date, "GDPR" for a GDPR effective date). Use the same canonical_name form as in the entities array. Null if the date is not related to a specific extracted entity.',
                  },
                },
                required: ['date', 'context', 'context_type'],
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

IMPORTANT disambiguation rules:
- "${CLIENT_CONFIG.entity_examples.product_name}" is a SOFTWARE PRODUCT, not an auditing process. Questions about its features (action plans, invites, reports, exports, user interface) belong in product-feature/*, NOT compliance/audit.
- Business continuity and disaster recovery (BC/DR) belong in security/cyber-security, not support/* or product-feature/*.
- Security awareness training, confidentiality clauses, and security governance belong in security/data-protection or corporate/staffing, NOT support/sla.
- Data security controls (encryption, access control, secure data transfer, infrastructure security) belong in security/*, NOT product-feature/*.
- Financial questions (pricing, costs, audited accounts, hidden costs) belong in corporate/financial.

Content type: ${item.content_type}
Title: ${item.title}

Content:
${contentForClassification}

Classify this content. Return a JSON object with:
- primary_domain: the best-fitting domain
- primary_subtopic: the best-fitting subtopic within that domain
- secondary_domain: a second relevant domain (or null)
- secondary_subtopic: a second relevant subtopic (or null)
- ai_keywords: 3-5 specific keywords/phrases. Always lowercase unless the term is a proper noun, acronym, or named standard (e.g. "ISO 27001", "GDPR", "Cyber Essentials Plus"). Rules: (1) Use singular form ("access control" not "access controls"). (2) Maximum 4 words per keyword. (3) Prefer the BROADEST applicable term — use "access control" not "role-based access control" unless specificity is critical. (4) Never assign two keywords where one is a subset of the other (e.g. do not assign both "GDPR" and "GDPR compliance"). (5) Prefer reusing existing high-frequency tags over inventing new ones
- ai_summary: one sentence summary (max 200 chars)
- suggested_title: a clear, descriptive title (40-100 chars)
- classification_confidence: 0.0-1.0
- classification_reasoning: brief explanation of the classification

Also extract named entities and relationships from the content:
- entities: organisations, certifications (e.g. ISO 27001, Cyber Essentials), regulations, frameworks, capabilities, people, technologies, projects, sectors, products, standards, and methodologies mentioned in the text. For each entity provide its name as found in the text, its type, and a canonical_name (normalised form for deduplication, e.g. "ISO 27001" not "ISO27001"). Do not extract SIC codes, VAT registration numbers, DUNS numbers, or other numeric identifiers as entities.
  Entity type guidance:
  - framework: EXTERNAL standards, methodologies, or best-practice frameworks that an organisation chooses to adopt (e.g. ITIL, PRINCE2, COBIT, TOGAF). Do NOT classify internal policies or procedures as framework — those are capabilities.
  - capability: something the organisation does, provides, or maintains. This includes internal policies (Information Security Policy, Acceptable Use Policy, Data Protection Policy, Business Continuity Policy), service offerings, and operational competencies. If a document title ends in "Policy" or "Procedure", it is almost certainly a capability, not a framework.
  - regulation: laws and regulations with legal force (GDPR, DPA 2018, Equality Act 2010, PECR). Must be externally imposed by a government or regulatory body.
  - certification: accreditations or certifications held by the organisation (ISO 27001 certification, Cyber Essentials Plus, ISO 9001). The credential itself, not the standard behind it.
  - product: commercial products, platforms, or named software systems. Not technologies (those are general tech categories). Examples: WordPress, example-client LMS, SharePoint.
  - standard: published technical standards (ISO, BS, WCAG, HL7, IEEE). Not regulations (those have legal force) or frameworks (those are management systems). Examples: BS 5839, WCAG 2.1, HL7.
  - methodology: approaches, principles, and delivery methods. Not frameworks (those have formal structure). Examples: Agile, Lean, Six Sigma, Principle of Least Privilege.
- relationships: how entities relate to each other. Use relationship types: holds, complies_with, delivers_to, uses, demonstrated_by, requires, part_of, supersedes, references, evidences. Each relationship has a source (canonical name), relationship type, and target (canonical name).
When extracting entities, prefer the full formal name of organisations (e.g. "${CLIENT_CONFIG.entity_examples.organisation_name}" not "${CLIENT_CONFIG.entity_examples.organisation_short}"), the standard short form of certifications (e.g. "ISO 27001" not "ISO/IEC 27001:2022"), and established product names (e.g. "${CLIENT_CONFIG.entity_examples.product_name}" not "${CLIENT_CONFIG.entity_examples.product_short}").
Only include entities and relationships that are clearly stated or strongly implied in the content. If none are found, omit the arrays.

Also extract any temporal references (dates, deadlines, expiry dates, renewal dates) from the content. Classify each as expiry (when something becomes invalid or needs renewal), effective (when something started or was issued), historical (background context such as founding dates), or unknown. For each temporal reference, provide the ISO date string (YYYY-MM-DD), the surrounding context snippet, and the context_type. Additionally, if the temporal reference relates to a specific entity you extracted above, include the related_entity field with the canonical_name of that entity (e.g. if "ISO 27001 certification expires March 2027", set related_entity to "ISO 27001"). This linking is critical for expiry and effective dates on certifications, frameworks, and regulations — always provide related_entity when the date clearly belongs to an extracted entity. If no temporal references are found, omit the array.`,
      },
    ],
  });

  const result = extractToolResult<ClassificationResult>(
    response,
    'return_classification',
  );

  // Validate domains against taxonomy slugs
  const validDomainSlugs = (domains ?? []).map((d) => d.name);
  if (validDomainSlugs.length > 0) {
    result.primary_domain = validateDomain(result.primary_domain, validDomainSlugs);
    if (result.secondary_domain) {
      result.secondary_domain = validateDomain(result.secondary_domain, validDomainSlugs);
    }
  }

  // Normalise AI keywords before storage to prevent duplicates
  const normalisedKeywords = result.ai_keywords
    .map(normaliseTag)
    .filter((k) => k.length > 0);
  // Deduplicate after normalisation (different forms may collapse)
  const uniqueKeywords = [...new Set(normalisedKeywords)];

  // Update the content item with classification results
  const updateData: Record<string, unknown> = {
    primary_domain: result.primary_domain,
    primary_subtopic: result.primary_subtopic,
    secondary_domain: result.secondary_domain ?? null,
    secondary_subtopic: result.secondary_subtopic ?? null,
    ai_keywords: uniqueKeywords,
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

  // Store AI-extracted temporal references in item metadata (non-blocking)
  if (result.temporal_references?.length) {
    try {
      const existingMetadata = (item.metadata as Record<string, unknown>) ?? {};
      updateData.metadata = {
        ...existingMetadata,
        ai_temporal_references: result.temporal_references as unknown as Json,
      };
    } catch (temporalErr) {
      console.error('Failed to merge temporal references into metadata:', temporalErr);
    }
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
  // Note: the entity_mentions table has a `context_snippet` column populated
  // via extractEntityContext() — a short excerpt showing where the entity was
  // found in the source content.
  // Load entity aliases from DB before entity/relationship storage
  await loadAliases(supabase);

  if (result.entities?.length) {
    try {
      const entityRows = result.entities
        .filter((e) => !isExcludedEntity(e.name) && !isExcludedEntity(e.canonical_name))
        .map((e) => ({
          content_item_id: itemId,
          entity_type: e.type,
          entity_name: e.name,
          canonical_name: resolveAlias(canonicalise(e.canonical_name, e.type)).toLowerCase(),
          confidence: 1.0,
          context_snippet: extractEntityContext(plainText, e.name),
        }));

      if (entityRows.length > 0) {
        const { error: entityError } = await supabase
          .from('entity_mentions')
          .upsert(entityRows, {
            onConflict: 'canonical_name,entity_type,content_item_id',
            ignoreDuplicates: true,
          });

        if (entityError) {
          console.error('Failed to store entity mentions:', entityError);
        }
      }
    } catch (entityErr) {
      console.error('Entity mention storage failed:', entityErr);
    }
  }

  // Store extracted relationships (non-blocking)
  if (result.relationships?.length) {
    try {
      const relRows = result.relationships.map((r) => ({
        source_entity: resolveAlias(canonicalise(r.source)).toLowerCase(),
        relationship_type: r.relationship,
        target_entity: resolveAlias(canonicalise(r.target)).toLowerCase(),
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

  // Bridge temporal references to entity mention metadata (non-blocking)
  try {
    await bridgeTemporalReferencesToEntities(supabase, itemId);
  } catch (bridgeErr) {
    console.error('Temporal reference bridging failed:', bridgeErr);
  }

  return {
    primary_domain: result.primary_domain,
    primary_subtopic: result.primary_subtopic,
    secondary_domain: result.secondary_domain ?? null,
    secondary_subtopic: result.secondary_subtopic ?? null,
    ai_keywords: uniqueKeywords,
    ai_summary: result.ai_summary,
    suggested_title: result.suggested_title,
    classification_confidence: result.classification_confidence,
    classification_reasoning: result.classification_reasoning,
    entities: result.entities,
    relationships: result.relationships,
    temporal_references: result.temporal_references,
  };
}
