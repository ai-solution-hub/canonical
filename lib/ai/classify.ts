/**
 * AI content classification.
 * Classifies a KB content item using Claude and updates the record.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel, estimateCost } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import { generateEmbedding, MAX_EMBEDDING_CHARS } from '@/lib/ai/embed';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { AIServiceError } from '@/lib/ai/errors';
import { loadSkill } from '@/lib/ai/skills/loader';
import { canonicalise } from '@/lib/entities/entity-dedup';
import { resolveAlias, loadAliases } from '@/lib/entities/entity-aliases';
import { extractEntityContext } from '@/lib/entities/entity-context';
import { bridgeTemporalReferencesToEntities } from '@/lib/entities/entity-metadata-bridge';
import { normaliseTag } from '@/lib/validation/schemas';
import {
  CLIENT_CONFIG,
  BRANDING,
  buildDisambiguationBlock,
} from '@/lib/client-config';
import { sb } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { logger } from '@/lib/logger';

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
  // Generic methodology/framework practices
  'asset management',
  'code review',
  'configuration management',
  'data classification',
  'identity and access management',
  'information risk analysis',
  'logging and monitoring',
  'network architecture',
  'secure development',
  'security architecture',
  'supply chain security',
  'threat modelling',
  'threat modeling',
  'user acceptance testing',
  'vulnerability scanning',
  // Generic process/activity terms
  'escalation procedures',
  'post-resolution satisfaction surveys',
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
// Entity mention row dedup (pre-upsert boundary)
// ──────────────────────────────────────────

/**
 * Shape of a row inserted into `entity_mentions` by the Step 15 pipeline.
 *
 * Kept as a structural type (not a DB-generated interface) because the
 * dedup helper operates purely on the normalised-for-upsert form — it
 * runs after canonicalise + alias-resolve + lowercase, and must NOT be
 * coupled to downstream DB schema churn.
 */
export interface EntityMentionRow {
  content_item_id: string;
  entity_type: string;
  entity_name: string;
  canonical_name: string;
  confidence: number;
  context_snippet: string | null;
  metadata?: Json | null;
}

/**
 * Collapse duplicate `(content_item_id, canonical_name, entity_type)`
 * triples to a single row before the `entity_mentions` upsert.
 *
 * Background: the `canonicalise() + resolveAlias() + toLowerCase()`
 * chain in Step 15 can collapse two distinct Pass 1 outputs (e.g.
 * "ISO 27001" and "ISO27001", or "DPO" and "Data Protection Officer")
 * onto the same triple. Postgres then rejects the upsert with error
 * `21000` ("ON CONFLICT DO UPDATE command cannot affect row a second
 * time") because a single statement cannot update the same conflict
 * target twice. Dedupe at the client boundary so the upsert payload is
 * always triple-unique.
 *
 * Merge rules for a duplicate group:
 * - `confidence`: max across the group.
 * - `entity_name`: first encountered (preserves Pass 2 confirmed order).
 * - `context_snippet`: first non-null in group; null if all null.
 * - `content_item_id` / `entity_type` / `canonical_name`: identical by
 *   construction of the dedup key; taken from the first row.
 *
 * Deterministic: stable input order produces stable output order (rows
 * are emitted in the order their first occurrence appeared in input).
 *
 * @param rows - pre-upsert entity mention rows (may contain duplicates).
 * @returns new array with duplicate triples merged; input is not mutated.
 */
/**
 * Narrow a Json-typed value to a plain object for spreading.
 * Returns `{}` for null/undefined/primitive/array cases.
 */
function toPlainObject(
  value: Json | null | undefined,
): Record<string, Json | undefined> {
  if (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value as Record<string, Json | undefined>;
  }
  return {};
}

export function dedupeEntityMentionRows(
  rows: EntityMentionRow[],
): EntityMentionRow[] {
  const byKey = new Map<string, EntityMentionRow>();
  const order: string[] = [];

  for (const row of rows) {
    const key = `${row.content_item_id}::${row.canonical_name}::${row.entity_type}`;
    const existing = byKey.get(key);
    if (!existing) {
      // Clone so we don't mutate caller's input when merging later
      // duplicates of this key.
      byKey.set(key, { ...row });
      order.push(key);
      continue;
    }
    existing.confidence = Math.max(existing.confidence, row.confidence);
    if (existing.context_snippet === null && row.context_snippet !== null) {
      existing.context_snippet = row.context_snippet;
    }
    // Shallow-merge metadata: later row keys win on collision; disjoint
    // keys from both sides survive.  Do not create an empty {} when both
    // are null/undefined — leave merged.metadata as-is (undefined).
    // Narrow Json-typed metadata to a plain object before spreading
    // (Json can be primitives or arrays; only object-shaped metadata is
    // valid for our derivation output).
    if (existing.metadata || row.metadata) {
      const existingObj = toPlainObject(existing.metadata);
      const rowObj = toPlainObject(row.metadata);
      existing.metadata = { ...existingObj, ...rowObj };
    }
    // entity_name / content_item_id / entity_type / canonical_name:
    // first-wins — already set from the initial row.
  }

  return order.map((k) => byKey.get(k) as EntityMentionRow);
}

/**
 * Derive `metadata.holder` for certification entity mentions from
 * `holds` relationships in the classifier output.
 *
 * For each certification row, look up its `canonical_name` in the
 * `holdsRelsByTarget` map (built from `holds` relationships).  If a
 * match exists, compare the source entity against the client org name
 * (`BRANDING.organisationName`) to determine whether the cert is
 * self-held or supplier-held.
 *
 * Mutates `rows` in place (same pattern as the ISO override loop in
 * Step 15b).  Rows without a matching `holds` relationship are left
 * untouched — metadata remains unset.
 *
 * @param rows - filteredEntityRows (post-canonicalise, post-filter).
 * @param relationships - classifier-emitted relationships.
 * @returns the number of rows that received holder metadata.
 */
// Certification-context synonyms for `holds`. The classifier sometimes
// emits `complies_with` or `evidences` when the content phrases a
// certification differently (e.g. "our ISO 27001 compliance", "evidenced
// by our DBS check"). Both are valid enum members but our holder
// derivation only acts on `holds`. S196 fix: accept these synonyms ONLY
// when the target is a certification entity AND no canonical `holds` rel
// exists for that target (holds wins over synonyms on tie).
const HOLDS_SYNONYMS: ReadonlySet<ExtractedRelationship['relationship']> =
  new Set(['complies_with', 'evidences']);

export function deriveHolderMetadata(
  rows: EntityMentionRow[],
  relationships: ExtractedRelationship[],
): number {
  const clientOrgLower = BRANDING.organisationName.toLowerCase();
  const holdsRelsByTarget = new Map<string, string>();
  // ID-109: parallel scope map, keyed identically to holdsRelsByTarget (same
  // target-canonical space), tracking the resolved holder relation's
  // `source_scope`. Last-wins on collision, mirroring holdsRelsByTarget.
  const scopeByTarget = new Map<string, 'internal' | 'external'>();

  // Pass 1: canonical `holds` relationships. Last-wins on collision
  // (e.g. two suppliers both assert `holds iso 27001`) — this mirrors
  // the Python classifier's single-source assumption; upstream dedup at
  // classifier output is the intended safeguard, not this map.
  for (const rel of relationships) {
    if (rel.relationship === 'holds') {
      const targetLower = resolveAlias(canonicalise(rel.target)).toLowerCase();
      const sourceLower = resolveAlias(canonicalise(rel.source)).toLowerCase();
      holdsRelsByTarget.set(targetLower, sourceLower);
      if (rel.source_scope) {
        scopeByTarget.set(targetLower, rel.source_scope);
      } else {
        scopeByTarget.delete(targetLower);
      }
    }
  }

  // Pass 2: synonym fallback. Only accept when:
  //   (a) target is a certification entity (preserves semantic meaning
  //       of `complies_with`/`evidences` in non-cert contexts — e.g.
  //       "our org complies_with GDPR" where GDPR is a regulation), AND
  //   (b) source is the client organisation OR an extracted
  //       organisation entity in this batch (prevents garbage rels like
  //       "ISO 27001 complies_with Cyber Essentials Plus" from being
  //       mis-derived as cert-held-by-cert), AND
  //   (c) no canonical `holds` rel already exists for that target
  //       (holds wins over synonyms on tie).
  const certTargets = new Set<string>();
  const orgSources = new Set<string>();
  for (const row of rows) {
    if (row.entity_type === 'certification') {
      certTargets.add(row.canonical_name);
    } else if (row.entity_type === 'organisation') {
      orgSources.add(row.canonical_name);
    }
  }
  for (const rel of relationships) {
    if (HOLDS_SYNONYMS.has(rel.relationship)) {
      const targetLower = resolveAlias(canonicalise(rel.target)).toLowerCase();
      if (holdsRelsByTarget.has(targetLower)) continue;
      if (!certTargets.has(targetLower)) continue;

      const sourceLower = resolveAlias(canonicalise(rel.source)).toLowerCase();
      const sourceIsClientOrg = sourceLower === clientOrgLower;
      const sourceIsExtractedOrg = orgSources.has(sourceLower);
      // ID-109: an `internal`-scoped synonym rel admits past the org gate even
      // when its source is not an organisation — the internal function ("Internal
      // IT") is deliberately NOT an organisation mention (invariant 2 / PC-2), so
      // the scope tag is itself the holder-source authority. Without this the
      // canonical `complies_with` internal case ("Our internal IT team is
      // compliant to ISO 27001") would be rejected here and never reach the
      // internal stamp branch.
      const sourceIsInternalScope = rel.source_scope === 'internal';
      if (!sourceIsClientOrg && !sourceIsExtractedOrg && !sourceIsInternalScope)
        continue;

      holdsRelsByTarget.set(targetLower, sourceLower);
      if (rel.source_scope) {
        scopeByTarget.set(targetLower, rel.source_scope);
      } else {
        scopeByTarget.delete(targetLower);
      }
    }
  }

  let derived = 0;
  for (const row of rows) {
    if (row.entity_type === 'certification') {
      const holdsSource = holdsRelsByTarget.get(row.canonical_name);
      if (holdsSource) {
        // ID-109: internal-function self-attribution. Third stamp branch,
        // BEFORE the existing self/supplier split. Disclaimer dominance is
        // enforced at extraction (a disclaimer sets source_scope='external' or
        // names a third-party source), so an internal-tagged cert is by
        // construction disclaimer-free here.
        if (scopeByTarget.get(row.canonical_name) === 'internal') {
          row.metadata = { holder: 'self', holder_basis: 'internal_function' };
        } else if (holdsSource === clientOrgLower) {
          row.metadata = { holder: 'self' };
        } else {
          row.metadata = {
            holder: 'supplier',
            supplier_name: holdsSource,
          };
        }
        derived++;
      }
    }
  }
  return derived;
}

// ──────────────────────────────────────────
// Domain validation
// ──────────────────────────────────────────

/**
 * Slugify a domain-like string to canonical lowercase kebab-case form,
 * matching the taxonomy slug convention. Use when validation against a
 * taxonomy list is not available (e.g. at MCP write sites with no taxonomy
 * fetch). For full validation with fuzzy fallback use `validateDomain`.
 */
export function slugifyDomain(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Normalise an AI-returned domain string to a valid taxonomy slug.
 * Converts to lowercase kebab-case, strips non-alphanumeric characters,
 * then matches against the list of valid domain slugs.
 */
export function validateDomain(domain: string, validDomains: string[]): string {
  const slug = slugifyDomain(domain);
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
  /**
   * ID-109 internal-function holder attribution (Option C). Optional in-memory
   * tag emitted by extraction on a `holds`/`complies_with`/`evidences` relation:
   * `'internal'` when the certification is held by the document author's own
   * internal function (declared with explicit first-person possessive, no
   * supplier disclaimer in scope), `'external'` when held by a named third
   * party. Absent ⇒ external/unknown. Consumed by `deriveHolderMetadata`'s
   * third stamp branch and dropped before the `entity_relationships` write — it
   * is NEVER persisted (zero-migration; see id-109 TECH §Persistence).
   */
  source_scope?: 'internal' | 'external';
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

/**
 * Coerce classifier-returned subtopic strings.
 *
 * The Claude tool JSON schema declares `primary_subtopic` as a required
 * string with no `minLength`, so the classifier occasionally emits `""`
 * (or a whitespace-only string) to satisfy the required-string contract
 * when it cannot confidently choose a subtopic. The DB column is
 * nullable and accepts empty strings silently, leaving downstream
 * filters / guides / relevance scoring with an ambiguous value.
 *
 * `classifyContent` calls this on both `primary_subtopic` and
 * `secondary_subtopic` before writing to the DB row. Closes §2.1.11
 * (S158 WP2 Run 2 residual finding; audit at
 * `docs/audits/si-classification-verification-s156.md`).
 *
 * Exported so the regression test can exercise it without having to
 * mock out the full classifyContent pipeline.
 */
export function coerceSubtopic(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export interface ClassificationResult {
  primary_domain: string;
  /**
   * Subtopic slug. Nullable because the Claude tool JSON schema declares
   * it as a required string with no minLength, so the classifier can emit
   * literal `""` to satisfy the "required string" contract when it is not
   * confident. `classifyContent` coerces empty / whitespace-only values to
   * `null` via `coerceSubtopic` before they reach the DB (closes §2.1.11).
   */
  primary_subtopic: string | null;
  secondary_domain?: string | null;
  secondary_subtopic?: string | null;
  ai_keywords: string[];
  summary: string;
  suggested_title: string;
  classification_confidence: number;
  classification_reasoning: string;
  entities?: ExtractedEntity[];
  relationships?: ExtractedRelationship[];
  /** AI-extracted temporal references — optional, returned when Claude detects dates */
  temporal_references?: ClassificationTemporalReference[];
  cached?: boolean;
}

/** @public */
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

/**
 * Payment-gateway product anchor (S169 WP2).
 *
 * S168 WP2 measurement showed the six branded payment gateways below are a
 * stable (not stochastic) Pass 1 type-flip-flop — Claude oscillates between
 * `technology` and `organisation` rather than picking `product` consistently.
 * Anchoring both the extraction prompt (Pass 1) and the validation prompt
 * (Pass 2) stops the oscillation at both ends. Evidence:
 * `docs/audits/two-pass-cost-quality-measurement.md` §7 item 1.
 */
const PAYMENT_GATEWAY_PRODUCT_ANCHOR = `PAYMENT GATEWAY PRODUCT ANCHOR
These are payment-gateway products — classify/validate as entity type \`product\` (never \`technology\`, never \`organisation\`):
- Access PaySuite
- Adalante Smartpay
- Opayo
- Pay360
- WorldPay
- Stripe
Exception: when the surrounding text is clearly discussing the vendor company rather than the gateway itself (e.g. "Stripe, Inc. announced …"), the vendor mention is \`organisation\`. Default to \`product\`.`;

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

/** @public */
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
 * ISO certification family — deterministic type override (S158A Iteration 4).
 *
 * The taxonomy spec at `docs/reference/entity-type-taxonomy-spec.md:234-238`
 * states that ISO 27001 / 9001 / 14001 / 22301 / 45001 / 50001 are
 * context-dependent: `certification` when held, `standard` when discussing
 * the published document. In UK SMB bid libraries the overwhelming majority
 * of mentions are certification-context — iter1 cross-item consistency
 * showed the classifier flip-flopping between the two types per item, and
 * Pass 2 occasionally retyped held certifications to `standard`. This
 * override forces the six ISO certification families to `certification`
 * uniformly at the storage layer (after canonicalise/alias/filter, before
 * upsert), eliminating the cross-item type flip-flop.
 *
 * Entries must match the canonicalised, lowercased form of the
 * canonical_name exactly (not `iso 27001 control 6.1`, not
 * `iso 22301 business continuity management` — only the bare certification
 * name). CREST is deliberately NOT in the override list; it is genuinely
 * ambiguous (professional body vs credential) and should be handled via
 * fixture multi-type acceptance. BS / PAS / prEN / ISO 13485 / 18091 etc
 * are also excluded — these are published standards, not commonly-held
 * certifications in this domain.
 */
const _ISO_CERTIFICATION_OVERRIDE: ReadonlySet<string> = new Set([
  'iso 9001',
  'iso 14001',
  'iso 22301',
  'iso 27001',
  'iso 45001',
  'iso 50001',
]);

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
    .map(
      (e, i) =>
        `${i + 1}. "${e.name}" (type: ${e.type}, canonical: "${e.canonical_name}")`,
    )
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

NAMED BULK CERTIFICATION SETS (enumerated — atomic preservation only here)
The Pass 1 extractor reliably detects three specific UK certification bundles
that customers commonly list together. When ALL members of a named set appear
as a co-occurring list in the source text (same sentence, same bullet list,
or a single "Accredited to X, Y, Z" clause), treat that set as an atomic
unit: return "confirmed" for every member UNLESS an individual member
independently fails the NAMED ENTITY TEST or EXTERNAL REFERENCE TEST on its
face (e.g. mis-OCR, generic-concept gloss).

The three named sets are:

1. Data-centre accreditation bundle: ISO 27001 + BS 10008 + PCI-DSS
2. Security posture bundle: ISO 27001 + Cyber Essentials Plus + SOC 2
3. ESG stack: ISO 14001 + ISO 50001 + ISO 45001

Superset rule: if a co-occurring list contains every member of a named set
plus additional entities, the named set still triggers atomic preservation;
the additional entities fall back to normal per-entity judgement.

Fall-back rule: if no named set is fully matched, apply normal per-entity
validation to every entry in the list. Do NOT infer atomic preservation from
"this list looks like a cert list" or from partial set matches — only the
three named sets trigger atomic preservation, and only when every member of
the set is present.

Example — list "Accredited to ISO 9001, ISO 27001, BS 10008, PCI-DSS, Cyber
Essentials Plus and SOC 2" contains Set 1 (ISO 27001 + BS 10008 + PCI-DSS)
AND Set 2 (ISO 27001 + Cyber Essentials Plus + SOC 2). Both sets trigger;
all five members confirmed. ISO 9001 is outside both sets — normal per-entity
judgement applies.

Counter-example — list "ISO 27001, Cyber Essentials, SOC 2" (Cyber Essentials
missing the Plus) does NOT match Set 2; per-entity judgement applies to all
three.

${PAYMENT_GATEWAY_PRODUCT_ANCHOR}

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
    temperature: 0,
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

  logger.info(
    {
      op: 'classify.pass2.validate',
      confirmedCount,
      retypedCount,
      removedCount,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost,
    },
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
/**
 * Build the taxonomy reference string ("- domain: sub, sub, …" lines) the
 * classifier prompt interpolates into `{TAXONOMY}`. Pure formatting over the
 * active taxonomy rows — shared by `classifyContent` (content_items path) and
 * `classifyText` (DB-free reference path) so both prompts stay byte-identical.
 */
function buildTaxonomyString(
  domains: Array<{ id: string; name: string }>,
  subtopics: Array<{ name: string; domain_id: string }>,
): string {
  return domains
    .map((d) => {
      const subs = subtopics
        .filter((s) => s.domain_id === d.id)
        .map((s) => s.name);
      return `- ${d.name}: ${subs.join(', ')}`;
    })
    .join('\n');
}

/**
 * Build the full classification prompt (skill files + client-placeholder
 * resolution + taxonomy + disambiguation + product anchor). Pure code-motion
 * of the prompt assembly previously inlined in `classifyContent` — extracted so
 * the standalone `classifyText` classifier reuses the EXACT same prompt without
 * duplicating the skill-load / placeholder chain. `classifyContent`'s output is
 * unchanged: it calls this helper and feeds the result to its existing combined
 * `return_classification` tool call.
 */
async function buildClassificationPrompt(taxonomyStr: string): Promise<string> {
  // Load classification skill files — main skill + entity types reference
  const classificationSkill = await loadSkill('classification');
  const entityTypesRef = await loadSkill('classification-entity-types');

  // Interpolate placeholders in the skill file content. The disambiguation
  // block is sourced from CLIENT_CONFIG so new clients can add their own
  // rules without touching this file — see lib/client-config.ts
  // classification_disambiguation_rules. Placeholders inside the rules
  // (e.g. {CLIENT_PRODUCT_NAME}) are resolved by the .replaceAll chain
  // below after the {CLIENT_DISAMBIGUATION} substitution.
  // Resolve the client entity placeholders ({CLIENT_ORGANISATION_NAME} etc.)
  // across BOTH skill files. The entity-types reference also carries these
  // placeholders, so it must run through the same substitution — otherwise the
  // literal tokens would leak into the prompt.
  // The four {CLIENT_*} placeholders carry the client's own org/product names
  // (sourced from CLIENT_CONFIG.entity_examples). {PRODUCT_NAME} is distinct:
  // it is THIS platform's product name (BRANDING.productName), routed through
  // the same single-pass substitution so the skill files no longer hardcode it
  // (ID-119.5 / TECH §6). The value is config-sourced but unchanged.
  const resolveClientPlaceholders = (text: string): string =>
    text
      .replaceAll(
        '{CLIENT_ORGANISATION_NAME}',
        CLIENT_CONFIG.entity_examples.organisation_name,
      )
      .replaceAll(
        '{CLIENT_ORGANISATION_SHORT}',
        CLIENT_CONFIG.entity_examples.organisation_short,
      )
      .replaceAll(
        '{CLIENT_PRODUCT_NAME}',
        CLIENT_CONFIG.entity_examples.product_name,
      )
      .replaceAll(
        '{CLIENT_PRODUCT_SHORT}',
        CLIENT_CONFIG.entity_examples.product_short,
      )
      .replaceAll('{PRODUCT_NAME}', BRANDING.productName);

  return (
    resolveClientPlaceholders(
      classificationSkill
        .replace('{TAXONOMY}', taxonomyStr)
        .replace('{CLIENT_DISAMBIGUATION}', buildDisambiguationBlock()),
    ) +
    '\n\n---\n\n' +
    resolveClientPlaceholders(entityTypesRef) +
    '\n\n---\n\n' +
    PAYMENT_GATEWAY_PRODUCT_ANCHOR
  );
}

/** Result of the pure {@link classifyText} domain/subtopic classifier. */
export interface ClassifyTextResult {
  primary_domain: string;
  primary_subtopic: string | null;
}

/** Parameters for the pure {@link classifyText} classifier. */
export interface ClassifyTextParams {
  /** Supabase client — used ONLY to read the active taxonomy (no content_items I/O). */
  supabase: SupabaseClient<Database>;
  title: string;
  content: string;
}

/**
 * Pure, DB-write-free domain/subtopic classifier (ID-110 {110.6}).
 *
 * Runs ONLY the Claude domain/subtopic classification sub-step against raw
 * title + content: no `content_items` row, no entity/temporal extraction, no
 * writes. The single DB touch is a read of the active taxonomy (needed to build
 * the prompt and validate the returned domain against valid slugs) — the same
 * taxonomy `classifyContent` reads.
 *
 * Used by the reference-ingest route (`/api/ingest/url`) to populate
 * `reference_items.primary_domain`/`primary_subtopic` without minting a
 * `content_items` row. The content_items path (`classifyContent`) is UNCHANGED:
 * it keeps its single combined `return_classification` call. The two share the
 * prompt/taxonomy builders above (DRY), not the LLM round-trip — extracting the
 * combined call's domain/subtopic into a separate round-trip would alter
 * `classifyContent`'s cost and token-usage logging, which is out of scope.
 *
 * @throws AIServiceError when content is empty or the Claude call/parse fails;
 *   the caller (route) treats a throw as "pass NULL for domain/subtopic".
 */
export async function classifyText(
  params: ClassifyTextParams,
): Promise<ClassifyTextResult> {
  const { supabase, title, content } = params;

  if (!content?.trim()) {
    throw new AIServiceError('No content to classify', 400);
  }

  // Build taxonomy string from DB (read-only — same source as classifyContent).
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

  const taxonomyStr = buildTaxonomyString(domains, subtopics);
  const prompt = await buildClassificationPrompt(taxonomyStr);

  // Prepare content for classification (truncate at 5000 chars — same bound as
  // classifyContent's content_items path).
  const plainText = stripMarkdown(content);
  const contentForClassification = plainText.slice(0, 5000);

  // Minimal Claude call: domain + subtopic ONLY (no entity/temporal schema).
  const client = getAnthropicClient();
  const model = getAIModel();

  const response = await client.messages.create({
    model,
    max_tokens: 500,
    tools: [
      {
        name: 'return_classification',
        description: 'Return the primary domain and subtopic for this content',
        input_schema: {
          type: 'object' as const,
          properties: {
            primary_domain: { type: 'string' },
            primary_subtopic: { type: 'string' },
          },
          required: ['primary_domain', 'primary_subtopic'],
        },
      },
    ],
    tool_choice: { type: 'tool' as const, name: 'return_classification' },
    messages: [
      {
        role: 'user',
        content: `${prompt}

Title: ${title}

Content:
${contentForClassification}`,
      },
    ],
  });

  const result = extractToolResult<{
    primary_domain: string;
    primary_subtopic: string;
  }>(response, 'return_classification');

  // Coerce empty / whitespace-only subtopic to null, then validate the domain
  // against taxonomy slugs (mirrors classifyContent's post-processing).
  const primarySubtopic = coerceSubtopic(result.primary_subtopic);
  const validDomainSlugs = (domains ?? []).map((d) => d.name);
  const primaryDomain =
    validDomainSlugs.length > 0
      ? validateDomain(result.primary_domain, validDomainSlugs)
      : result.primary_domain;

  return {
    primary_domain: primaryDomain,
    primary_subtopic: primarySubtopic,
  };
}

export async function classifyContent(
  params: ClassifyParams,
): Promise<ClassificationResult> {
  const { supabase, itemId, force, userId } = params;

  // Fetch the content item
  const { data: item, error: fetchError } = await supabase
    .from('content_items')
    .select(
      'id, title, content, content_type, classified_at, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, ai_keywords, summary, suggested_title, classification_confidence, classification_reasoning, metadata',
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
      primary_subtopic: item.primary_subtopic ?? null,
      secondary_domain: item.secondary_domain,
      secondary_subtopic: item.secondary_subtopic,
      ai_keywords: item.ai_keywords ?? [],
      summary: item.summary ?? '',
      suggested_title: item.suggested_title ?? '',
      classification_confidence: item.classification_confidence ?? 0,
      classification_reasoning: item.classification_reasoning ?? '',
      cached: true,
    };
  }

  if (!item.content?.trim()) {
    throw new AIServiceError('Content item has no content to classify', 400);
  }

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

  // Taxonomy string + full classification prompt — shared with the pure
  // classifyText() reference path (DRY; prompt is byte-identical).
  const taxonomyStr = buildTaxonomyString(domains, subtopics);
  const prompt = await buildClassificationPrompt(taxonomyStr);

  // Prepare content for classification (truncate at 5000 chars)
  const plainText = stripMarkdown(item.content);
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
            summary: { type: 'string' },
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
                  source_scope: {
                    type: 'string',
                    enum: ['internal', 'external'],
                    description:
                      "Holder scope for certification `holds`/`complies_with`/`evidences` relations only. Set 'internal' ONLY when the certification is held by the document author's OWN internal function, declared with an explicit first-person possessive ('our'/'we'/'our own') and with NO supplier/third-party disclaimer in scope (e.g. \"Our internal IT team is compliant to ISO 27001\"). Set 'external' when a supplier/third-party disclaimer scopes the certification, or the internal function belongs to a named third party. OMIT the field entirely for bare/non-possessive phrasing or any ambiguous case — do not guess.",
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
            'summary',
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
  logger.info(
    {
      op: 'classify.pass1.classify',
      itemId,
      title: item.title?.slice(0, 60),
      inputTokens: pass1Usage.input_tokens,
      outputTokens: pass1Usage.output_tokens,
      cost: pass1Cost,
    },
    `[Pass 1 Classification] ${item.title?.slice(0, 60)} — ` +
      `${pass1Usage.input_tokens} in / ${pass1Usage.output_tokens} out — ` +
      `$${pass1Cost.toFixed(4)}`,
  );

  const result = extractToolResult<ClassificationResult>(
    response,
    'return_classification',
  );

  // Coerce empty / whitespace-only subtopics to null (closes §2.1.11).
  result.primary_subtopic = coerceSubtopic(result.primary_subtopic);
  result.secondary_subtopic = coerceSubtopic(result.secondary_subtopic);

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
  // Defensive: Claude occasionally returns ai_keywords as a comma-separated
  // string instead of an array. Handle string, null, undefined, and array cases.
  // Cast to unknown: the TS type says string[] but Claude occasionally returns
  // a bare string at runtime (no Zod validation on extractToolResult path).
  const aiKw: unknown = result.ai_keywords;
  const rawKeywords = Array.isArray(aiKw)
    ? (aiKw as string[])
    : typeof aiKw === 'string'
      ? aiKw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const normalisedKeywords = rawKeywords
    .map(normaliseTag)
    .filter((k) => k.length > 0);
  // Deduplicate after normalisation (different forms may collapse)
  const uniqueKeywords = [...new Set(normalisedKeywords)];

  // Update the content item with classification results
  const updateData: Database['public']['Tables']['content_items']['Update'] = {
    // content_items.primary_domain/subtopic are NOT NULL since ID-63.11;
    // coerce the sentinel at the DB write — coerceSubtopic keeps null for
    // the in-memory result.
    primary_domain: result.primary_domain ?? 'unclassified',
    primary_subtopic: result.primary_subtopic ?? 'unclassified',
    secondary_domain: result.secondary_domain ?? null,
    secondary_subtopic: result.secondary_subtopic ?? null,
    ai_keywords: uniqueKeywords,
    summary: result.summary,
    suggested_title: result.suggested_title,
    classification_confidence: result.classification_confidence,
    classification_reasoning: result.classification_reasoning,
    classified_at: new Date().toISOString(),
    updated_by: userId,
  };

  // Regenerate embedding with updated keywords.
  //
  // OpenAI `text-embedding-3-large` caps input at 8,192 tokens. Long
  // content items (tens of thousands of chars) exceed this and cause
  // a 400 BadRequestError. Truncate to `MAX_EMBEDDING_CHARS` (~7k tokens)
  // before calling and emit a separate best-effort warning when
  // truncation fires so we can track how often it happens. The first
  // ~7k tokens of a document carry the dominant semantic signal, and
  // the alternative (no embedding at all) is strictly worse for
  // downstream semantic search. Closes §2.1.12 (audit at
  // docs/audits/si-classification-verification-s156.md § Run 2).
  try {
    const rawEmbeddingText = `${result.suggested_title}\n\n${plainText}`;
    const wasTruncated = rawEmbeddingText.length > MAX_EMBEDDING_CHARS;
    const embeddingText = wasTruncated
      ? rawEmbeddingText.slice(0, MAX_EMBEDDING_CHARS)
      : rawEmbeddingText;
    if (wasTruncated) {
      logBestEffortWarn(
        'classify.embedding.input_truncated',
        'Embedding input exceeded MAX_EMBEDDING_CHARS and was truncated',
        {
          itemId,
          originalLength: rawEmbeddingText.length,
          truncatedLength: MAX_EMBEDDING_CHARS,
          titleLength: result.suggested_title?.length ?? 0,
        },
      );
    }
    const embedding = await generateEmbedding(embeddingText);
    updateData.embedding = JSON.stringify(embedding);
  } catch (embedErr) {
    logBestEffortWarn(
      'classify.embedding.generation_failed',
      'Embedding regeneration during classification failed',
      {
        itemId,
        contentLength: plainText.length,
        titleLength: result.suggested_title?.length ?? 0,
        err: embedErr,
      },
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
      logger.error(
        { err: temporalErr, op: 'classify.temporal.merge', itemId },
        'Failed to merge temporal references into metadata',
      );
    }
  }

  const { error: updateError } = await supabase
    .from('content_items')
    .update(updateData)
    .eq('id', itemId);

  if (updateError) {
    logger.error(
      { err: updateError, op: 'classify.update', itemId },
      'Failed to update classification',
    );
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

  // Step 13a: Delete any existing entity_mentions for this item before
  // re-inserting. Classification has already succeeded at this point
  // (content_items has been updated above), so re-entity storage must
  // reflect the CURRENT classifier state — not a merge of current output
  // with rows left over from prior runs. The previous upsert was gated on
  // `ignoreDuplicates: true` with `onConflict:
  // 'canonical_name,entity_type,content_item_id'`, which meant rows
  // extracted under an older filter rule set (e.g. before S143 filter
  // expansions, before S157 WP2 post-canonicalise filter) were never
  // evicted — they stayed in entity_mentions indefinitely. This caused
  // eval runs to score against stale data (confirmed in S157 WP2
  // investigation: 327 stale rows on the 67-item fixture when the fresh
  // classifier would have produced only the post-filter set).
  //
  // Re-classification is the explicit intent of any caller reaching this
  // block — they've already burnt the cost of Pass 1 + Pass 2. Wiping
  // and re-inserting is the only correct semantic. No FKs point at
  // entity_mentions (verified S157 WP2).
  //
  // Non-blocking: a delete failure should NOT break classification.
  const { error: deleteExistingError } = await supabase
    .from('entity_mentions')
    .delete()
    .eq('content_item_id', itemId);
  if (deleteExistingError) {
    logBestEffortWarn(
      'classify.entity.delete_existing_failed',
      'Failed to delete existing entity_mentions before re-insert',
      {
        itemId,
        error: deleteExistingError.message,
      },
    );
  }

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
          logger.error(
            { err: validationErr, op: 'classify.pass2.validate', itemId },
            'Entity validation (Pass 2) failed',
          );
          // Graceful degradation: fall back to deterministically-filtered entities
          finalEntities = deterministicallyFiltered;
        }
      }

      // Step 15: Store entity mentions using finalEntities
      const entityRows: EntityMentionRow[] = finalEntities.map((e) => {
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

      // Step 15a: Second filter pass on CANONICALISED entityRows before upsert.
      //
      // Closes the D-Q4 paradox (see
      // `docs/audits/s154-entity-classification-diagnostic-report.md` §D-Q4):
      // the Step 14a filter runs on Claude's raw `result.entities` BEFORE
      // `canonicalise()` + `resolveAlias()` + `.toLowerCase()`, so classifier
      // outputs with non-normalised canonical_names (e.g. "encryption
      // processes", "Data Protection Impact Assessments") slip through and
      // are only normalised at storage time — AFTER the filter has already
      // run. Direct unit tests confirm `shouldExcludeEntity` catches
      // "encryption" / "penetration testing" when given exact canonical
      // names, but the live pipeline stored them anyway because the
      // pre-canonicalise form didn't match.
      //
      // The fix is belt-and-braces: keep Step 14a (so Pass 2 doesn't waste
      // tokens on pre-filtered items) AND re-filter here on the
      // canonicalised form. Any entity the filter catches here is logged
      // via logBestEffortWarn for Sentry observability so we can track the
      // canonical-drift population over time.
      const filteredEntityRows = entityRows.filter((row) => {
        const excluded = shouldExcludeEntity({
          name: row.entity_name,
          type: row.entity_type as ExtractedEntity['type'],
          canonical_name: row.canonical_name,
        });
        if (excluded) {
          logBestEffortWarn(
            'classify.entity.post_canonical_filter_drop',
            `Post-canonicalise filter dropped entity missed by pre-canonicalise filter`,
            {
              itemId,
              entityName: row.entity_name,
              entityType: row.entity_type,
              canonicalName: row.canonical_name,
            },
          );
        }
        return !excluded;
      });

      // Step 15b: ISO certification family type override (S158A Iteration 4).
      //
      // Forces the six ISO certification families to `certification` uniformly
      // per the taxonomy spec §3.1 "if ambiguous, prefer certification" rule.
      // Runs after the canonicalise + alias + filter pipeline so it sees the
      // fully-normalised canonical_name. The mutation is in-place on the
      // filteredEntityRows array because by this point the row is ready to
      // upsert and no further transformations apply. See
      // `_ISO_CERTIFICATION_OVERRIDE` (module top) for the list and rationale.
      for (const row of filteredEntityRows) {
        if (
          _ISO_CERTIFICATION_OVERRIDE.has(row.canonical_name) &&
          row.entity_type !== 'certification'
        ) {
          logBestEffortWarn(
            'classify.entity.iso_type_override',
            `ISO family override: forcing ${row.canonical_name} from ${row.entity_type} to certification`,
            {
              itemId,
              canonicalName: row.canonical_name,
              originalType: row.entity_type,
            },
          );
          row.entity_type = 'certification';
        }
      }

      // Step 15b2: Derive metadata.holder for certification entity mentions
      // from holds relationships.  Mirrors the Python holder-disambiguation
      // mechanism where holder is inferred from source_entity vs client org.
      // See cert-classifier-holder-rule-spec.md §11.2–11.3.
      if (result.relationships?.length) {
        const holderCount = deriveHolderMetadata(
          filteredEntityRows,
          result.relationships,
        );
        if (holderCount > 0) {
          logBestEffortWarn(
            'classify.entity.holder_derivation',
            `Derived holder metadata for ${holderCount} certification mention(s)`,
            {
              itemId,
              holderCount,
              certRows: filteredEntityRows
                .filter((r) => r.metadata)
                .map((r) => ({
                  canonicalName: r.canonical_name,
                  holder: (r.metadata as Record<string, unknown>).holder,
                  supplierName: (r.metadata as Record<string, unknown>)
                    .supplier_name,
                })),
            },
          );
        }
      }

      if (filteredEntityRows.length > 0) {
        // Step 15c: Dedupe duplicate (item, canonical, type) triples before
        // upsert. The canonicalise + resolveAlias + toLowerCase chain above
        // can collapse two distinct Pass 1 outputs (e.g. "ISO 27001" and
        // "ISO27001", or "DPO" and "Data Protection Officer") onto the same
        // triple. Postgres rejects such upserts with error 21000 ("ON
        // CONFLICT DO UPDATE command cannot affect row a second time")
        // because a single statement cannot update the same conflict target
        // twice. See `dedupeEntityMentionRows` for merge semantics.
        const dedupedEntityRows = dedupeEntityMentionRows(filteredEntityRows);
        if (dedupedEntityRows.length < filteredEntityRows.length) {
          const seen = new Map<string, number>();
          for (const row of filteredEntityRows) {
            const key = `${row.content_item_id}::${row.canonical_name}::${row.entity_type}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
          const collapsedTriples = Array.from(seen.entries())
            .filter(([, count]) => count > 1)
            .map(([key]) => key)
            .slice(0, 20);
          logBestEffortWarn(
            'classify.entity.dedup_collapsed_duplicates',
            'Collapsed duplicate (item, canonical, type) triples before entity_mentions upsert',
            {
              itemId,
              preCount: filteredEntityRows.length,
              postCount: dedupedEntityRows.length,
              collapsedTriples,
            },
          );
        }

        // INSERT (not upsert) is safe here because Step 13a already
        // deleted any existing rows for this content_item_id.
        // onConflict/ignoreDuplicates were load-bearing previously when
        // stale rows could exist — with the delete-before-insert pattern
        // they are no longer needed. Keeping onConflict as a last-line
        // safety net in case two concurrent classify calls race on the
        // same item; the classifier_item_id branch isolates them per row.
        const { error: entityError } = await supabase
          .from('entity_mentions')
          .upsert(dedupedEntityRows, {
            onConflict: 'canonical_name,entity_type,content_item_id',
            ignoreDuplicates: false,
          });

        if (entityError) {
          logger.error(
            { err: entityError, op: 'classify.entity.upsert', itemId },
            'Failed to store entity mentions',
          );
        }
      }
    } catch (entityErr) {
      logger.error(
        { err: entityErr, op: 'classify.entity.storage', itemId },
        'Entity mention storage failed',
      );
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

      // Upsert with NULLS NOT DISTINCT unique index
      // (entity_relationships_unique_tuple, S183 WP1 G1).
      // ignoreDuplicates keeps repeated classifier runs idempotent —
      // duplicate tuples silently no-op instead of failing the batch.
      const { error: relError } = await supabase
        .from('entity_relationships')
        .upsert(relRows, {
          onConflict:
            'source_entity,relationship_type,target_entity,source_item_id',
          ignoreDuplicates: true,
        });

      if (relError) {
        logger.error(
          { err: relError, op: 'classify.relationship.upsert', itemId },
          'Failed to store entity relationships',
        );
      }
    } catch (relErr) {
      logger.error(
        { err: relErr, op: 'classify.relationship.storage', itemId },
        'Entity relationship storage failed',
      );
    }
  }

  // Bridge temporal references to entity mention metadata (non-blocking)
  try {
    await bridgeTemporalReferencesToEntities(supabase, itemId);
  } catch (bridgeErr) {
    logger.error(
      { err: bridgeErr, op: 'classify.temporal.bridge', itemId },
      'Temporal reference bridging failed',
    );
  }

  return {
    primary_domain: result.primary_domain,
    primary_subtopic: result.primary_subtopic,
    secondary_domain: result.secondary_domain ?? null,
    secondary_subtopic: result.secondary_subtopic ?? null,
    ai_keywords: uniqueKeywords,
    summary: result.summary,
    suggested_title: result.suggested_title,
    classification_confidence: result.classification_confidence,
    classification_reasoning: result.classification_reasoning,
    entities: result.entities,
    relationships: result.relationships,
    temporal_references: result.temporal_references,
  };
}
