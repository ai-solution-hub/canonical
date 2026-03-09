/**
 * Batch Reclassification + Entity Extraction
 *
 * Reclassifies content items with garbled keywords (pre-v4.0 classification)
 * using the v4.0 classification prompt. Simultaneously extracts named entities
 * and relationships for the context graph (entity_mentions + entity_relationships
 * tables).
 *
 * Also generates a data quality report identifying duplicates, fragments, and
 * items with editorial notes in content.
 *
 * Usage:
 *   bun run scripts/batch_reclassify.ts --limit 20
 *   bun run scripts/batch_reclassify.ts --limit 50 --batch-size 3
 *   bun run scripts/batch_reclassify.ts --dry-run
 *   bun run scripts/batch_reclassify.ts --force
 *   bun run scripts/batch_reclassify.ts --entities-only --limit 10
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { generateEmbedding } from '@/lib/ai/embed';
import { htmlToPlainText } from '@/lib/editor-utils';

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
  dryRun: boolean;
  batchSize: number;
  force: boolean;
  entitiesOnly: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let limit = 20;
  let dryRun = false;
  let batchSize = 3;
  let force = false;
  let entitiesOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--entities-only') {
      entitiesOnly = true;
    }
  }

  if (isNaN(limit) || limit < 1) limit = 20;
  if (isNaN(batchSize) || batchSize < 1) batchSize = 3;
  // Cap concurrent requests at 5
  if (batchSize > 5) batchSize = 5;

  return { limit, dryRun, batchSize, force, entitiesOnly };
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
capabilities, people, technologies, projects, and sectors. Relationships describe
how entities relate to each other.`;

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
}

interface ClassificationWithEntities {
  primary_domain: string;
  primary_subtopic: string;
  secondary_domain?: string | null;
  secondary_subtopic?: string | null;
  ai_keywords: string[];
  ai_summary: string;
  suggested_title: string;
  classification_confidence: number;
  classification_reasoning: string;
  entities: EntityExtraction[];
  relationships: RelationshipExtraction[];
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

import { canonicalise } from '@/lib/entity-dedup';

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

// Hardcoded fallback taxonomy (matches DB-driven taxonomy)
// Used when the Supabase client cannot read taxonomy tables (e.g. anon key without auth)
const FALLBACK_TAXONOMY = `- SECURITY: data-protection, cyber-security, encryption, access-control, iso-27001
- COMPLIANCE: standards, regulatory, audit, certification
- IMPLEMENTATION: deployment, migration, onboarding, integration
- SUPPORT: sla, helpdesk, maintenance, incident
- CORPORATE: company-info, financial, insurance, references, staffing
- PRODUCT-FEATURE: functionality, technical, reporting, usability
- METHODOLOGY: approach, project-management, quality, delivery`;

async function loadTaxonomy(supabase: SupabaseClient): Promise<string> {
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

  const result = (domains ?? [])
    .map((d) => {
      const subs = (subtopics ?? [])
        .filter((s) => s.domain_id === d.id)
        .map((s) => s.name);
      return `- ${d.name}: ${subs.join(', ')}`;
    })
    .join('\n');

  // Fall back to hardcoded taxonomy if DB query returns empty (e.g. anon key without auth)
  if (!result) {
    console.log('  Using hardcoded fallback taxonomy (DB query returned empty — likely RLS)');
    return FALLBACK_TAXONOMY;
  }

  return result;
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
      ai_summary: {
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
    },
    required: [
      'primary_domain',
      'primary_subtopic',
      'ai_keywords',
      'ai_summary',
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
  const { limit, dryRun, batchSize, force, entitiesOnly } = parseArgs();

  // Validate env
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Missing SUPABASE_URL / SUPABASE_SECRET_KEY (or SUPABASE_ANON_KEY) in environment',
    );
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error('Missing ANTHROPIC_API_KEY in environment');
    process.exit(1);
  }

  const usingServiceRole = !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const model = process.env.AI_SUMMARY_MODEL || 'claude-sonnet-4-6';
  const supabase = createClient(supabaseUrl, supabaseKey);
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
        'WARNING: No SUPABASE_SECRET_KEY and no SUPABASE_AUTH_EMAIL/SUPABASE_AUTH_PASSWORD.',
      );
      console.warn(
        'The script may not be able to read/write data due to RLS policies.',
      );
      console.warn(
        'Set SUPABASE_SECRET_KEY in .env or SUPABASE_AUTH_EMAIL/SUPABASE_AUTH_PASSWORD in .env.local.',
      );
    }
  }

  // ── Load taxonomy ──

  console.log('\nLoading taxonomy from database...');
  const taxonomyStr = await loadTaxonomy(supabase);
  if (!taxonomyStr) {
    console.error('Failed to load taxonomy — no domains found');
    process.exit(1);
  }
  console.log('Taxonomy loaded.\n');

  // ── Fetch items needing reclassification ──

  const modeLabel = entitiesOnly
    ? 'entity extraction only'
    : force
      ? 'forced reclassification'
      : 'reclassification';
  console.log(
    `Fetching content items for ${modeLabel} (limit ${limit})...\n`,
  );

  let candidates: ContentRow[];

  if (entitiesOnly) {
    // Entities-only mode: fetch items that ARE classified but don't have entity mentions yet
    const { data: items, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'id, content, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_keywords, classification_confidence, classified_at',
      )
      .not('classified_at', 'is', null)
      .not('content', 'is', null)
      .order('captured_date', { ascending: false })
      .limit(500);

    if (fetchError) {
      console.error('Failed to fetch items:', fetchError.message);
      process.exit(1);
    }

    if (!items || items.length === 0) {
      console.log('No classified items found. Nothing to do.');
      return;
    }

    // Filter to items without entity mentions
    const { data: mentionedItemIds } = await supabase
      .from('entity_mentions')
      .select('content_item_id');

    const mentionedSet = new Set(
      (mentionedItemIds ?? []).map((r) => r.content_item_id),
    );

    candidates = (items as ContentRow[])
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
      )
      .slice(0, limit);
  } else {
    // Normal reclassification mode: fetch items with garbled keywords, low confidence, or unclassified
    const { data: items, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'id, content, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_keywords, classification_confidence, classified_at',
      )
      .not('content', 'is', null)
      .order('captured_date', { ascending: false })
      .limit(500);

    if (fetchError) {
      console.error('Failed to fetch items:', fetchError.message);
      process.exit(1);
    }

    if (!items || items.length === 0) {
      console.log('No content items found. Nothing to do.');
      return;
    }

    // Filter to items needing reclassification
    candidates = (items as ContentRow[])
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
      )
      .slice(0, limit);
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
      const displayTitle = (
        item.suggested_title ||
        item.title ||
        ''
      ).toLowerCase().trim();
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
      const plainText = htmlToPlainText(item.content || '');
      if (plainText.length < 20 && plainText.length > 0) {
        qualityFlags.push({
          itemId: item.id,
          title: truncate(
            item.suggested_title || item.title || 'Untitled',
            60,
          ),
          issue: 'FRAGMENT',
          detail: `Content is ${plainText.length} chars — needs expansion`,
        });
      }
    }

    // Check for editorial notes in content
    for (const item of allItems) {
      const plainText = htmlToPlainText(item.content || '');
      if (hasEditorialNotes(plainText)) {
        qualityFlags.push({
          itemId: item.id,
          title: truncate(
            item.suggested_title || item.title || 'Untitled',
            60,
          ),
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
  const estimatedInputTokens = Math.ceil(totalChars / 4) + candidates.length * 300;
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
  console.log(`  Mode:                 ${modeLabel}`);
  console.log(`  Items to process:     ${candidates.length}`);
  console.log(`  Model:                ${model}`);
  console.log(`  Batch size:           ${batchSize} concurrent`);
  console.log(`  Service role:         ${usingServiceRole ? 'yes' : 'no (using anon key)'}`);
  console.log(`  Est. input tokens:    ${estimatedInputTokens.toLocaleString()}`);
  console.log(`  Est. output tokens:   ${estimatedOutputTokens.toLocaleString()}`);
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

  if (dryRun) {
    console.log('\n-- DRY RUN -- Items that would be processed:\n');
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const displayTitle = item.suggested_title || item.title || 'Untitled';
      const contentLen = item.content?.length ?? 0;
      const garbled = hasGarbledKeywords(item.ai_keywords) ? ' [GARBLED]' : '';
      const conf =
        item.classification_confidence !== null
          ? ` (conf: ${item.classification_confidence.toFixed(2)})`
          : ' (unclassified)';
      console.log(
        `  ${String(i + 1).padStart(3)}. [${(item.content_type || 'other').padEnd(22)}] ${truncate(displayTitle, 50)} (${contentLen.toLocaleString()} chars)${conf}${garbled}`,
      );
    }
    console.log('\nRun without --dry-run to process.');
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
  const startTime = Date.now();

  for (
    let batchStart = 0;
    batchStart < candidates.length;
    batchStart += batchSize
  ) {
    const batch = candidates.slice(batchStart, batchStart + batchSize);

    if (batchStart > 0) {
      // 2-second delay between batches to avoid rate limiting
      await sleep(2000);
    }

    const results = await Promise.allSettled(
      batch.map(async (item, batchIndex) => {
        const index = batchStart + batchIndex + 1;
        const displayTitle =
          item.suggested_title || item.title || 'Untitled';

        try {
          // Prepare content for classification (truncate at 5000 chars)
          const plainText = htmlToPlainText(item.content!);
          const contentForClassification = plainText.slice(0, 5000);

          // Build user message
          const userMessage = `Available domains and subtopics:
${taxonomyStr}

Content type: ${item.content_type}
Title: ${item.title || item.suggested_title || 'Untitled'}

Content:
${contentForClassification}

Classify this content and extract entities and relationships. Return the classification with entities.`;

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
            (
              block,
            ): block is Anthropic.Messages.ToolUseBlock =>
              block.type === 'tool_use' &&
              block.name === 'return_classification_with_entities',
          );

          if (!toolBlock) {
            throw new Error(
              'Claude did not return a return_classification_with_entities tool call',
            );
          }

          const result =
            toolBlock.input as ClassificationWithEntities;

          // Track token usage
          const inputTokens = response.usage.input_tokens;
          const outputTokens = response.usage.output_tokens;
          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;

          // ── Apply canonicalisation to entity names ──
          const entities = (result.entities || []).map((e) => ({
            ...e,
            canonical_name: canonicalise(e.canonical_name),
          }));

          const relationships = (result.relationships || []).map(
            (r) => ({
              ...r,
              source: canonicalise(r.source),
              target: canonicalise(r.target),
            }),
          );

          // ── Update content_items with classification results ──
          if (!entitiesOnly) {
            const updateData: Record<string, unknown> = {
              primary_domain: result.primary_domain,
              primary_subtopic: result.primary_subtopic,
              secondary_domain: result.secondary_domain ?? null,
              secondary_subtopic: result.secondary_subtopic ?? null,
              ai_keywords: result.ai_keywords,
              ai_summary: result.ai_summary,
              suggested_title: result.suggested_title,
              classification_confidence:
                result.classification_confidence,
              classification_reasoning:
                result.classification_reasoning,
              classified_at: new Date().toISOString(),
            };

            // Regenerate embedding with updated title + content
            try {
              const embeddingText = `${result.suggested_title}\n\n${plainText}`;
              const embedding =
                await generateEmbedding(embeddingText);
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
              throw new Error(
                `Supabase update failed: ${updateError.message}`,
              );
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

          successCount++;

          const tokensUsed = inputTokens + outputTokens;
          const entityCount = entities.length;
          const relCount = relationships.length;
          console.log(
            `  [${String(index).padStart(String(candidates.length).length)}/${candidates.length}] ${truncate(displayTitle, 45)} — ${result.primary_domain}/${result.primary_subtopic} (${result.classification_confidence.toFixed(2)}) ${entityCount}E ${relCount}R (${tokensUsed.toLocaleString()} tok)`,
          );
        } catch (err) {
          errorCount++;
          const message =
            err instanceof Error ? err.message : String(err);
          console.error(
            `  [${String(index).padStart(String(candidates.length).length)}/${candidates.length}] ERROR for "${truncate(displayTitle, 45)}": ${message}`,
          );
        }
      }),
    );

    // Check for unexpected rejections
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(
          '  Unexpected batch rejection:',
          result.reason,
        );
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
