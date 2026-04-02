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
  'saml',
  'oauth',
  'pdf',
  'csv',
  'html',
  'xml',
  'json',
  'javascript',
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

  // Role titles extracted as person entities
  if (entity.type === 'person' && isRoleTitle(name)) return true;

  // Protocols, file formats, and cryptographic algorithms
  if (isProtocolOrFormat(canonical)) return true;

  // Insurance products and contract types
  if (isInsuranceOrContract(canonical)) return true;

  // Management system acronyms (prefer the certification)
  if (isManagementSystemAcronym(canonical)) return true;

  // GDPR artefacts (legal concepts within GDPR, not standalone entities)
  if (isGdprArtefact(canonical)) return true;

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

ENTITY EXTRACTION RULES — READ BEFORE EXTRACTING:

Before extracting ANY entity, apply these tests in order:

1. THE NAMED ENTITY TEST: Is this a specific, named thing that exists independently of the document discussing it? "ISO 27001" exists independently → entity. "information security" is an abstract concept → NOT an entity.

2. THE EXTERNAL REFERENCE TEST: Could someone outside this organisation look this up and find an independent definition? "GDPR" has an independent definition → entity. "Information Security Policy" is this company's internal document → NOT an entity.

3. THE POLICY/PROCEDURE/PLAN RULE: Any term ending in "Policy", "Procedure", "Plan", "Register", "Schedule", "Agreement", "Statement", or "Process" is almost certainly an internal document → DO NOT EXTRACT. Exception: named statutory guidance with legal force (e.g., "Working Together to Safeguard Children" → regulation).

4. THE ROLE TITLE RULE: Job titles and role descriptions are NOT person entities. Only extract actual personal names. "Managing Director" → NOT an entity. "Jane Smith" → person entity.

5. THE GENERIC CONCEPT RULE: Abstract concepts, security principles, and general practices are NOT entities. Examples of what NOT to extract: information security, business continuity, data protection, regulatory compliance, encryption, firewalls, penetration testing, access control, disaster recovery, two-factor authentication.

DO NOT EXTRACT:
- Internal company policies (Information Security Policy, Acceptable Use Policy, Data Protection Policy, etc.)
- Internal company plans (Business Continuity Plan, Disaster Recovery Plan, Incident Response Plan, etc.)
- Generic security concepts (information governance, security best practice, security monitoring, etc.)
- GDPR artefacts (records of processing activity, data processing agreement, consent as lawful basis, data subject access request, etc.)
- Protocols and file formats (HTTPS, SSH, SSL, TLS, PDF, CSV, HTML, JavaScript)
- Cryptographic algorithms (AES-256, SHA-256, RSA, PBKDF2)
- Job titles and role descriptions (Managing Director, Data Protection Officer, Account Manager)
- Insurance products (professional indemnity insurance, cyber liability insurance)
- Contract types (non-disclosure agreement, service level agreement)
- Management system acronyms (ISMS, QMS, EMS, IMS) — extract the certification instead (e.g., ISO 27001)

ENTITY TYPES (only use after passing the exclusion tests above):
- organisation: Named companies, government bodies, industry bodies (e.g., NHS, NCSC, ICO, Companies House)
- certification: Accreditations or certifications held (e.g., ISO 27001, Cyber Essentials Plus, ISO 9001, PCI DSS)
- regulation: Laws with legal force imposed by government (e.g., GDPR, DPA 2018, Equality Act 2010, RIDDOR)
- framework: External best-practice frameworks an organisation adopts (e.g., ITIL, COBIT, NIST CSF, OWASP) — NEVER internal policies
- capability: Named service offerings the organisation provides to clients (e.g., cloud migration, managed detection and response) — NOT internal policies, NOT generic concepts
- person: Named individuals only — never job titles (e.g., Jane Smith, John Doe)
- technology: Named commercial platforms and cloud services (e.g., AWS, Azure, Microsoft 365) — NOT protocols, file formats, or algorithms
- project: Named projects or programmes (e.g., NHS Digital Transformation Programme)
- sector: Industry sectors (e.g., healthcare, education, financial services)
- product: Named commercial software products (e.g., WordPress, SharePoint, ServiceNow) — NOT insurance products or contract types
- standard: Published technical standards by standards bodies (e.g., BS 5839, WCAG 2.1, ISO 22301) — NOT contracts or internal policies
- methodology: Named delivery approaches (e.g., Agile, Lean, Six Sigma, PRINCE2) — NOT internal processes

Extract entities and relationships from the content:
- entities: For each entity provide its name as found in the text, its type (from the list above), and a canonical_name (normalised form for deduplication, e.g. "ISO 27001" not "ISO27001"). Do not extract SIC codes, VAT registration numbers, DUNS numbers, or other numeric identifiers.
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
      const entityRows = result.entities
        .filter((e) => !shouldExcludeEntity(e))
        .map((e) => ({
          content_item_id: itemId,
          entity_type: e.type,
          entity_name: e.name,
          canonical_name: resolveAlias(
            canonicalise(e.canonical_name, e.type),
          ).toLowerCase(),
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
