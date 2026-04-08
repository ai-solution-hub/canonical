/**
 * AI content classification.
 * Classifies a KB content item using Claude and updates the record.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel, estimateCost } from '@/lib/anthropic';
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
import { CLIENT_CONFIG, buildDisambiguationBlock } from '@/lib/client-config';
import { sb } from '@/lib/supabase/safe';

// ──────────────────────────────────────────
// Identifier exclusion patterns
// ──────────────────────────────────────────

/** Patterns matching non-entity identifiers that should be excluded from extraction */
const EXCLUDED_PATTERNS = [
  /^SIC\s*Code/i, // SIC classification codes
  /^VAT\s*(Registration|Reg)/i, // VAT registration numbers
  /^DUNS\s*Number/i, // D-U-N-S identifiers
  /^\d{4,}$/, // Pure numeric identifiers
  /^[A-Z]{2}\s*\d{3}\s*\d{4}\s*\d{2}$/i, // VAT number format
];

/** Check whether an entity name matches an excluded identifier pattern */
export function isExcludedEntity(name: string): boolean {
  return EXCLUDED_PATTERNS.some((p) => p.test(name));
}

// ──────────────────────────────────────────
// Entity quality filters (post-extraction)
// ──────────────────────────────────────────

/** Suffix patterns matching internal company documents (policies, procedures, plans, etc.) */
const INTERNAL_DOCUMENT_SUFFIXES = [
  /policy$/i,
  /procedure$/i,
  /plan$/i,
  /register$/i,
  /schedule$/i,
  /agreement$/i,
  /statement$/i,
  /process$/i,
];

/** Abstract concepts and generic terms that should not be extracted as entities */
const GENERIC_CONCEPTS = new Set([
  'information security',
  'information governance',
  'business continuity',
  'data protection',
  'regulatory compliance',
  'security best practice',
  'disaster recovery',
  'penetration testing',
  'encryption',
  'firewalls',
  'access control',
  'two-factor authentication',
  'multi-factor authentication',
  'social value',
  'data retention',
  'incident response',
  'risk management',
  'vulnerability management',
  'patch management',
  'change management',
  'physical security',
  'network security',
  'endpoint security',
  'security governance',
  'security awareness',
  'data wiping',
  'physical destruction',
  'staff vetting',
  'data handling',
  'continuous improvement',
  'service delivery',
  'information management',
  'security monitoring',
  'threat detection',
  'security best practices',
  // Security principles (not methodologies or frameworks)
  'principle of least privilege',
  'least privilege',
  'defence in depth',
  'defense in depth',
  'zero trust',
  'segregation of duty',
  'separation of duties',
  // Generic technology categories (not specific products)
  'cloud computing',
  'artificial intelligence',
  'machine learning',
  'blockchain',
  // Service tiers and generic descriptors
  'standard support',
  'premium support',
  'set-up fee',
  'setup fee',
  // Generic software categories
  'content management system',
  'learning management system',
  // Generic activities (not named projects)
  'cloud migration',
  'security improvement',
  // Product features (not products themselves)
  'single sign-on',
  // Internal departments and informal groupings
  'it department',
  'hr team',
  'the project team',
  'senior management',
  // Generic capability activities
  'online training',
  'staff training',
  // Geographic regions (not sectors)
  'england',
  'wales',
  'scotland',
  'northern ireland',
  'european economic area',
  'eea',
  // Demographic descriptions (not sectors)
  'vulnerable adults',
  'children and young people',
  // Safeguarding and social issues (not sectors)
  'county lines',
  'county lines criminal exploitation',
  'female genital mutilation',
  'child sexual exploitation',
  'child criminal exploitation',
  'domestic abuse',
  'modern slavery',
  'radicalisation',
  'forced marriage',
  'honour-based violence',
  // Generic methodology approaches
  'risk-based approach',
  'iterative development',
  'best practice',
  'best practices',
  'agile approach',
]);

/** Patterns matching job titles and role descriptions (not person names) */
const ROLE_TITLES = [
  /^(managing|account|project|customer|technical|operations|quality|it|security|senior|chief|lead)\s+(director|manager|officer|lead|executive|administrator|coordinator|consultant|engineer|developer|analyst|architect)/i,
  /^chief\s+\w+(\s+\w+)?\s+(officer|director)/i,
  /^(ceo|cto|cfo|cio|ciso|dpo|md)$/i,
  /^director$/i,
  /^manager$/i,
  /^officer$/i,
  /^data protection officer$/i,
  /^client project lead$/i,
  /^information security officer$/i,
];

/** Protocols, file formats, and cryptographic algorithms that should not be entities */
const PROTOCOL_FORMATS = new Set([
  'https',
  'http',
  'ssh',
  'ssl',
  'tls',
  'ftp',
  'sftp',
  'smtp',
  'dns',
  'tcp',
  'udp',
  'ldap',
  'oauth',
  'pdf',
  'csv',
  'html',
  'xml',
  'json',
  'javascript',
  'python',
  'java',
  'sql',
  'css',
  'aes-256',
  'aes',
  'sha-256',
  'rsa',
  'pbkdf2',
  'hmac',
  'sha256',
  'pbkdf2-hmac-sha256',
  'hmac-sha256',
  'aes-128',
  'sha-512',
]);

/** Insurance products and contract types that should not be entities */
const INSURANCE_AND_CONTRACTS = new Set([
  'professional indemnity insurance',
  'public liability insurance',
  'cyber liability insurance',
  'employer liability insurance',
  'employers liability insurance',
  'product liability insurance',
  'non-disclosure agreement',
  'service level agreement',
  'data processing agreement',
  'master services agreement',
]);

/** Management system acronyms — prefer the certification instead */
const MANAGEMENT_SYSTEM_ACRONYMS = new Set([
  'isms',
  'qms',
  'ems',
  'ims',
  'information security management system',
  'quality management system',
  'environmental management system',
  'integrated management system',
]);

/** GDPR artefacts that are legal concepts, not standalone entities */
const GDPR_ARTEFACTS = new Set([
  'records of processing activity',
  'record of processing activities',
  'data processing agreement',
  'data protection impact assessment',
  'data protection by design and default',
  'technical and organisational measures',
  'consent',
  'contractual necessity',
  'legal obligation',
  'legitimate interest',
  'vital interest',
  'public interest',
  'lawful basis',
  'lawful bases',
  'data subject access request',
  'right to erasure',
  'right to rectification',
  'right to portability',
  'data subject right',
  'data subject rights',
]);

/** Statutory documents that match suffix patterns but should be retained as regulation entities */
const STATUTORY_ALLOWLIST = new Set([
  'wales safeguarding procedure',
  'working together to safeguard children',
  'keeping children safe in education',
  'government security classification policy',
  'modern slavery statement',
]);

/** Check whether an entity name matches an internal document suffix pattern */
export function isInternalDocument(name: string): boolean {
  const trimmed = name.trim();
  if (STATUTORY_ALLOWLIST.has(trimmed.toLowerCase())) return false;
  return INTERNAL_DOCUMENT_SUFFIXES.some((p) => p.test(trimmed));
}

/** Check whether an entity name is a generic concept */
export function isGenericConcept(name: string): boolean {
  return GENERIC_CONCEPTS.has(name.toLowerCase().trim());
}

/** Check whether an entity name is a role title rather than a person name */
export function isRoleTitle(name: string): boolean {
  return ROLE_TITLES.some((p) => p.test(name.trim()));
}

/** Check whether an entity name is a protocol, file format, or algorithm */
export function isProtocolOrFormat(name: string): boolean {
  return PROTOCOL_FORMATS.has(name.toLowerCase().trim());
}

/** Check whether an entity name is an insurance product or contract type */
export function isInsuranceOrContract(name: string): boolean {
  return INSURANCE_AND_CONTRACTS.has(name.toLowerCase().trim());
}

/** Check whether an entity name is a management system acronym */
export function isManagementSystemAcronym(name: string): boolean {
  return MANAGEMENT_SYSTEM_ACRONYMS.has(name.toLowerCase().trim());
}

/** Check whether an entity name is a GDPR artefact */
export function isGdprArtefact(name: string): boolean {
  return GDPR_ARTEFACTS.has(name.toLowerCase().trim());
}

/** Pattern matching G-Cloud/framework lot numbers that are not real projects */
const FRAMEWORK_LOT_PATTERN =
  /^(g-cloud|dos|digital outcomes|digital specialists)\s*(lot\s*\d+|\d+)/i;

/** Check whether an entity name is a framework lot number (not a real project) */
export function isFrameworkLot(name: string): boolean {
  return FRAMEWORK_LOT_PATTERN.test(name.trim());
}

/** Check whether an entity name is a slash-separated compound (e.g. "ISO 27001/ISO 9001") */
export function isCompoundEntity(name: string): boolean {
  const trimmed = name.trim();
  return (
    /\//.test(trimmed) &&
    trimmed.split('/').length >= 2 &&
    trimmed.split('/').every((part) => part.trim().length > 2)
  );
}

/** Strip parenthetical role/company descriptions from person entity names */
export function stripPersonDescriptors(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Apply all post-extraction entity quality filters.
 * Returns true if the entity should be EXCLUDED (i.e. it is not a real entity).
 */
export function shouldExcludeEntity(entity: ExtractedEntity): boolean {
  const name = entity.name;
  const canonical = entity.canonical_name;

  // Identifier patterns (SIC codes, VAT numbers, etc.)
  if (isExcludedEntity(name) || isExcludedEntity(canonical)) return true;

  // Internal documents (policies, procedures, plans, etc.)
  if (isInternalDocument(canonical)) return true;

  // Generic concepts (abstract terms that are not named entities)
  if (isGenericConcept(canonical)) return true;

  // Role titles (regardless of entity type — they can be mistyped as organisation, etc.)
  if (isRoleTitle(name)) return true;

  // Protocols, file formats, and cryptographic algorithms
  if (isProtocolOrFormat(canonical)) return true;

  // Insurance products and contract types
  if (isInsuranceOrContract(canonical)) return true;

  // Management system acronyms (prefer the certification)
  if (isManagementSystemAcronym(canonical)) return true;

  // GDPR artefacts (legal concepts within GDPR, not standalone entities)
  if (isGdprArtefact(canonical)) return true;

  // Framework lot numbers (e.g. "G-Cloud Lot 1") mistyped as projects
  if (entity.type === 'project' && isFrameworkLot(name)) return true;

  // Slash-separated compound entities (e.g. "ISO 27001/ISO 9001")
  if (isCompoundEntity(name)) return true;

  return false;
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
  const closest = validDomains.find(
    (d) => d.includes(slug) || slug.includes(d),
  );
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
  /** When true, run a second LLM pass to validate extracted entities. Default: false. */
  validate?: boolean;
}

// ──────────────────────────────────────────
// Pass 2: Entity validation types
// ──────────────────────────────────────────

export interface ValidatedEntity {
  name: string;
  type: ExtractedEntity['type'];
  canonical_name: string;
  verdict: 'confirmed' | 'removed' | 'retyped';
  /** Populated when verdict is 'retyped' — the original type before correction */
  original_type?: string;
  /** Brief justification for the verdict */
  reason: string;
}

export interface EntityValidationResult {
  validated_entities: ValidatedEntity[];
  removed_count: number;
  retyped_count: number;
  confirmed_count: number;
}

// ──────────────────────────────────────────
// Pass 2: Entity validation
// ──────────────────────────────────────────

/** Entity type enum values for the validation tool schema */
const ENTITY_TYPE_ENUM = [
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
] as const;

/** The Haiku model used for Pass 2 entity validation */
const PASS_2_MODEL = 'claude-haiku-4-5';

/**
 * Build the validation prompt for Pass 2.
 * Embeds compressed universal rules and per-type diagnostic questions.
 */
function buildValidationPrompt(
  entities: ExtractedEntity[],
  contentExcerpt: string,
  contentTitle: string,
  contentType: string,
): string {
  const entityList = entities
    .map((e, i) => `${i + 1}. "${e.name}" (type: ${e.type}, canonical: "${e.canonical_name}")`)
    .join('\n');

  return `You are an entity validation assistant for a UK knowledge base. You will review
a list of entities extracted from content by a classification pipeline and
determine whether each entity is valid.

For EACH entity, apply these tests in order:

1. NAMED ENTITY TEST: Is this a specific, named thing that exists independently
   of the document discussing it? Generic concepts (information security, data
   protection, encryption, business continuity, risk management, etc.) FAIL.

2. EXTERNAL REFERENCE TEST: Could someone outside this organisation look this
   up and find an independent definition or registration? Internal documents
   (policies, procedures, plans, registers, agreements, statements) FAIL.

3. ROLE TITLE TEST: Is this a job title or role description rather than a
   person's name? (Managing Director, DPO, Project Manager, IT Director) FAIL.

4. PROTOCOL/FORMAT TEST: Is this a protocol (HTTPS, SSH, TLS), file format
   (PDF, CSV), programming language (Python, JavaScript), or cryptographic
   algorithm (AES-256, RSA)? These are NOT entities. FAIL.

5. TYPE ACCURACY TEST: Does the assigned type match the entity? Apply these
   diagnostic questions:
   - organisation: Does it have a legal registration or government charter?
   - certification: Is it obtained by assessment with an issuing body and
     renewal cycle?
   - regulation: Does non-compliance carry legal penalties?
   - framework: Is it published guidance for voluntary adoption, without legal
     force?
   - capability: Would the organisation list this on its website as a service
     it offers?
   - person: Is this the actual name of a specific individual?
   - technology: Is this a specific named platform with a vendor and version?
   - project: Is this a named piece of work with a start, scope, and end?
   - sector: Is this a recognised industry classification?
   - product: Is this a named branded offering the organisation sells?
   - standard: Is this a numbered document published by a standards body?
   - methodology: Is this a named approach to work with its own body of
     knowledge?

Common false positives to catch:
- ISMS/QMS/EMS are management systems, not certifications or frameworks
- Insurance products (professional indemnity, public liability) are NOT entities
- GDPR artefacts (DPIA, ROPA, lawful basis, consent) are NOT standalone entities
- Contract types (NDA, SLA, DPA) are NOT entities
- Security principles (defence in depth, zero trust, least privilege) are NOT
  entities or methodologies
- Geographic regions (England, Wales, Scotland) are NOT sectors
- Internal departments (IT Department, HR Team) are NOT organisations

For each entity, return a verdict:
- "confirmed" if it passes all tests with the correct type
- "retyped" if the entity is valid but has the wrong type (provide corrected
  type)
- "removed" if it fails any test (provide reason)

Content title: ${contentTitle}
Content type: ${contentType}

Content excerpt:
${contentExcerpt}

Entities to validate:
${entityList}`;
}

/**
 * Pass 2: Validate extracted entities using Claude Haiku.
 *
 * Reviews each entity from Pass 1 against diagnostic questions and
 * universal exclusion rules. Returns a verdict for each entity:
 * confirmed, removed, or retyped.
 *
 * @param entities - Entities that survived deterministic filters
 * @param contentExcerpt - First 2,000 characters of the plain text content
 * @param contentTitle - Title of the content item
 * @param contentType - Content type (e.g. q_a_pair, policy, article)
 * @returns Validation results with verdicts and token usage summary
 */
export async function validateEntities(
  entities: ExtractedEntity[],
  contentExcerpt: string,
  contentTitle: string,
  contentType: string,
): Promise<EntityValidationResult> {
  // Skip if no entities to validate
  if (!entities.length) {
    return {
      validated_entities: [],
      removed_count: 0,
      retyped_count: 0,
      confirmed_count: 0,
    };
  }

  const prompt = buildValidationPrompt(
    entities,
    contentExcerpt,
    contentTitle,
    contentType,
  );

  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: PASS_2_MODEL,
    max_tokens: 1500,
    tools: [
      {
        name: 'return_entity_validation',
        description: 'Return validated entity list with verdicts',
        input_schema: {
          type: 'object' as const,
          properties: {
            validated_entities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: [...ENTITY_TYPE_ENUM],
                  },
                  canonical_name: { type: 'string' },
                  verdict: {
                    type: 'string',
                    enum: ['confirmed', 'removed', 'retyped'],
                  },
                  original_type: { type: ['string', 'null'] },
                  reason: { type: 'string' },
                },
                required: [
                  'name',
                  'type',
                  'canonical_name',
                  'verdict',
                  'reason',
                ],
              },
            },
          },
          required: ['validated_entities'],
        },
      },
    ],
    tool_choice: { type: 'tool' as const, name: 'return_entity_validation' },
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Track and log token usage
  const usage = response.usage;
  const cost = estimateCost(PASS_2_MODEL, {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
  });

  const result = extractToolResult<{ validated_entities: ValidatedEntity[] }>(
    response,
    'return_entity_validation',
  );

  const removedCount = result.validated_entities.filter(
    (v) => v.verdict === 'removed',
  ).length;
  const retypedCount = result.validated_entities.filter(
    (v) => v.verdict === 'retyped',
  ).length;
  const confirmedCount = result.validated_entities.filter(
    (v) => v.verdict === 'confirmed',
  ).length;

  console.log(
    `[Pass 2 Validation] ${confirmedCount} confirmed, ${retypedCount} retyped, ${removedCount} removed | ` +
      `Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out | ` +
      `Cost: $${cost.toFixed(4)}`,
  );

  return {
    validated_entities: result.validated_entities,
    removed_count: removedCount,
    retyped_count: retypedCount,
    confirmed_count: confirmedCount,
  };
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
export async function classifyContent(
  params: ClassifyParams,
): Promise<ClassificationResult> {
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

  // Load classification skill files — main skill + entity types reference
  const classificationSkill = await loadSkill('classification');
  const entityTypesRef = await loadSkill('classification-entity-types');

  // Build taxonomy string from DB
  const domains = await sb(
    supabase
      .from('taxonomy_domains')
      .select('id, name')
      .eq('is_active', true)
      .order('display_order'),
    'taxonomy.domains.list',
  );

  const subtopics = await sb(
    supabase
      .from('taxonomy_subtopics')
      .select('name, domain_id')
      .eq('is_active', true)
      .order('display_order'),
    'taxonomy.subtopics.list',
  );

  const taxonomyStr = domains
    .map((d) => {
      const subs = subtopics
        .filter((s) => s.domain_id === d.id)
        .map((s) => s.name);
      return `- ${d.name}: ${subs.join(', ')}`;
    })
    .join('\n');

  // Interpolate placeholders in the skill file content. The disambiguation
  // block is sourced from CLIENT_CONFIG so new clients can add their own
  // rules without touching this file — see lib/client-config.ts
  // classification_disambiguation_rules. Placeholders inside the rules
  // (e.g. {CLIENT_PRODUCT_NAME}) are resolved by the .replaceAll chain
  // below after the {CLIENT_DISAMBIGUATION} substitution.
  const prompt = classificationSkill
    .replace('{TAXONOMY}', taxonomyStr)
    .replace('{CLIENT_DISAMBIGUATION}', buildDisambiguationBlock())
    .replaceAll('{CLIENT_ORGANISATION_NAME}', CLIENT_CONFIG.entity_examples.organisation_name)
    .replaceAll('{CLIENT_ORGANISATION_SHORT}', CLIENT_CONFIG.entity_examples.organisation_short)
    .replaceAll('{CLIENT_PRODUCT_NAME}', CLIENT_CONFIG.entity_examples.product_name)
    .replaceAll('{CLIENT_PRODUCT_SHORT}', CLIENT_CONFIG.entity_examples.product_short)
    + '\n\n---\n\n' + entityTypesRef;

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
              description: 'Named entities extracted from the content',
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
                      'Entity type — see ENTITY TYPES section in the prompt for definitions and examples.',
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
              description: 'Relationships between extracted entities',
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
                    description:
                      'ISO 8601 date string (YYYY-MM-DD) or ISO 8601 duration (e.g. P1Y, P3M)',
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
        content: `${prompt}

Content type: ${item.content_type}
Title: ${item.title}

Content:
${contentForClassification}`,
      },
    ],
  });

  // Track Pass 1 token usage and cost
  const pass1Usage = response.usage;
  const pass1Cost = estimateCost(model, pass1Usage);
  console.log(
    `[Pass 1 Classification] ${item.title?.slice(0, 60)} — ` +
    `${pass1Usage.input_tokens} in / ${pass1Usage.output_tokens} out — ` +
    `$${pass1Cost.toFixed(4)}`,
  );

  const result = extractToolResult<ClassificationResult>(
    response,
    'return_classification',
  );

  // Validate domains against taxonomy slugs
  const validDomainSlugs = (domains ?? []).map((d) => d.name);
  if (validDomainSlugs.length > 0) {
    result.primary_domain = validateDomain(
      result.primary_domain,
      validDomainSlugs,
    );
    if (result.secondary_domain) {
      result.secondary_domain = validateDomain(
        result.secondary_domain,
        validDomainSlugs,
      );
    }
  }

  // Normalise AI keywords before storage to prevent duplicates.
  // Defensive: the schema marks ai_keywords required, but Claude occasionally
  // omits the field; treat undefined/null as an empty list rather than crashing.
  const normalisedKeywords = (result.ai_keywords ?? [])
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
    console.error(
      'Embedding regeneration during classification failed:',
      embedErr,
    );
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
      console.error(
        'Failed to merge temporal references into metadata:',
        temporalErr,
      );
    }
  }

  const { error: updateError } = await supabase
    .from('content_items')
    .update(updateData)
    .eq('id', itemId);

  if (updateError) {
    console.error('Failed to update classification:', updateError);
    throw new AIServiceError(
      'Classification succeeded but failed to store',
      500,
    );
  }

  // Store extracted entities (non-blocking — failures must not break classification)
  // Note: the entity_mentions table has a `context_snippet` column populated
  // via extractEntityContext() — a short excerpt showing where the entity was
  // found in the source content.
  // Load entity aliases from DB before entity/relationship storage
  await loadAliases(supabase);

  if (result.entities?.length) {
    try {
      // Step 14a: Apply deterministic filters FIRST (free, instant, high precision)
      const deterministicallyFiltered = result.entities.filter(
        (e) => !shouldExcludeEntity(e),
      );

      // Step 14b: IF validate, run LLM validation on the survivors
      let finalEntities: ExtractedEntity[] = deterministicallyFiltered;
      if (params.validate && deterministicallyFiltered.length > 0) {
        try {
          const contentExcerpt = contentForClassification.slice(0, 2000);
          const validation = await validateEntities(
            deterministicallyFiltered,
            contentExcerpt,
            item.title,
            item.content_type,
          );
          // Keep only confirmed and retyped entities; apply retyped types
          finalEntities = validation.validated_entities
            .filter((v) => v.verdict !== 'removed')
            .map((v) => ({
              name: v.name,
              type: v.type, // Already corrected for retyped entities
              canonical_name: v.canonical_name,
            }));
        } catch (validationErr) {
          console.error('Entity validation (Pass 2) failed:', validationErr);
          // Graceful degradation: fall back to deterministically-filtered entities
          finalEntities = deterministicallyFiltered;
        }
      }

      // Step 15: Store entity mentions using finalEntities
      const entityRows = finalEntities.map((e) => {
        // Strip parenthetical role/company descriptions from person names
        const name =
          e.type === 'person' ? stripPersonDescriptors(e.name) : e.name;
        const canonicalRaw =
          e.type === 'person'
            ? stripPersonDescriptors(e.canonical_name)
            : e.canonical_name;
        return {
          content_item_id: itemId,
          entity_type: e.type,
          entity_name: name,
          canonical_name: resolveAlias(
            canonicalise(canonicalRaw, e.type),
          ).toLowerCase(),
          confidence: 1.0,
          context_snippet: extractEntityContext(plainText, e.name),
        };
      });

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
