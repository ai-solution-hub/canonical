/**
 * Batch Reclassification + Entity Extraction
 *
 * Reclassifies content items against the current taxonomy. Supports filtering
 * by current domain and forced reclassification of all items. Simultaneously
 * extracts named entities and relationships for the context graph
 * (entity_mentions + entity_relationships tables).
 *
 * Also generates a data quality report identifying duplicates, fragments, and
 * items with editorial notes in content.
 *
 * SAFE BY DEFAULT: runs in dry-run mode unless --execute is passed.
 *
 * Usage:
 *   bun run scripts/batch-reclassify.ts --limit 10                  # dry-run preview of 10 items
 *   bun run scripts/batch-reclassify.ts --execute                   # reclassify all active items
 *   bun run scripts/batch-reclassify.ts --execute --limit 50        # reclassify 50 items
 *   bun run scripts/batch-reclassify.ts --execute --domain security # only items currently in 'security'
 *   bun run scripts/batch-reclassify.ts --execute --force           # force reclassify even if already classified
 *   bun run scripts/batch-reclassify.ts --entities-only --limit 10  # extract entities only (no reclassification)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type { Database } from '@/supabase/types/database.types';
import { generateEmbedding } from '@/lib/ai/embed';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { resolveAlias, loadAliases } from '@/lib/entities/entity-aliases';
import { isExcludedEntity, validateDomain } from '@/lib/ai/classify';
import { extractEntityContext } from '@/lib/entities/entity-context';
import { bridgeTemporalReferencesToEntities } from '@/lib/entities/entity-metadata-bridge';
import { normaliseTag } from '@/lib/validation/schemas';
import { inferLayer } from '@/lib/layer-inference';
import { CLIENT_CONFIG } from '@/lib/client-config';

// ── Env loading ──

function loadEnvFile(path: string): void {
  try {
    const content = Bun.file(path).textSync();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // Don't override existing env vars (so .env.local takes priority if loaded second)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — that's fine
  }
}

// Load .env.local first (higher priority), then .env
const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ── CLI args ──

interface CliArgs {
  limit: number;
  execute: boolean;
  batchSize: number;
  force: boolean;
  entitiesOnly: boolean;
  domain: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let limit = 0; // 0 = no limit (process all)
  let execute = false;
  let batchSize = 1; // 1 item at a time (1/sec rate limit for Claude API)
  let force = false;
  let entitiesOnly = false;
  let domain: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--execute') {
      execute = true;
    } else if (args[i] === '--dry-run') {
      // Legacy flag — dry-run is now the default, but accept for backwards compat
      execute = false;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--entities-only') {
      entitiesOnly = true;
    } else if (args[i] === '--domain' && args[i + 1]) {
      domain = args[i + 1];
      i++;
    }
  }

  if (isNaN(limit) || limit < 0) limit = 0;
  if (isNaN(batchSize) || batchSize < 1) batchSize = 1;
  // Cap concurrent requests at 3 to respect rate limits
  if (batchSize > 3) batchSize = 3;

  return { limit, execute, batchSize, force, entitiesOnly, domain };
}

// ── Constants ──

// Content type priority ordering for reclassification (q_a_pair first — bulk of garbled items)
const CONTENT_TYPE_PRIORITY = [
  'q_a_pair',
  'case_study',
  'policy',
  'certification',
  'capability',
  'product_description',
  'methodology',
  'compliance',
  'article',
  'blog',
  'pdf',
  'research',
  'note',
  'other',
];

// Sonnet pricing (per token)
const SONNET_INPUT_PRICE = 3.0 / 1_000_000;
const SONNET_OUTPUT_PRICE = 15.0 / 1_000_000;

// Garbled keyword pattern: same word repeated 3+ times with hyphens
// e.g. "data-encryption-data-encryption-data-encryption"
const GARBLED_KEYWORD_REGEX = /(\b\w+(?:-\w+)*)\1{2,}|(\b\w+\b)(?:-\2){2,}/;

// Editorial note patterns in content
const EDITORIAL_NOTE_PATTERNS = [
  /^N\.?B\.?\s/i,
  /^MAKE\s+SURE/i,
  /^TODO\s*:/i,
  /^NOTE\s*:/i,
  /^IMPORTANT\s*:/i,
  /^FIXME\s*:/i,
  /^\[.*EDITORIAL.*\]/i,
  /^ACTION\s*:/i,
  /^REMINDER\s*:/i,
];

// System prompt for classification + entity extraction
const SYSTEM_PROMPT = `You are an expert knowledge base classifier for a UK SMB bid management platform.
Your task is to classify content items — primarily Q&A pairs extracted from bid
library documents, plus policies, case studies, certifications, capability
statements, and general articles — into a structured 2-level taxonomy. The
knowledge base serves bid managers who need to find authoritative, current
information quickly when responding to tenders. Be decisive and confident in
your classifications.

In addition to classification, extract named entities and relationships from the
content. Entities include organisations, certifications, regulations, frameworks,
capabilities, people, technologies, projects, sectors, products, standards, and
methodologies. Relationships describe how entities relate to each other.

Also extract temporal references (dates, deadlines, expiry dates, renewal dates)
from the content when present.

Do not extract SIC codes, VAT registration numbers, DUNS numbers, or other
numeric identifiers as entities.`;

// ── Types ──

interface ContentRow {
  id: string;
  content: string | null;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  ai_keywords: string[] | null;
  classification_confidence: number | null;
  classified_at: string | null;
  metadata: Record<string, unknown> | null;
  platform: string | null;
}

interface ClassificationTemporalRef {
  date: string;
  context: string;
  context_type: 'expiry' | 'effective' | 'historical' | 'unknown';
}

interface ClassificationWithEntities {
  primary_domain: string;
  primary_subtopic: string;
  secondary_domain?: string | null;
  secondary_subtopic?: string | null;
  ai_keywords: string[];
  summary: string;
  suggested_title: string;
  classification_confidence: number;
  classification_reasoning: string;
  entities: EntityExtraction[];
  relationships: RelationshipExtraction[];
  temporal_references?: ClassificationTemporalRef[];
}

interface EntityExtraction {
  name: string;
  type: string;
  canonical_name: string;
}

interface RelationshipExtraction {
  source: string;
  relationship: string;
  target: string;
}

interface QualityFlag {
  itemId: string;
  title: string;
  issue: string;
  detail: string;
}

// ── Entity canonicalisation (shared module) ──

import { canonicalise } from '@/lib/entities/entity-dedup';

// ── Helpers ──

function contentTypeSortKey(contentType: string | null): number {
  const idx = CONTENT_TYPE_PRIORITY.indexOf(contentType ?? 'other');
  return idx === -1 ? CONTENT_TYPE_PRIORITY.length : idx;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Check if an item has garbled keywords (pre-v4.0 classification artefact) */
function hasGarbledKeywords(keywords: string[] | null): boolean {
  if (!keywords || keywords.length === 0) return false;
  return keywords.some((kw) => GARBLED_KEYWORD_REGEX.test(kw));
}

/** Check if content starts with editorial notes */
function hasEditorialNotes(content: string): boolean {
  const trimmed = content.trim();
  return EDITORIAL_NOTE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ── Taxonomy loader ──

async function loadTaxonomy(
  supabase: SupabaseClient<Database>,
): Promise<{ taxonomyStr: string; validDomainSlugs: string[] }> {
  const { data: domains, error: dErr } = await supabase
    .from('taxonomy_domains')
    .select('id, name')
    .eq('is_active', true)
    .order('display_order');

  if (dErr) {
    console.error(`Failed to fetch taxonomy domains: ${dErr.message}`);
    console.error(
      'Ensure SUPABASE_SERVICE_ROLE_KEY is set (service role key bypasses RLS).',
    );
    process.exit(1);
  }

  const { data: subtopics, error: sErr } = await supabase
    .from('taxonomy_subtopics')
    .select('name, domain_id, description')
    .eq('is_active', true)
    .order('display_order');

  if (sErr) {
    console.error(`Failed to fetch taxonomy subtopics: ${sErr.message}`);
    process.exit(1);
  }

  if (!domains?.length) {
    console.error(
      'Taxonomy query returned empty. Check SUPABASE_SERVICE_ROLE_KEY is set.',
    );
    process.exit(1);
  }

  const validDomainSlugs = domains.map((d) => d.name);

  const taxonomyStr = domains
    .map((d) => {
      const subs = (subtopics ?? [])
        .filter((s) => s.domain_id === d.id)
        .map((s) => (s.description ? `${s.name} (${s.description})` : s.name));
      return `- ${d.name}: ${subs.join(', ')}`;
    })
    .join('\n');

  return { taxonomyStr, validDomainSlugs };
}

// ── Tool schema for Claude ──

const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: 'return_classification_with_entities',
  description:
    'Return the classification result with extracted entities and relationships',
  input_schema: {
    type: 'object' as const,
    properties: {
      primary_domain: {
        type: 'string',
        description: 'Primary taxonomy domain',
      },
      primary_subtopic: {
        type: 'string',
        description: 'Primary subtopic within the domain',
      },
      secondary_domain: {
        type: ['string', 'null'] as unknown as string,
        description: 'Secondary domain if applicable, else null',
      },
      secondary_subtopic: {
        type: ['string', 'null'] as unknown as string,
        description: 'Secondary subtopic if applicable, else null',
      },
      ai_keywords: {
        type: 'array',
        items: { type: 'string' },
        description: '3-8 specific keywords/phrases',
      },
      summary: {
        type: 'string',
        description: '1-2 sentence summary (20-50 words)',
      },
      suggested_title: {
        type: 'string',
        description: 'Descriptive title (40-100 chars)',
      },
      classification_confidence: {
        type: 'number',
        description: 'Confidence score 0.0-1.0',
      },
      classification_reasoning: {
        type: 'string',
        description: 'Brief explanation of the classification',
      },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Entity name as found in text',
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
                'product',
                'standard',
                'methodology',
              ],
            },
            canonical_name: {
              type: 'string',
              description: 'Normalised name for dedup',
            },
          },
          required: ['name', 'type', 'canonical_name'],
        },
        description: 'Named entities extracted from the content',
      },
      relationships: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Source entity canonical name',
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
              description: 'Target entity canonical name',
            },
          },
          required: ['source', 'relationship', 'target'],
        },
        description: 'Relationships between extracted entities',
      },
      temporal_references: {
        type: 'array',
        description:
          'Dates and temporal references found in the content (expiry dates, renewal dates, effective dates, etc.)',
        items: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'ISO 8601 date string (YYYY-MM-DD)',
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
      'entities',
      'relationships',
    ],
  },
};

// ── Main ──

async function main(): Promise<void> {
  const { limit, execute, batchSize, force, entitiesOnly, domain } =
    parseArgs();
  const dryRun = !execute;

  // Validate env
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_PUBLISHABLE_KEY) in environment',
    );
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error('Missing ANTHROPIC_API_KEY in environment');
    process.exit(1);
  }

  const usingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const model = process.env.AI_SUMMARY_MODEL || 'claude-sonnet-4-6';
  const supabase = createClient<Database>(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // If not using service role key, authenticate with email/password for RLS access
  if (!usingServiceRole) {
    const authEmail = process.env.SUPABASE_AUTH_EMAIL;
    const authPassword = process.env.SUPABASE_AUTH_PASSWORD;
    if (authEmail && authPassword) {
      console.log(`Authenticating as ${authEmail}...`);
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (authError) {
        console.error(`Authentication failed: ${authError.message}`);
        process.exit(1);
      }
      console.log('Authenticated successfully.');
    } else {
      console.warn(
        'WARNING: No SUPABASE_SERVICE_ROLE_KEY and no SUPABASE_AUTH_EMAIL/SUPABASE_AUTH_PASSWORD.',
      );
      console.warn(
        'The script may not be able to read/write data due to RLS policies.',
      );
      console.warn(
        'Set SUPABASE_SERVICE_ROLE_KEY in .env or SUPABASE_AUTH_EMAIL/SUPABASE_AUTH_PASSWORD in .env.local.',
      );
    }
  }

  // ── Load taxonomy ──

  console.log('\nLoading taxonomy from database...');
  const { taxonomyStr, validDomainSlugs } = await loadTaxonomy(supabase);
  if (!taxonomyStr) {
    console.error('Failed to load taxonomy — no domains found');
    process.exit(1);
  }
  console.log('Taxonomy loaded.\n');

  // Load entity aliases once before processing loop
  await loadAliases(supabase);

  // ── Fetch items needing reclassification ──

  const modeLabel = entitiesOnly
    ? 'entity extraction only'
    : force
      ? 'forced reclassification (all items)'
      : 'reclassification (garbled/low-confidence/unclassified)';
  const limitLabel = limit > 0 ? `limit ${limit}` : 'no limit';
  const domainLabel = domain ? `, domain=${domain}` : '';
  console.log(
    `Fetching content items for ${modeLabel} (${limitLabel}${domainLabel})...\n`,
  );

  let candidates: ContentRow[];

  if (entitiesOnly) {
    // Entities-only mode: fetch items that ARE classified but don't have entity mentions yet
    let entitiesQuery = supabase
      .from('content_items')
      .select(
        'id, content, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_keywords, classification_confidence, classified_at, metadata, platform',
      )
      .not('classified_at', 'is', null)
      .not('content', 'is', null)
      .is('archived_at', null)
      .order('captured_date', { ascending: false })
      .limit(500);

    if (domain) {
      entitiesQuery = entitiesQuery.eq('primary_domain', domain);
    }

    const { data: items, error: fetchError } = await entitiesQuery;

    if (fetchError) {
      console.error('Failed to fetch items:', fetchError.message);
      process.exit(1);
    }

    if (!items || items.length === 0) {
      console.log('No classified items found. Nothing to do.');
      return;
    }

    // Paginate to fetch ALL entity_mentions content_item_ids
    // (Supabase JS defaults to 1000 rows; entity_mentions can far exceed this)
    const mentionedSet = new Set<string>();
    let mentionOffset = 0;
    const mentionPageSize = 5000;
    while (true) {
      const { data: mentionPage, error: mentionError } = await supabase
        .from('entity_mentions')
        .select('content_item_id')
        .range(mentionOffset, mentionOffset + mentionPageSize - 1);

      if (mentionError) {
        console.error('Failed to fetch entity_mentions:', mentionError.message);
        process.exit(1);
      }

      if (!mentionPage || mentionPage.length === 0) break;

      for (const r of mentionPage) {
        mentionedSet.add(r.content_item_id);
      }

      if (mentionPage.length < mentionPageSize) break;
      mentionOffset += mentionPageSize;
    }

    const entitiesFiltered = (items as ContentRow[])
      .filter(
        (item) =>
          item.content &&
          item.content.trim().length > 0 &&
          !mentionedSet.has(item.id),
      )
      .sort(
        (a, b) =>
          contentTypeSortKey(a.content_type) -
          contentTypeSortKey(b.content_type),
      );

    candidates =
      limit > 0 ? entitiesFiltered.slice(0, limit) : entitiesFiltered;
  } else {
    // Normal reclassification mode: fetch active (non-archived) items
    let reclassQuery = supabase
      .from('content_items')
      .select(
        'id, content, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_keywords, classification_confidence, classified_at, metadata, platform',
      )
      .not('content', 'is', null)
      .is('archived_at', null)
      .order('captured_date', { ascending: false })
      .limit(5000);

    if (domain) {
      reclassQuery = reclassQuery.eq('primary_domain', domain);
    }

    const { data: items, error: fetchError } = await reclassQuery;

    if (fetchError) {
      console.error('Failed to fetch items:', fetchError.message);
      process.exit(1);
    }

    if (!items || items.length === 0) {
      console.log('No content items found. Nothing to do.');
      return;
    }

    // Filter to items needing reclassification
    const filtered = (items as ContentRow[])
      .filter((item) => {
        if (!item.content || item.content.trim().length === 0) return false;

        if (force) return true;

        // Unclassified
        if (!item.classified_at) return true;
        // Low confidence
        if (
          item.classification_confidence !== null &&
          item.classification_confidence < 0.7
        )
          return true;
        // Garbled keywords
        if (hasGarbledKeywords(item.ai_keywords)) return true;

        return false;
      })
      .sort(
        (a, b) =>
          contentTypeSortKey(a.content_type) -
          contentTypeSortKey(b.content_type),
      );

    candidates = limit > 0 ? filtered.slice(0, limit) : filtered;
  }

  if (candidates.length === 0) {
    console.log('No items found needing processing. Nothing to do.');
    return;
  }

  // ── Data quality report ──

  // Fetch all items for quality analysis (regardless of reclassification status)
  const { data: allItems } = await supabase
    .from('content_items')
    .select('id, title, suggested_title, content, content_type')
    .not('content', 'is', null)
    .limit(1000);

  const qualityFlags: QualityFlag[] = [];

  if (allItems && allItems.length > 0) {
    // Check for duplicate titles/questions
    const titleMap = new Map<string, { id: string; title: string }[]>();
    for (const item of allItems) {
      const displayTitle = (item.suggested_title || item.title || '')
        .toLowerCase()
        .trim();
      if (!displayTitle) continue;
      const existing = titleMap.get(displayTitle) || [];
      existing.push({ id: item.id, title: displayTitle });
      titleMap.set(displayTitle, existing);
    }
    for (const [title, entries] of titleMap) {
      if (entries.length > 1) {
        for (const entry of entries) {
          qualityFlags.push({
            itemId: entry.id,
            title: title.slice(0, 60),
            issue: 'DUPLICATE_TITLE',
            detail: `${entries.length} items share this title`,
          });
        }
      }
    }

    // Check for fragments (content < 20 chars)
    for (const item of allItems) {
      const plainText = stripMarkdown(item.content || '');
      if (plainText.length < 20 && plainText.length > 0) {
        qualityFlags.push({
          itemId: item.id,
          title: truncate(item.suggested_title || item.title || 'Untitled', 60),
          issue: 'FRAGMENT',
          detail: `Content is ${plainText.length} chars — needs expansion`,
        });
      }
    }

    // Check for editorial notes in content
    for (const item of allItems) {
      const plainText = stripMarkdown(item.content || '');
      if (hasEditorialNotes(plainText)) {
        qualityFlags.push({
          itemId: item.id,
          title: truncate(item.suggested_title || item.title || 'Untitled', 60),
          issue: 'EDITORIAL_NOTE',
          detail: `Content starts with editorial guidance text`,
        });
      }
    }
  }

  // ── Cost estimate ──

  const totalChars = candidates.reduce((sum, item) => {
    const len = Math.min(item.content?.length ?? 0, 100_000);
    return sum + len;
  }, 0);
  // Rough token estimate: ~4 chars per token for English text
  // Add ~300 tokens per item for system prompt + taxonomy (amortised with caching)
  const estimatedInputTokens =
    Math.ceil(totalChars / 4) + candidates.length * 300;
  // Assume ~800 output tokens per item (classification + entities + relationships)
  const estimatedOutputTokens = candidates.length * 800;
  const estimatedCost =
    estimatedInputTokens * SONNET_INPUT_PRICE +
    estimatedOutputTokens * SONNET_OUTPUT_PRICE;

  // ── Content type breakdown ──

  const typeCounts: Record<string, number> = {};
  for (const item of candidates) {
    const t = item.content_type || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // Count items by reason
  let garbledCount = 0;
  let lowConfidenceCount = 0;
  let unclassifiedCount = 0;
  let forcedCount = 0;

  for (const item of candidates) {
    if (force && item.classified_at) {
      forcedCount++;
    } else if (!item.classified_at) {
      unclassifiedCount++;
    } else if (
      item.classification_confidence !== null &&
      item.classification_confidence < 0.7
    ) {
      lowConfidenceCount++;
    } else if (hasGarbledKeywords(item.ai_keywords)) {
      garbledCount++;
    }
  }

  console.log('='.repeat(60));
  console.log(
    `  Mode:                 ${dryRun ? 'DRY RUN' : 'EXECUTE'} — ${modeLabel}`,
  );
  console.log(`  Items to process:     ${candidates.length}`);
  if (domain) {
    console.log(`  Domain filter:        ${domain}`);
  }
  console.log(`  Model:                ${model}`);
  console.log(`  Batch size:           ${batchSize} concurrent`);
  console.log(
    `  Service role:         ${usingServiceRole ? 'yes' : 'no (using anon key)'}`,
  );
  console.log(
    `  Est. input tokens:    ${estimatedInputTokens.toLocaleString()}`,
  );
  console.log(
    `  Est. output tokens:   ${estimatedOutputTokens.toLocaleString()}`,
  );
  console.log(`  Est. cost:            ${formatCost(estimatedCost)}`);
  console.log('');
  if (!entitiesOnly) {
    console.log('  Reclassification reasons:');
    if (garbledCount > 0)
      console.log(`    Garbled keywords:     ${garbledCount}`);
    if (lowConfidenceCount > 0)
      console.log(`    Low confidence:       ${lowConfidenceCount}`);
    if (unclassifiedCount > 0)
      console.log(`    Unclassified:         ${unclassifiedCount}`);
    if (forcedCount > 0)
      console.log(`    Forced:               ${forcedCount}`);
    console.log('');
  }
  console.log('  Content type breakdown:');
  for (const [type, count] of Object.entries(typeCounts).sort(
    (a, b) => contentTypeSortKey(a[0]) - contentTypeSortKey(b[0]),
  )) {
    console.log(`    ${type.padEnd(22)} ${count}`);
  }
  console.log('='.repeat(60));

  // ── Quality report ──

  if (qualityFlags.length > 0) {
    const issueGroups: Record<string, QualityFlag[]> = {};
    for (const flag of qualityFlags) {
      const group = issueGroups[flag.issue] || [];
      group.push(flag);
      issueGroups[flag.issue] = group;
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('  DATA QUALITY REPORT');
    console.log('='.repeat(60));
    for (const [issue, flags] of Object.entries(issueGroups)) {
      console.log(`\n  ${issue} (${flags.length} items):`);
      // Show up to 10 examples per issue type
      const shown = flags.slice(0, 10);
      for (const flag of shown) {
        console.log(
          `    ${flag.itemId.slice(0, 8)}... "${truncate(flag.title, 50)}" — ${flag.detail}`,
        );
      }
      if (flags.length > 10) {
        console.log(`    ... and ${flags.length - 10} more`);
      }
    }
    console.log('\n' + '='.repeat(60));
  }

  // Domain distribution of items to be processed
  const domainCounts: Record<string, number> = {};
  for (const item of candidates) {
    const d = item.primary_domain || '(unclassified)';
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }
  console.log('');
  console.log('  Current domain distribution:');
  for (const [d, count] of Object.entries(domainCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${d.padEnd(30)} ${count}`);
  }
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n-- DRY RUN -- Items that would be reclassified:\n');
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const displayTitle = item.suggested_title || item.title || 'Untitled';
      const contentLen = item.content?.length ?? 0;
      const garbled = hasGarbledKeywords(item.ai_keywords) ? ' [GARBLED]' : '';
      const currentDomain = item.primary_domain || '(none)';
      const conf =
        item.classification_confidence !== null
          ? ` (conf: ${item.classification_confidence.toFixed(2)})`
          : ' (unclassified)';
      console.log(
        `  ${String(i + 1).padStart(3)}. [${currentDomain.padEnd(28)}] ${truncate(displayTitle, 45)} (${contentLen.toLocaleString()} chars)${conf}${garbled}`,
      );
    }
    console.log('\nPass --execute to run reclassification.');
    return;
  }

  // ── Process in batches ──

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let successCount = 0;
  let errorCount = 0;
  let totalEntities = 0;
  let totalRelationships = 0;
  let embeddingErrors = 0;
  let domainChanges = 0;
  const domainMigrations: Record<string, number> = {}; // "old -> new" => count
  const startTime = Date.now();

  for (
    let batchStart = 0;
    batchStart < candidates.length;
    batchStart += batchSize
  ) {
    const batch = candidates.slice(batchStart, batchStart + batchSize);

    if (batchStart > 0) {
      // 1-second delay between batches to respect Claude API rate limits
      await sleep(1000);
    }

    const results = await Promise.allSettled(
      batch.map(async (item, batchIndex) => {
        const index = batchStart + batchIndex + 1;
        const displayTitle = item.suggested_title || item.title || 'Untitled';

        try {
          // Prepare content for classification (truncate at 5000 chars)
          const plainText = stripMarkdown(item.content!);
          const contentForClassification = plainText.slice(0, 5000);

          // Build user message
          const userMessage = `Available domains and subtopics:
${taxonomyStr}

IMPORTANT disambiguation rules:
- "${CLIENT_CONFIG.entity_examples.product_name}" is a SOFTWARE PRODUCT, not an auditing process. Questions about its features (action plans, invites, reports, exports, user interface) belong in product-feature/*, NOT compliance/audit.
- Business continuity and disaster recovery (BC/DR) belong in security/cyber-security, not support/* or product-feature/*.
- Security awareness training, confidentiality clauses, and security governance belong in security/data-protection or corporate/staffing, NOT support/sla.
- Data security controls (encryption, access control, secure data transfer, infrastructure security) belong in security/*, NOT product-feature/*.
- Financial questions (pricing, costs, audited accounts, hidden costs) belong in corporate/financial.

Content type: ${item.content_type}
Title: ${item.title || item.suggested_title || 'Untitled'}

Content:
${contentForClassification}

Classify this content and extract entities and relationships. Also extract any temporal references (dates, deadlines, expiry dates, renewal dates) — classify each as expiry, effective, historical, or unknown. Return the classification with entities.
When extracting entities, prefer the full formal name of organisations (e.g. "${CLIENT_CONFIG.entity_examples.organisation_name}" not "${CLIENT_CONFIG.entity_examples.organisation_short}"), the standard short form of certifications (e.g. "ISO 27001" not "ISO/IEC 27001:2022"), and established product names (e.g. "${CLIENT_CONFIG.entity_examples.product_name}" not "${CLIENT_CONFIG.entity_examples.product_short}").
Do not extract SIC codes, VAT registration numbers, DUNS numbers, or other numeric identifiers as entities.`;

          // Call Claude API with tool_choice to force structured output
          const response = await anthropic.messages.create({
            model,
            max_tokens: 2000,
            system: SYSTEM_PROMPT,
            tools: [CLASSIFICATION_TOOL],
            tool_choice: {
              type: 'tool' as const,
              name: 'return_classification_with_entities',
            },
            messages: [{ role: 'user', content: userMessage }],
          });

          // Extract tool result
          const toolBlock = response.content.find(
            (block): block is Anthropic.Messages.ToolUseBlock =>
              block.type === 'tool_use' &&
              block.name === 'return_classification_with_entities',
          );

          if (!toolBlock) {
            throw new Error(
              'Claude did not return a return_classification_with_entities tool call',
            );
          }

          const result = toolBlock.input as ClassificationWithEntities;

          // Track token usage
          const inputTokens = response.usage.input_tokens;
          const outputTokens = response.usage.output_tokens;
          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;

          // ── Validate domains against taxonomy slugs (3.10) ──
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

          // ── Normalise keywords (3.9) ──
          const normalisedKeywords = (
            Array.isArray(result.ai_keywords) ? result.ai_keywords : []
          )
            .map(normaliseTag)
            .filter((k) => k.length > 0);
          const uniqueKeywords = [...new Set(normalisedKeywords)];

          // ── Apply canonicalisation + alias resolution to entity names (3.6) ──
          const entities = (
            Array.isArray(result.entities) ? result.entities : []
          )
            .filter(
              (e) =>
                !isExcludedEntity(e.name) &&
                !isExcludedEntity(e.canonical_name),
            )
            .map((e) => ({
              ...e,
              canonical_name: resolveAlias(
                canonicalise(e.canonical_name, e.type),
              ).toLowerCase(),
            }));

          const relationships = (
            Array.isArray(result.relationships) ? result.relationships : []
          ).map((r) => ({
            ...r,
            source: resolveAlias(canonicalise(r.source)).toLowerCase(),
            target: resolveAlias(canonicalise(r.target)).toLowerCase(),
          }));

          // ── Update content_items with classification results ──
          if (!entitiesOnly) {
            // Infer layer from content metadata (3.5)
            const platformToSource = (
              p: string | null,
            ): 'bid_library' | 'url_import' | 'upload' | 'manual' => {
              if (p === 'extraction') return 'bid_library';
              if (p === 'web') return 'url_import';
              if (p === 'upload') return 'upload';
              return 'manual';
            };

            const layerSuggestion = inferLayer({
              contentType: item.content_type ?? 'other',
              contentLength: plainText.length,
              ingestionSource: platformToSource(item.platform),
              hasBrief: false,
              hasDetail: false,
              hasReference: false,
              isBidDiscovered: false,
              title: item.title || item.suggested_title || '',
            });

            const updateData: Record<string, unknown> = {
              primary_domain: result.primary_domain,
              primary_subtopic: result.primary_subtopic,
              secondary_domain: result.secondary_domain ?? null,
              secondary_subtopic: result.secondary_subtopic ?? null,
              ai_keywords: uniqueKeywords,
              summary: result.summary,
              suggested_title: result.suggested_title,
              classification_confidence: result.classification_confidence,
              classification_reasoning: result.classification_reasoning,
              classified_at: new Date().toISOString(),
              layer: layerSuggestion.suggestedLayer,
            };

            // Store temporal references in metadata (3.3)
            if (result.temporal_references?.length) {
              const existingMetadata =
                (item.metadata as Record<string, unknown>) ?? {};
              updateData.metadata = {
                ...existingMetadata,
                ai_temporal_references: result.temporal_references,
              };
            }

            // Regenerate embedding with updated title + content
            try {
              const embeddingText = `${result.suggested_title}\n\n${plainText}`;
              const embedding = await generateEmbedding(embeddingText);
              updateData.embedding = JSON.stringify(embedding);
            } catch (embedErr) {
              embeddingErrors++;
              console.error(
                `    Warning: embedding generation failed for "${truncate(displayTitle, 40)}": ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`,
              );
            }

            const { error: updateError } = await supabase
              .from('content_items')
              .update(updateData)
              .eq('id', item.id);

            if (updateError) {
              throw new Error(`Supabase update failed: ${updateError.message}`);
            }
          }

          // ── Insert entity mentions (upsert on unique constraint) ──
          if (entities.length > 0) {
            const entityRows = entities.map((e) => ({
              content_item_id: item.id,
              entity_type: e.type,
              entity_name: e.name,
              canonical_name: e.canonical_name,
              confidence: 1.0,
              context_snippet: extractEntityContext(plainText, e.name),
            }));

            // Delete existing mentions for this item first (clean slate on reclassify)
            await supabase
              .from('entity_mentions')
              .delete()
              .eq('content_item_id', item.id);

            const { error: entityError } = await supabase
              .from('entity_mentions')
              .insert(entityRows);

            if (entityError) {
              console.error(
                `    Warning: entity insert failed for "${truncate(displayTitle, 40)}": ${entityError.message}`,
              );
            } else {
              totalEntities += entities.length;
            }
          }

          // ── Insert relationships ──
          // Always delete existing relationships for this item first
          // (clean slate on reclassify, even when zero new relationships found)
          await supabase
            .from('entity_relationships')
            .delete()
            .eq('source_item_id', item.id);

          if (relationships.length > 0) {
            const relRows = relationships.map((r) => ({
              source_entity: r.source,
              relationship_type: r.relationship,
              target_entity: r.target,
              source_item_id: item.id,
              confidence: 1.0,
            }));

            const { error: relError } = await supabase
              .from('entity_relationships')
              .insert(relRows);

            if (relError) {
              console.error(
                `    Warning: relationship insert failed for "${truncate(displayTitle, 40)}": ${relError.message}`,
              );
            } else {
              totalRelationships += relationships.length;
            }
          }

          // ── Bridge temporal references to entity mentions (3.4) ──
          try {
            await bridgeTemporalReferencesToEntities(supabase, item.id);
          } catch (bridgeErr) {
            console.error(
              `    Warning: temporal reference bridging failed: ${bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr)}`,
            );
          }

          successCount++;

          // Track domain changes
          const oldDomain = item.primary_domain || '(none)';
          const newDomain = result.primary_domain;
          const changed = oldDomain !== newDomain;
          if (changed) {
            domainChanges++;
            const migrationKey = `${oldDomain} -> ${newDomain}`;
            domainMigrations[migrationKey] =
              (domainMigrations[migrationKey] || 0) + 1;
          }

          const tokensUsed = inputTokens + outputTokens;
          const entityCount = entities.length;
          const relCount = relationships.length;
          const changeMarker = changed
            ? ` [CHANGED: ${oldDomain} -> ${newDomain}]`
            : '';
          console.log(
            `  [${String(index).padStart(String(candidates.length).length)}/${candidates.length}] ${truncate(displayTitle, 40)} — ${newDomain}/${result.primary_subtopic} (${result.classification_confidence.toFixed(2)}) ${entityCount}E ${relCount}R (${tokensUsed.toLocaleString()} tok)${changeMarker}`,
          );
        } catch (err) {
          errorCount++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `  [${String(index).padStart(String(candidates.length).length)}/${candidates.length}] ERROR for "${truncate(displayTitle, 45)}": ${message}`,
          );
        }
      }),
    );

    // Check for unexpected rejections
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('  Unexpected batch rejection:', result.reason);
      }
    }
  }

  // ── Final summary ──

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const actualCost =
    totalInputTokens * SONNET_INPUT_PRICE +
    totalOutputTokens * SONNET_OUTPUT_PRICE;

  console.log('');
  console.log('='.repeat(60));
  console.log('  COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Mode:               ${modeLabel}`);
  console.log(`  Succeeded:          ${successCount}`);
  console.log(`  Failed:             ${errorCount}`);
  if (embeddingErrors > 0) {
    console.log(`  Embedding errors:   ${embeddingErrors}`);
  }
  console.log(`  Time:               ${elapsed}s`);
  console.log(`  Input tokens:       ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens:      ${totalOutputTokens.toLocaleString()}`);
  console.log(
    `  Total tokens:       ${(totalInputTokens + totalOutputTokens).toLocaleString()}`,
  );
  console.log(`  Total cost:         ${formatCost(actualCost)}`);
  console.log('');
  console.log(`  Entities extracted: ${totalEntities}`);
  console.log(`  Relationships:      ${totalRelationships}`);
  console.log(
    `  Domain changes:     ${domainChanges} of ${successCount} items`,
  );
  if (Object.keys(domainMigrations).length > 0) {
    console.log('');
    console.log('  Domain migrations:');
    for (const [migration, count] of Object.entries(domainMigrations).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`    ${migration.padEnd(50)} ${count}`);
    }
  }
  if (qualityFlags.length > 0) {
    const issueGroups: Record<string, number> = {};
    for (const flag of qualityFlags) {
      issueGroups[flag.issue] = (issueGroups[flag.issue] || 0) + 1;
    }
    console.log('');
    console.log('  Quality flags:');
    for (const [issue, count] of Object.entries(issueGroups)) {
      console.log(`    ${issue.padEnd(22)} ${count}`);
    }
  }
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
