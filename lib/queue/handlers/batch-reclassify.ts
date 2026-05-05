/**
 * `batch_reclassify` queue handler — Session 225 W1-IMPL.
 *
 * Spec: `docs/specs/§5.4.2-batch-reclassify-spec.md` §3.1 (body interface),
 * §4.1 (handler signature + result envelope), §4.3 (PermanentJobError
 * conditions), §5.2 (continue-with-partial), §10 D-9 (cooperative
 * cancellation), §7.3 (handler module migration step).
 *
 * Source-of-truth for the loop body: literal extraction from
 * `scripts/batch-reclassify.ts:943-1242` (the CLI's per-item processing
 * loop), with these adjustments:
 *
 *   - CLI args lifted from `process.argv` parsing to `body` (per spec §3.1).
 *   - `supabase` is the worker's service-role client (RLS-bypassing).
 *   - Anthropic SDK instantiated inside the handler (per spec §4.4 step 3).
 *   - Stdout logging replaced with `result.results[]` aggregation (per
 *     spec §4.4 step 5).
 *   - Dry-run preview path removed entirely — queued mode is always
 *     execute-semantics (per spec §4.4 step 6).
 *   - Per-item failure tolerance preserved — continue-with-partial per
 *     spec §5.2 + D-2 ratified.
 *   - 80% per-item failure threshold raises PermanentJobError so the
 *     operator notices an eval-rule regression rather than burning
 *     Anthropic budget (per spec §5.1 + `feedback_eval_prompt_rules_surgical`).
 *   - Cooperative cancellation between items every 10 items (per spec
 *     D-9; cadence fixed in this candidate, configurable in follow-up).
 *   - The `bridgeTemporalReferencesToEntities` and per-item entity
 *     write logic preserved verbatim from CLI L1135-1202.
 *   - Eval-driven prompt rules preserved surgically (per
 *     `feedback_eval_prompt_rules_surgical`) — system prompt + user
 *     message + CLASSIFICATION_TOOL schema copied verbatim from
 *     CLI L176-193 + L341-492 + L966-984.
 *
 * The handler is invoked from `lib/queue/dispatch.ts` `case 'batch_reclassify':`.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isExcludedEntity, validateDomain } from '@/lib/ai/classify';
import { generateEmbedding } from '@/lib/ai/embed';
import { CLIENT_CONFIG } from '@/lib/client-config';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { canonicalise } from '@/lib/entities/entity-dedup';
import { resolveAlias, loadAliases } from '@/lib/entities/entity-aliases';
import { extractEntityContext } from '@/lib/entities/entity-context';
import { bridgeTemporalReferencesToEntities } from '@/lib/entities/entity-metadata-bridge';
import { inferLayer } from '@/lib/layer-inference';
import { logger } from '@/lib/logger';
import { PermanentJobError } from '@/lib/queue/dispatch';
import { createServiceClient } from '@/lib/supabase/server';
import { normaliseTag } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Types — verbatim from spec §3.1 (BatchReclassifyBody) + §4.1
// (BatchReclassifyResult), per `feedback_brief_quote_spec_verbatim`.
// ---------------------------------------------------------------------------

/**
 * Body of a `batch_reclassify` job, stored at
 * `processing_queue.payload.body` per the envelope contract in
 * `docs/specs/background-queue-infra-spec.md` §3.1.
 *
 * Mirrors the existing CLI's `CliArgs` interface
 * (`scripts/batch-reclassify.ts:65-73`) minus the `execute` flag (the
 * queued path is always execute — dry-run is a UI-side preview, not a
 * queued job).
 */
export interface BatchReclassifyBody extends Record<string, unknown> {
  /** Workspace scope. Today Knowledge Hub is single-instance per client
   *  (`CLIENT_CONFIG.client_id === 'default'`); this field is the
   *  client_id string for forward-compatibility with multi-tenant
   *  deployments. The reclassify operates on every active
   *  `content_items` row in the workspace. */
  workspace_id: string;
  /** Optional taxonomy domain filter — only items currently in this
   *  domain are reclassified. Matches the CLI's `--domain` flag
   *  (`scripts/batch-reclassify.ts:101-103`). When undefined or empty,
   *  all domains are processed. */
  domain?: string | null;
  /** Optional cap on the number of items to process. 0 = no limit
   *  (process all). Matches the CLI's `--limit` flag
   *  (`scripts/batch-reclassify.ts:86-88`). Default: 0. */
  limit: number;
  /** When true, ALL items pass the filter regardless of current
   *  classification state (otherwise: only unclassified, low-confidence,
   *  or garbled-keyword items pass). Matches the CLI's `--force` flag
   *  (`scripts/batch-reclassify.ts:97-98`). Default: false. */
  force: boolean;
  /** When true, only entity extraction runs (classification fields are
   *  not updated). Matches the CLI's `--entities-only` flag
   *  (`scripts/batch-reclassify.ts:99-100`). Default: false. */
  entities_only: boolean;
  /** Per-batch concurrency, capped at 3 to respect Anthropic rate
   *  limits (matches CLI's batchSize cap at L113-115). Default: 1. */
  batch_size: number;
  /** Anthropic model identifier. Default: `'claude-sonnet-4-6'`
   *  (matches `AI_SUMMARY_MODEL` env-var default at
   *  `scripts/batch-reclassify.ts:524`). */
  model_tier: string;
}

/**
 * Result envelope returned by the handler. The worker writes this to
 * `processing_queue.result` AND to `pipeline_runs.result` (per spec §6.3
 * Pattern 2 finalisation).
 *
 * Shape mirrors today's CLI's final summary at
 * `scripts/batch-reclassify.ts:1244-1294`.
 */
export interface BatchReclassifyResult extends Record<string, unknown> {
  /** Total number of content_items the filter selected. */
  total_items: number;
  /** Count where reclassification + writes succeeded. */
  reclassified: number;
  /** Count of items skipped (per-item filters: empty content, etc.). */
  skipped: number;
  /** Count where the per-item handler threw. */
  failed: number;
  /** Per-item outcome — same shape as today's CLI per-item logging. */
  results: Array<{
    item_id: string;
    status: 'reclassified' | 'skipped' | 'failed';
    /** When status='reclassified': the new domain. */
    new_domain?: string;
    /** When status='reclassified': the new subtopic. */
    new_subtopic?: string;
    /** When status='reclassified': domain change indicator. */
    domain_changed?: boolean;
    /** When status='skipped': human-readable reason. */
    reason?: string;
    /** When status='failed': error message. */
    error?: string;
  }>;
  /** Sum of input tokens across reclassified items. */
  total_input_tokens: number;
  /** Sum of output tokens across reclassified items. */
  total_output_tokens: number;
  /** Sum of estimated cost in USD across reclassified items. */
  total_cost: number;
  /** Total entities extracted across reclassified items. */
  total_entities: number;
  /** Total entity relationships extracted across reclassified items. */
  total_relationships: number;
  /** Count of items where embedding generation failed (warning, not
   *  failure — the classification still went through, but the
   *  re-embedding step blipped). Matches CLI's `embeddingErrors`
   *  counter at L939. */
  embedding_errors: number;
  /** Count of items whose primary_domain changed in this run. */
  domain_changes: number;
  /** Per-migration count: "old_domain -> new_domain" => count. */
  domain_migrations: Record<string, number>;
  /** True if the run was cancelled mid-flight via cooperative cancel
   *  (per spec D-9). Dispatch case-clause inspects this flag to set
   *  `pipeline_runs.status='completed_with_errors'` + descriptive
   *  `error_message` per D-9.1. */
  cancelled?: boolean;
  /** When `cancelled=true`: human-readable summary like
   *  "cancelled mid-run after 47/500 items". */
  cancellation_message?: string;
}

/**
 * Auth context the dispatcher passes through to the handler. Mirrors
 * `QueueJobPayload<TBody>['auth_context']` from `lib/queue/envelope.ts`.
 */
export interface BatchReclassifyAuthContext {
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  workspace_id?: string;
}

// ---------------------------------------------------------------------------
// Helpers — copied verbatim from `scripts/batch-reclassify.ts` per spec §7.3.
// ---------------------------------------------------------------------------

// Content type priority ordering (q_a_pair first — bulk of garbled items).
// Verbatim from `scripts/batch-reclassify.ts:137-152`.
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

// Sonnet pricing (per token). Verbatim from `scripts/batch-reclassify.ts:155-156`.
const SONNET_INPUT_PRICE = 3.0 / 1_000_000;
const SONNET_OUTPUT_PRICE = 15.0 / 1_000_000;

// Garbled keyword pattern: same word repeated 3+ times with hyphens.
// Verbatim from `scripts/batch-reclassify.ts:158-160`.
const GARBLED_KEYWORD_REGEX = /(\b\w+(?:-\w+)*)\1{2,}|(\b\w+\b)(?:-\2){2,}/;

// System prompt for classification + entity extraction.
// Verbatim from `scripts/batch-reclassify.ts:176-193`.
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

function contentTypeSortKey(contentType: string | null): number {
  const idx = CONTENT_TYPE_PRIORITY.indexOf(contentType ?? 'other');
  return idx === -1 ? CONTENT_TYPE_PRIORITY.length : idx;
}

/** Check if an item has garbled keywords (pre-v4.0 classification artefact).
 *  Verbatim from `scripts/batch-reclassify.ts:277-280`. */
function hasGarbledKeywords(keywords: string[] | null): boolean {
  if (!keywords || keywords.length === 0) return false;
  return keywords.some((kw) => GARBLED_KEYWORD_REGEX.test(kw));
}

// Editorial note patterns in content. Verbatim from
// `scripts/batch-reclassify.ts:163-173`.
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

/** Check if content starts with editorial notes. Verbatim from
 *  `scripts/batch-reclassify.ts:283-286`. */
function hasEditorialNotes(content: string): boolean {
  const trimmed = content.trim();
  return EDITORIAL_NOTE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// Re-export hasEditorialNotes for external testing if needed.
export { hasGarbledKeywords, hasEditorialNotes, contentTypeSortKey };

// Tool schema for Claude. Verbatim from `scripts/batch-reclassify.ts:341-492`.
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

// Cooperative-cancel poll cadence (per spec D-9). Fixed at 10 items in this
// candidate; configurable in follow-up if operationally needed.
const CANCEL_POLL_CADENCE = 10;

/**
 * Loads taxonomy domains + subtopics into a string suitable for the user
 * message. Mirrors `loadTaxonomy()` at `scripts/batch-reclassify.ts:290-337`,
 * but throws PermanentJobError instead of `process.exit(1)` (per spec §4.3).
 */
async function loadTaxonomy(
  supabase: SupabaseClient<Database>,
): Promise<{ taxonomyStr: string; validDomainSlugs: string[] }> {
  const { data: domains, error: dErr } = await supabase
    .from('taxonomy_domains')
    .select('id, name')
    .eq('is_active', true)
    .order('display_order');

  if (dErr) {
    throw new PermanentJobError(
      `taxonomy_load_failed: domains: ${dErr.message}`,
    );
  }

  const { data: subtopics, error: sErr } = await supabase
    .from('taxonomy_subtopics')
    .select('name, domain_id, description')
    .eq('is_active', true)
    .order('display_order');

  if (sErr) {
    throw new PermanentJobError(
      `taxonomy_load_failed: subtopics: ${sErr.message}`,
    );
  }

  if (!domains || domains.length === 0) {
    throw new PermanentJobError('taxonomy_load_failed: zero domains returned');
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

/**
 * Polls `processing_queue` for the current job's status using an internal
 * service-role client (per `feedback_orchestrator_internal_service_client_test_mock`
 * + `feedback_pipeline_runs_rls_chokepoint`). Returns true when the row's
 * status is `'cancelled'`, indicating the operator has requested mid-flight
 * cancellation.
 *
 * Best-effort: if the SELECT errors, returns false (the next poll-tick
 * re-checks). Per spec D-9: "Race-safe via the same `.in('status', ...)`
 * filter on the cancel UPDATE plus a final guard in the handler."
 */
async function isJobCancelled(jobId: string | undefined): Promise<boolean> {
  if (!jobId) return false;
  try {
    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from('processing_queue')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();
    if (error || !data) return false;
    return data.status === 'cancelled';
  } catch {
    return false;
  }
}

/**
 * Handler entry point. Pure async function — no Next.js Request/Response,
 * no auth lookups (the dispatcher has already re-validated auth context per
 * spec §4.2 PR-5 before calling).
 *
 * Throws `PermanentJobError` for handler-level fatal conditions:
 *   - `body.workspace_id` missing or empty (envelope guard)
 *   - `body.workspace_id !== CLIENT_CONFIG.client_id` (payload tampering)
 *   - taxonomy load returns 0 domains (deployment misconfiguration)
 *   - 0 candidates with `force: true` (AC-8 — explicit operator signal
 *     that some workspace items SHOULD be reclassified)
 *   - per-item failure rate > 80% of items processed (eval-rule regression
 *     escalation per `feedback_eval_prompt_rules_surgical`)
 *
 * Per-item failures are caught and recorded as `status: 'failed'` in
 * `results[]` (continue-with-partial, per spec §5.2 + D-2 ratified).
 *
 * @param body Job-type body — see `BatchReclassifyBody`.
 * @param supabase Service-role Supabase client (RLS-bypassing).
 * @param authContext Dispatcher-provided auth context. Currently unused
 *   inside the handler (the dispatcher's `reValidateAuthContext` gate
 *   already authenticated the run); the parameter is preserved for
 *   parity with `runBidDraftAllJob` and forward-compatibility (e.g. an
 *   `updated_by` audit field on `content_items`).
 * @param jobId Optional `processing_queue.id` for cooperative-cancel
 *   polling. The dispatcher passes the row's id; tests may omit.
 */
export async function runBatchReclassifyJob(
  body: BatchReclassifyBody,
  supabase: SupabaseClient<Database>,
  // Dispatcher passes the auth context for forward-compat. Currently unused
  // inside the handler body.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  authContext: BatchReclassifyAuthContext,
  jobId?: string,
): Promise<BatchReclassifyResult> {
  // ------------------------------------------------------------------
  // 1. Envelope-level fatal validations per spec §4.3.
  // ------------------------------------------------------------------
  if (!body.workspace_id || body.workspace_id.length === 0) {
    throw new PermanentJobError('workspace_id_missing');
  }
  if (body.workspace_id !== CLIENT_CONFIG.client_id) {
    throw new PermanentJobError(
      `workspace_id_mismatch: payload=${body.workspace_id}, expected=${CLIENT_CONFIG.client_id}`,
    );
  }

  const {
    domain = null,
    limit = 0,
    force = false,
    entities_only = false,
    model_tier,
  } = body;
  const model = model_tier || 'claude-sonnet-4-6';

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new PermanentJobError('anthropic_api_key_missing');
  }
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // ------------------------------------------------------------------
  // 2. Load taxonomy + entity aliases. Permanent-fail on zero domains.
  // ------------------------------------------------------------------
  const { taxonomyStr, validDomainSlugs } = await loadTaxonomy(supabase);
  await loadAliases(supabase);

  // ------------------------------------------------------------------
  // 3. Fetch candidate content_items.
  //    Mirror CLI L582-714 (`scripts/batch-reclassify.ts:582-714`) with
  //    the dry-run preview branch removed entirely — queued mode is
  //    always execute-semantics (per spec §4.4 step 6).
  // ------------------------------------------------------------------
  let candidates: ContentRow[];

  if (entities_only) {
    // Entities-only mode: items that ARE classified but lack entity mentions.
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
      throw new PermanentJobError(
        `content_items_fetch_failed: ${fetchError.message}`,
      );
    }
    if (!items || items.length === 0) {
      candidates = [];
    } else {
      // Paginate to fetch ALL entity_mentions content_item_ids
      const mentionedSet = new Set<string>();
      let mentionOffset = 0;
      const mentionPageSize = 5000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: mentionPage, error: mentionError } = await supabase
          .from('entity_mentions')
          .select('content_item_id')
          .range(mentionOffset, mentionOffset + mentionPageSize - 1);

        if (mentionError) {
          throw new PermanentJobError(
            `entity_mentions_fetch_failed: ${mentionError.message}`,
          );
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
    }
  } else {
    // Normal reclassification mode: active (non-archived) items.
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
      throw new PermanentJobError(
        `content_items_fetch_failed: ${fetchError.message}`,
      );
    }
    if (!items || items.length === 0) {
      candidates = [];
    } else {
      const filtered = (items as ContentRow[])
        .filter((item) => {
          if (!item.content || item.content.trim().length === 0) return false;
          if (force) return true;
          if (!item.classified_at) return true;
          if (
            item.classification_confidence !== null &&
            item.classification_confidence < 0.7
          )
            return true;
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
  }

  // ------------------------------------------------------------------
  // 4. AC-7 vs AC-8 boundary.
  //    - 0 candidates with force=false → return zero-success result.
  //    - 0 candidates with force=true → PermanentJobError (operator signal
  //      that something SHOULD be reclassified).
  // ------------------------------------------------------------------
  if (candidates.length === 0) {
    if (force) {
      throw new PermanentJobError('no_candidates_under_force');
    }
    // Legitimate "nothing needs reclassifying" path — AC-7.
    return {
      total_items: 0,
      reclassified: 0,
      skipped: 0,
      failed: 0,
      results: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost: 0,
      total_entities: 0,
      total_relationships: 0,
      embedding_errors: 0,
      domain_changes: 0,
      domain_migrations: {},
    };
  }

  // ------------------------------------------------------------------
  // 5. Per-item processing loop.
  //    Mirrors CLI L943-1242 verbatim, with stdout logging replaced by
  //    `result.results[]` aggregation + cooperative-cancel polling
  //    every 10 items per spec D-9.
  // ------------------------------------------------------------------
  const itemResults: BatchReclassifyResult['results'] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEntities = 0;
  let totalRelationships = 0;
  let embeddingErrors = 0;
  let domainChanges = 0;
  const domainMigrations: Record<string, number> = {};
  let cancelled = false;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];

    // Cooperative-cancel poll every CANCEL_POLL_CADENCE items.
    if (i > 0 && i % CANCEL_POLL_CADENCE === 0) {
      if (await isJobCancelled(jobId)) {
        cancelled = true;
        break;
      }
    }

    try {
      // Prepare content for classification (truncate at 5000 chars).
      const plainText = stripMarkdown(item.content!);
      const contentForClassification = plainText.slice(0, 5000);

      // Build user message — verbatim from CLI L966-984 to preserve
      // eval-driven prompt rules surgically per
      // `feedback_eval_prompt_rules_surgical`.
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

      // Call Claude API with tool_choice to force structured output.
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

      // Extract tool result.
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

      // Track token usage.
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      // Validate domains against taxonomy slugs.
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

      // Normalise keywords.
      const normalisedKeywords = (
        Array.isArray(result.ai_keywords) ? result.ai_keywords : []
      )
        .map(normaliseTag)
        .filter((k) => k.length > 0);
      const uniqueKeywords = [...new Set(normalisedKeywords)];

      // Apply canonicalisation + alias resolution to entity names.
      const entities = (
        Array.isArray(result.entities) ? result.entities : []
      )
        .filter(
          (e) =>
            !isExcludedEntity(e.name) && !isExcludedEntity(e.canonical_name),
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

      // Update content_items with classification results (skip if entities_only).
      if (!entities_only) {
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
          classified_at: new Date(Date.now()).toISOString(),
          layer: layerSuggestion.suggestedLayer,
        };

        // Store temporal references in metadata.
        if (result.temporal_references?.length) {
          const existingMetadata =
            (item.metadata as Record<string, unknown>) ?? {};
          updateData.metadata = {
            ...existingMetadata,
            ai_temporal_references: result.temporal_references,
          };
        }

        // Regenerate embedding with updated title + content.
        try {
          const embeddingText = `${result.suggested_title}\n\n${plainText}`;
          const embedding = await generateEmbedding(embeddingText);
          updateData.embedding = JSON.stringify(embedding);
        } catch (embedErr) {
          embeddingErrors++;
          logger.warn(
            { err: embedErr, item_id: item.id },
            'batch_reclassify handler: embedding generation failed',
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

      // Insert entity mentions (delete-then-insert; clean slate on reclassify).
      if (entities.length > 0) {
        const entityRows = entities.map((e) => ({
          content_item_id: item.id,
          entity_type: e.type,
          entity_name: e.name,
          canonical_name: e.canonical_name,
          confidence: 1.0,
          context_snippet: extractEntityContext(plainText, e.name),
        }));

        await supabase
          .from('entity_mentions')
          .delete()
          .eq('content_item_id', item.id);

        const { error: entityError } = await supabase
          .from('entity_mentions')
          .insert(entityRows);

        if (entityError) {
          logger.warn(
            { err: entityError, item_id: item.id },
            'batch_reclassify handler: entity insert failed',
          );
        } else {
          totalEntities += entities.length;
        }
      }

      // Always delete existing relationships for this item first
      // (clean slate on reclassify, even when zero new relationships found).
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
          logger.warn(
            { err: relError, item_id: item.id },
            'batch_reclassify handler: relationship insert failed',
          );
        } else {
          totalRelationships += relationships.length;
        }
      }

      // Bridge temporal references to entity mentions.
      try {
        await bridgeTemporalReferencesToEntities(supabase, item.id);
      } catch (bridgeErr) {
        logger.warn(
          { err: bridgeErr, item_id: item.id },
          'batch_reclassify handler: temporal reference bridging failed',
        );
      }

      // Track domain changes.
      const oldDomain = item.primary_domain || '(none)';
      const newDomain = result.primary_domain;
      const changed = oldDomain !== newDomain;
      if (changed) {
        domainChanges++;
        const migrationKey = `${oldDomain} -> ${newDomain}`;
        domainMigrations[migrationKey] =
          (domainMigrations[migrationKey] || 0) + 1;
      }

      itemResults.push({
        item_id: item.id,
        status: 'reclassified',
        new_domain: result.primary_domain,
        new_subtopic: result.primary_subtopic,
        domain_changed: changed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, item_id: item.id },
        'batch_reclassify handler: per-item processing failed',
      );
      itemResults.push({
        item_id: item.id,
        status: 'failed',
        error: message,
      });
    }
  }

  // ------------------------------------------------------------------
  // 6. 80% per-item failure threshold escalation per spec §5.1 +
  //    `feedback_eval_prompt_rules_surgical`.
  //    Skipped on cancellation (partial run is expected to have low
  //    counts; classifying it as a regression would mask the cancel).
  // ------------------------------------------------------------------
  const reclassifiedCount = itemResults.filter(
    (r) => r.status === 'reclassified',
  ).length;
  const failedCount = itemResults.filter((r) => r.status === 'failed').length;
  const skippedCount = itemResults.filter((r) => r.status === 'skipped').length;
  const totalProcessed = itemResults.length;

  if (
    !cancelled &&
    totalProcessed > 0 &&
    failedCount / totalProcessed > 0.8
  ) {
    throw new PermanentJobError(
      `eval_rule_regression_suspected: ${failedCount}/${totalProcessed} items failed (>80% threshold)`,
    );
  }

  // ------------------------------------------------------------------
  // 7. Final aggregation. Compute cost using Sonnet pricing (mirrors
  //    CLI L1247-1249).
  // ------------------------------------------------------------------
  const totalCost =
    totalInputTokens * SONNET_INPUT_PRICE +
    totalOutputTokens * SONNET_OUTPUT_PRICE;

  const result: BatchReclassifyResult = {
    total_items: candidates.length,
    reclassified: reclassifiedCount,
    skipped: skippedCount,
    failed: failedCount,
    results: itemResults,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_cost: totalCost,
    total_entities: totalEntities,
    total_relationships: totalRelationships,
    embedding_errors: embeddingErrors,
    domain_changes: domainChanges,
    domain_migrations: domainMigrations,
  };

  if (cancelled) {
    result.cancelled = true;
    result.cancellation_message = `cancelled mid-run after ${totalProcessed}/${candidates.length} items`;
  }

  return result;
}
