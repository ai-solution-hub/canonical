/**
 * Classification Eval Runner
 *
 * Compares classifications against a hand-labelled gold standard.
 * Supports two modes:
 *   --cached : Compare against existing DB classifications (free, fast, default)
 *   --live   : Re-classify items via the live AI pipeline (expensive, slow)
 *
 * In live mode, items WITHOUT `live_only: true` are re-classified via
 * `classifyContent` (real DB items, full pipeline). Items WITH `live_only: true`
 * are classified via a focused in-script Claude call that mirrors the
 * production prompt structure but operates on fixture text only (no DB write).
 *
 * Metrics:
 *   - Domain accuracy: correct primary_domain / total items
 *   - Subtopic accuracy: correct primary_subtopic / total items
 *   - Secondary domain accuracy: correct secondary_domain (where expected)
 *   - Keyword overlap: intersection of DB keywords vs expected keywords
 *
 * Usage:
 *   bun run eval:classification
 *   bun run eval:classification --verbose
 *   bun run eval:classification --json
 *   bun run eval:classification --save-baseline
 *   bun run eval:classification --item <uuid>
 *   bun run scripts/eval-classification.ts --live --confirm
 *   bun run scripts/eval-classification.ts --live --confirm --save-baseline
 */

import { readFileSync, existsSync } from 'fs';
import { resolveEvalFixture } from '../lib/eval/fixtures';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createInterface } from 'readline';
import { accuracy } from '../lib/eval/metrics';
import {
  loadBaseline,
  saveBaseline,
  checkRegression,
} from '../lib/eval/baseline';
import { printReport, printJsonReport } from '../lib/eval/reporter';
import type { EvalResult, RegressionResult } from '../lib/eval/types';
import { COST_PER_MILLION } from '../lib/ai/pricing';
import { estimateCost } from '../lib/anthropic';

// ── Constants ───────────────────────────────────────────────────────

/**
 * Pipeline service account UUID for use as `userId` in classifyContent calls.
 * `content_items.updated_by` is a uuid column, so a string like 'eval-runner'
 * causes a postgres `invalid input syntax for type uuid` error.
 *
 * This user is provisioned by:
 * `supabase/migrations/20260406180000_create_pipeline_service_account.sql`
 *
 * The user has admin role in `user_roles` so RLS allows write access.
 */
const PIPELINE_SERVICE_ACCOUNT_USER_ID = 'a0000000-0000-4000-8000-000000000001';

// ── Env loading ─────────────────────────────────────────────────────

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — that's fine
  }
}

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ── Types ───────────────────────────────────────────────────────────

/**
 * Loose Supabase client type. The eval script uses an untyped client
 * (createClient without database generics) so the helpers must accept
 * the widest possible shape rather than the project's strictly-generic
 * SupabaseClient<Database> alias.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = SupabaseClient<any, any, any, any, any>;

export interface GoldItem {
  content_item_id: string;
  title: string;
  content_type: string;
  expected_domain: string;
  expected_subtopic: string;
  expected_secondary_domain: string | null;
  expected_confidence_min: number;
  expected_keywords: string[];
  notes: string;
  /** When true, the item does not exist in the DB and must be classified live. */
  live_only?: boolean;
  /** Optional fixture text — used by live mode for live_only items. */
  text?: string;
  /** Alternate field name for fixture content. */
  content?: string;
}

interface DbRow {
  id: string;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  classification_confidence: number | null;
  ai_keywords: string[] | null;
}

interface ItemScore {
  content_item_id: string;
  title: string;
  domain_match: boolean;
  subtopic_match: boolean;
  secondary_domain_match: boolean | null; // null when not expected
  keyword_overlap: number;
  details: string[];
  /** When true, this item could not be evaluated (not found / live failure). */
  unevaluated: boolean;
  /** Reason the item was unevaluated, if any. */
  unevaluated_reason?: string;
}

// ── CLI Parsing ─────────────────────────────────────────────────────

export interface ParsedArgs {
  verbose: boolean;
  jsonOutput: boolean;
  doSaveBaseline: boolean;
  itemFilter: string | null;
  live: boolean;
  confirm: boolean;
  env: string;
}

/**
 * Parse CLI arguments. Exported so unit tests can verify flag handling
 * without spawning the full eval pipeline.
 *
 * Supports both `--env prod` (space-separated) and `--env=prod` (=-form).
 */
export function parseArgs(args: string[]): ParsedArgs {
  let env = '';
  if (args.includes('--env')) {
    env = args[args.indexOf('--env') + 1] ?? '';
  }
  const eqArg = args.find((a) => a.startsWith('--env='));
  if (eqArg) {
    env = eqArg.slice('--env='.length);
  }
  return {
    verbose: args.includes('--verbose'),
    jsonOutput: args.includes('--json'),
    doSaveBaseline: args.includes('--save-baseline'),
    itemFilter: args.includes('--item')
      ? (args[args.indexOf('--item') + 1] ?? null)
      : null,
    live: args.includes('--live'),
    confirm: args.includes('--confirm'),
    env,
  };
}

// ── --env=prod opt-in ──────────────────────────────────────────────

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

/**
 * --env=prod opt-in: assert SUPABASE_URL is prod-pointed.
 *
 * Per WP-S5.2 spec v1.1 §7.1, the flag DOES NOT swap env values — it only
 * **asserts** the env-resolved URL points at prod. Override via:
 *   SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-svc-key> \
 *     bun run scripts/eval-classification.ts --env=prod
 */
export function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-svc-key> bun run scripts/eval-classification.ts --env=prod`,
    );
    process.exit(1);
  }
}

// ── DB Access ───────────────────────────────────────────────────────

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchClassifications(
  supabase: SupabaseAny,
  itemIds: string[],
): Promise<Map<string, DbRow>> {
  const { data, error } = await supabase
    .from('content_items')
    .select(
      'id, primary_domain, primary_subtopic, secondary_domain, classification_confidence, ai_keywords',
    )
    .in('id', itemIds);

  if (error) {
    console.error('Failed to fetch content items:', error.message);
    process.exit(1);
  }

  const map = new Map<string, DbRow>();
  for (const row of (data ?? []) as DbRow[]) {
    map.set(row.id, row);
  }
  return map;
}

// ── Cost Estimation (Live Mode) ─────────────────────────────────────

/**
 * Per-item cost estimate. Uses fixture text length where available so the
 * estimate is grounded in actual prompt size; falls back to title length
 * for items with no body text.
 *
 * Token math (approx, mirroring lib/anthropic.ts conventions):
 *   - Skill prompts (classification + entity types): ~1500 tokens
 *   - Taxonomy + disambiguation block: ~500 tokens
 *   - Per-item content: 1 token per ~4 chars (capped at 5000 chars input)
 *   - Output (tool_use response): ~500 tokens
 */
export function estimateItemCost(
  item: GoldItem,
  model: string,
): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
} {
  const PROMPT_OVERHEAD_TOKENS = 2000;
  const OUTPUT_TOKENS = 500;
  const CHARS_PER_TOKEN = 4;
  const MAX_INPUT_CHARS = 5000;

  const text = item.text ?? item.content ?? '';
  const titleChars = item.title?.length ?? 0;
  const bodyChars = Math.min(text.length, MAX_INPUT_CHARS);
  const contentTokens = Math.ceil((titleChars + bodyChars) / CHARS_PER_TOKEN);

  const inputTokens = PROMPT_OVERHEAD_TOKENS + contentTokens;

  const costUsd = estimateCost(model, {
    input_tokens: inputTokens,
    output_tokens: OUTPUT_TOKENS,
  });

  return { inputTokens, outputTokens: OUTPUT_TOKENS, costUsd };
}

/**
 * Sum per-item cost estimates across the gold standard. Used for the
 * confirmation gate before any live API calls run.
 */
export function estimateLiveCost(
  items: GoldItem[],
  model: string,
): {
  itemCount: number;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const item of items) {
    const est = estimateItemCost(item, model);
    totalInputTokens += est.inputTokens;
    totalOutputTokens += est.outputTokens;
    totalCostUsd += est.costUsd;
  }

  return {
    itemCount: items.length,
    model,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
  };
}

/** Prompt user for confirmation before running live classification. */
async function confirmLiveRun(estimate: {
  itemCount: number;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}): Promise<boolean> {
  console.log('\n--- LIVE MODE COST ESTIMATE ---\n');
  console.log(`  Items to classify:       ${estimate.itemCount}`);
  console.log(`  Model:                   ${estimate.model}`);
  console.log(
    `  Est. input tokens:       ${estimate.totalInputTokens.toLocaleString()}`,
  );
  console.log(
    `  Est. output tokens:      ${estimate.totalOutputTokens.toLocaleString()}`,
  );
  console.log(
    `  Est. cost:               $${estimate.totalCostUsd.toFixed(4)} USD`,
  );
  console.log(`  Rate limit:              1 req/sec`);
  console.log(
    `  Est. time:               ~${Math.ceil(estimate.itemCount * 1.5)} seconds\n`,
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question('  Proceed? (y/N) ', (answer) => {
      rl.close();
      resolveAnswer(answer.toLowerCase() === 'y');
    });
  });
}

// ── Live Classification ─────────────────────────────────────────────

/**
 * Result shape returned by live classification. Mirrors the relevant
 * subset of `ClassificationResult` from lib/ai/classify.ts so it can flow
 * through the same scoring path as cached DbRow results.
 */
export interface LiveClassification {
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  classification_confidence: number | null;
  ai_keywords: string[] | null;
}

/** Delay helper for rate limiting between live API calls. */
function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Classify a real DB item via the production `classifyContent` function.
 * Used for non-live_only items in live mode. The item must already exist
 * in `content_items` — `force: true` ensures the AI pipeline re-runs.
 */
async function classifyExistingItem(
  supabase: SupabaseAny,
  itemId: string,
): Promise<LiveClassification> {
  const { classifyContent } = await import('../lib/ai/classify');
  // userId must be a valid UUID — content_items.updated_by is a uuid column.
  // Use the pipeline service account (provisioned in
  // 20260406180000_create_pipeline_service_account.sql).
  const result = await classifyContent({
    supabase,
    itemId,
    force: true,
    userId: PIPELINE_SERVICE_ACCOUNT_USER_ID,
  });
  return {
    primary_domain: result.primary_domain ?? null,
    primary_subtopic: result.primary_subtopic ?? null,
    secondary_domain: result.secondary_domain ?? null,
    classification_confidence: result.classification_confidence ?? null,
    ai_keywords: result.ai_keywords ?? null,
  };
}

/**
 * Classify a fixture-only item via a focused Claude call. Mirrors the
 * production prompt construction (skill files + taxonomy + tool schema)
 * but operates on fixture text only — no DB read or write. Used for
 * `live_only` items that have no DB record.
 *
 * The prompt and tool schema MUST stay aligned with classifyContent in
 * lib/ai/classify.ts; if classify.ts changes its prompt structure, this
 * helper should be updated to match.
 */
async function classifyFixtureItem(
  supabase: SupabaseAny,
  item: GoldItem,
): Promise<LiveClassification> {
  // Dynamic imports — avoids loading these modules in cached mode.
  const { getAnthropicClient, getAIModel } = await import('../lib/anthropic');
  const { loadSkill } = await import('../lib/ai/skills/loader');
  const { CLIENT_CONFIG, buildDisambiguationBlock } =
    await import('../lib/client-config');
  const { extractToolResult } = await import('../lib/ai-parse');

  // Load the same skill prompts as classifyContent.
  const classificationSkill = await loadSkill('classification');
  const entityTypesRef = await loadSkill('classification-entity-types');

  // Build taxonomy from the live DB (single source of truth). The
  // dynamically-typed Supabase client returns generic rows, so we cast
  // explicitly to the shape we read.
  const { data: domainsRaw } = await supabase
    .from('taxonomy_domains')
    .select('id, name')
    .eq('is_active', true)
    .order('display_order');

  const { data: subtopicsRaw } = await supabase
    .from('taxonomy_subtopics')
    .select('name, domain_id')
    .eq('is_active', true)
    .order('display_order');

  const domains = (domainsRaw ?? []) as Array<{ id: string; name: string }>;
  const subtopics = (subtopicsRaw ?? []) as Array<{
    name: string;
    domain_id: string;
  }>;

  const taxonomyStr = domains
    .map((d) => {
      const subs = subtopics
        .filter((s) => s.domain_id === d.id)
        .map((s) => s.name);
      return `- ${d.name}: ${subs.join(', ')}`;
    })
    .join('\n');

  // Mirror the disambiguation block from classifyContent. Both this
  // eval harness and the production pipeline (lib/ai/classify.ts) now
  // source the rules from lib/client-config.ts via
  // buildDisambiguationBlock() so they cannot drift.
  // Resolve client entity placeholders across BOTH skill files, mirroring
  // lib/ai/classify.ts. The entity-types reference also carries these
  // placeholders, so it must run through the same substitution.
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
      );

  const prompt =
    resolveClientPlaceholders(
      classificationSkill
        .replace('{TAXONOMY}', taxonomyStr)
        .replace('{CLIENT_DISAMBIGUATION}', buildDisambiguationBlock()),
    ) +
    '\n\n---\n\n' +
    resolveClientPlaceholders(entityTypesRef);

  // Use the fixture's text/content if present, otherwise fall back to title.
  // Title-only is intentional for fixtures that exercise classification on
  // headline information; the AI prompt is robust enough to classify many
  // items from a descriptive title alone.
  const fixtureText = (item.text ?? item.content ?? '').slice(0, 5000);
  const contentForClassification =
    fixtureText.length > 0 ? fixtureText : item.title;

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

  const result = extractToolResult<{
    primary_domain: string;
    primary_subtopic: string;
    secondary_domain?: string | null;
    classification_confidence: number;
    ai_keywords: string[];
  }>(response, 'return_classification');

  return {
    primary_domain: result.primary_domain ?? null,
    primary_subtopic: result.primary_subtopic ?? null,
    secondary_domain: result.secondary_domain ?? null,
    classification_confidence: result.classification_confidence ?? null,
    ai_keywords: result.ai_keywords ?? [],
  };
}

/** Convert a LiveClassification into a DbRow shape for unified scoring. */
function liveToDbRow(itemId: string, live: LiveClassification): DbRow {
  return {
    id: itemId,
    primary_domain: live.primary_domain,
    primary_subtopic: live.primary_subtopic,
    secondary_domain: live.secondary_domain,
    classification_confidence: live.classification_confidence,
    ai_keywords: live.ai_keywords,
  };
}

// ── Scoring ─────────────────────────────────────────────────────────

function computeKeywordOverlap(
  dbKeywords: string[] | null,
  expectedKeywords: string[],
): number {
  if (!dbKeywords || dbKeywords.length === 0 || expectedKeywords.length === 0)
    return 0;

  const dbLower = new Set(dbKeywords.map((k) => k.toLowerCase().trim()));
  let matches = 0;

  for (const expected of expectedKeywords) {
    const expectedLower = expected.toLowerCase().trim();
    // Check for exact match or partial containment
    for (const dbK of dbLower) {
      if (
        dbK === expectedLower ||
        dbK.includes(expectedLower) ||
        expectedLower.includes(dbK)
      ) {
        matches++;
        break;
      }
    }
  }

  return matches / expectedKeywords.length;
}

function scoreItem(
  gold: GoldItem,
  db: DbRow | undefined,
  unevaluatedReason?: string,
): ItemScore {
  const details: string[] = [];

  if (!db) {
    const reason = unevaluatedReason ?? 'Item not found in database';
    details.push(reason);
    return {
      content_item_id: gold.content_item_id,
      title: gold.title,
      domain_match: false,
      subtopic_match: false,
      secondary_domain_match: gold.expected_secondary_domain ? false : null,
      keyword_overlap: 0,
      details,
      unevaluated: true,
      unevaluated_reason: reason,
    };
  }

  const domainMatch = db.primary_domain === gold.expected_domain;
  if (!domainMatch) {
    details.push(
      `Domain: expected="${gold.expected_domain}", actual="${db.primary_domain}"`,
    );
  }

  const subtopicMatch = db.primary_subtopic === gold.expected_subtopic;
  if (!subtopicMatch) {
    details.push(
      `Subtopic: expected="${gold.expected_subtopic}", actual="${db.primary_subtopic}"`,
    );
  }

  let secondaryDomainMatch: boolean | null = null;
  if (gold.expected_secondary_domain) {
    secondaryDomainMatch =
      db.secondary_domain === gold.expected_secondary_domain;
    if (!secondaryDomainMatch) {
      details.push(
        `Secondary domain: expected="${gold.expected_secondary_domain}", actual="${db.secondary_domain}"`,
      );
    }
  }

  const keywordOverlap = computeKeywordOverlap(
    db.ai_keywords,
    gold.expected_keywords,
  );
  if (keywordOverlap < 1.0 && gold.expected_keywords.length > 0) {
    details.push(
      `Keyword overlap: ${(keywordOverlap * 100).toFixed(0)}% (${gold.expected_keywords.join(', ')})`,
    );
  }

  return {
    content_item_id: gold.content_item_id,
    title: gold.title,
    domain_match: domainMatch,
    subtopic_match: subtopicMatch,
    secondary_domain_match: secondaryDomainMatch,
    keyword_overlap: keywordOverlap,
    details,
    unevaluated: false,
  };
}

// ── Main ────────────────────────────────────────────────────────────

const SUITE_NAME = 'classification';

const THRESHOLDS: Record<string, { min?: number; max_drop?: number }> = {
  domain_accuracy: { min: 0.7, max_drop: 0.05 },
  subtopic_accuracy: { min: 0.5, max_drop: 0.1 },
  keyword_overlap: { min: 0.4, max_drop: 0.1 },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {
    verbose,
    jsonOutput,
    doSaveBaseline,
    itemFilter,
    live,
    confirm,
    env,
  } = args;

  // Assert --env=prod when set (per WP-S5.2 spec v1.1 §7.1)
  const envUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  assertEnvFlag(env, envUrl);

  // Load gold standard (public name-swapped fixture — ID-68.17 / TECH PC-7)
  const fixturePath = resolveEvalFixture('classification');
  if (!existsSync(fixturePath)) {
    console.error(`Gold standard fixture not found at: ${fixturePath}`);
    process.exit(1);
  }

  let goldStandard: GoldItem[] = JSON.parse(readFileSync(fixturePath, 'utf-8'));

  // Filter to single item if requested
  if (itemFilter) {
    goldStandard = goldStandard.filter((g) => g.content_item_id === itemFilter);
    if (goldStandard.length === 0) {
      console.error(`Item ${itemFilter} not found in gold standard`);
      process.exit(1);
    }
  }

  const supabase = createServiceClient();
  const itemIds = goldStandard.map((g) => g.content_item_id);
  const dbMap = new Map<string, DbRow>();
  const liveFailures = new Map<string, string>();

  if (live) {
    // ── Live mode: re-run classification ─────────────────────────────
    const model = process.env.AI_SUMMARY_MODEL || 'claude-sonnet-4-6';
    const knownModel = COST_PER_MILLION[model] ? model : 'claude-sonnet-4-5';
    const estimate = estimateLiveCost(goldStandard, knownModel);

    if (!confirm) {
      const proceed = await confirmLiveRun(estimate);
      if (!proceed) {
        console.log('Aborted.');
        process.exit(0);
      }
    } else {
      console.log(
        `\nLive mode: ${estimate.itemCount} items, model=${estimate.model}, est. cost=$${estimate.totalCostUsd.toFixed(4)} USD`,
      );
    }

    console.log(
      `\nRunning live classification for ${goldStandard.length} items...\n`,
    );

    let completed = 0;
    for (const gold of goldStandard) {
      try {
        let liveResult: LiveClassification;

        if (gold.live_only) {
          liveResult = await classifyFixtureItem(supabase, gold);
        } else {
          liveResult = await classifyExistingItem(
            supabase,
            gold.content_item_id,
          );
        }

        dbMap.set(
          gold.content_item_id,
          liveToDbRow(gold.content_item_id, liveResult),
        );
        completed++;

        if (!jsonOutput) {
          process.stdout.write(
            `  [${completed}/${goldStandard.length}] ${gold.title.slice(0, 60)} — ${liveResult.primary_domain ?? '?'}/${liveResult.primary_subtopic ?? '?'}\n`,
          );
        }

        // Rate limit: 1 request per second between live calls
        if (completed < goldStandard.length) {
          await delay(1000);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        liveFailures.set(gold.content_item_id, message);
        completed++;
        console.error(
          `  [${completed}/${goldStandard.length}] FAILED: ${gold.title.slice(0, 60)} — ${message}`,
        );
      }
    }

    console.log(
      `\nLive classification complete: ${completed - liveFailures.size}/${completed} succeeded, ${liveFailures.size} failed.\n`,
    );
  } else {
    // ── Cached mode: read existing classifications from DB ───────────
    console.log(
      `Loading classification data for ${goldStandard.length} gold standard items...`,
    );
    const fetched = await fetchClassifications(supabase, itemIds);
    for (const [id, row] of fetched) {
      dbMap.set(id, row);
    }

    const missing = itemIds.filter((id) => !dbMap.has(id));
    if (missing.length > 0) {
      console.log(
        `Warning: ${missing.length} gold standard items not found in database (skipped — use --live for live_only fixtures)`,
      );
    }
  }

  // Score each item
  const scores: ItemScore[] = [];
  for (const gold of goldStandard) {
    const failureReason = liveFailures.get(gold.content_item_id);
    const dbRow = dbMap.get(gold.content_item_id);
    scores.push(scoreItem(gold, dbRow, failureReason));
  }

  // Aggregate metrics across evaluated items only
  const evaluated = scores.filter((s) => !s.unevaluated);
  const domainCorrect = evaluated.filter((s) => s.domain_match).length;
  const subtopicCorrect = evaluated.filter((s) => s.subtopic_match).length;
  const secondaryItems = evaluated.filter(
    (s) => s.secondary_domain_match !== null,
  );
  const secondaryCorrect = secondaryItems.filter(
    (s) => s.secondary_domain_match === true,
  ).length;
  const avgKeywordOverlap =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.keyword_overlap, 0) /
        evaluated.length
      : 0;

  const domainAcc = accuracy(domainCorrect, evaluated.length);
  const subtopicAcc = accuracy(subtopicCorrect, evaluated.length);
  const secondaryAcc =
    secondaryItems.length > 0
      ? accuracy(secondaryCorrect, secondaryItems.length)
      : 1.0;

  const metrics: Record<string, number> = {
    domain_accuracy: domainAcc,
    subtopic_accuracy: subtopicAcc,
    secondary_domain_accuracy: secondaryAcc,
    keyword_overlap: avgKeywordOverlap,
  };

  // Build failures
  const failures: string[] = [];
  if (domainAcc < (THRESHOLDS.domain_accuracy.min ?? 0)) {
    failures.push(
      `domain_accuracy ${(domainAcc * 100).toFixed(1)}% below minimum ${((THRESHOLDS.domain_accuracy.min ?? 0) * 100).toFixed(0)}%`,
    );
  }
  if (subtopicAcc < (THRESHOLDS.subtopic_accuracy.min ?? 0)) {
    failures.push(
      `subtopic_accuracy ${(subtopicAcc * 100).toFixed(1)}% below minimum ${((THRESHOLDS.subtopic_accuracy.min ?? 0) * 100).toFixed(0)}%`,
    );
  }
  if (avgKeywordOverlap < (THRESHOLDS.keyword_overlap.min ?? 0)) {
    failures.push(
      `keyword_overlap ${(avgKeywordOverlap * 100).toFixed(1)}% below minimum ${((THRESHOLDS.keyword_overlap.min ?? 0) * 100).toFixed(0)}%`,
    );
  }

  // Surface live failures so they are not silently dropped from the report.
  if (live && liveFailures.size > 0) {
    failures.push(
      `${liveFailures.size} live classification(s) failed (see per-item detail)`,
    );
  }

  const result: EvalResult = {
    suite_name: 'Classification Eval',
    timestamp: new Date().toISOString(),
    total_items: evaluated.length,
    metrics,
    passed: failures.length === 0,
    failures,
  };

  // Baseline handling
  const baseline = loadBaseline(SUITE_NAME);
  let regressions: RegressionResult[] | undefined;

  if (baseline) {
    regressions = checkRegression(baseline, metrics);
    const regressionFailures = regressions.filter((r) => !r.passed);
    if (regressionFailures.length > 0) {
      result.passed = false;
      for (const rf of regressionFailures) {
        result.failures.push(
          `Regression: ${rf.metric_name} dropped from ${(rf.baseline_value * 100).toFixed(1)}% to ${(rf.current_value * 100).toFixed(1)}%`,
        );
      }
    }
  }

  if (doSaveBaseline) {
    saveBaseline(SUITE_NAME, metrics, THRESHOLDS);
    console.log('Baseline saved.');
  }

  // Verbose per-item output
  if (verbose && !jsonOutput) {
    console.log('\n--- PER-ITEM DETAIL ---\n');
    for (const s of scores) {
      const status = s.unevaluated
        ? 'SKIP'
        : s.domain_match && s.subtopic_match
          ? 'PASS'
          : 'FAIL';
      console.log(`  [${status}] ${s.title.slice(0, 70)}`);
      for (const d of s.details) {
        console.log(`    ${d}`);
      }
    }
  }

  // Output
  if (jsonOutput) {
    printJsonReport(result, regressions);
  } else {
    printReport(result, regressions);

    // Per-content-type breakdown
    console.log('--- PER-CONTENT-TYPE BREAKDOWN ---\n');
    const byType = new Map<
      string,
      { total: number; domainOk: number; subtopicOk: number }
    >();
    for (let i = 0; i < goldStandard.length; i++) {
      const ct = goldStandard[i].content_type;
      const s = scores[i];
      if (s.unevaluated) continue;
      if (!byType.has(ct))
        byType.set(ct, { total: 0, domainOk: 0, subtopicOk: 0 });
      const entry = byType.get(ct)!;
      entry.total++;
      if (s.domain_match) entry.domainOk++;
      if (s.subtopic_match) entry.subtopicOk++;
    }
    for (const [ct, data] of byType) {
      console.log(
        `  ${ct.padEnd(20)} ${data.total} items  domain=${(accuracy(data.domainOk, data.total) * 100).toFixed(0)}%  subtopic=${(accuracy(data.subtopicOk, data.total) * 100).toFixed(0)}%`,
      );
    }
    console.log('');

    // Live failure summary
    if (live && liveFailures.size > 0) {
      console.log('--- LIVE FAILURES ---\n');
      for (const [id, msg] of liveFailures) {
        const item = goldStandard.find((g) => g.content_item_id === id);
        console.log(`  [${id}] ${item?.title?.slice(0, 60) ?? '?'}`);
        console.log(`    ${msg}`);
      }
      console.log('');
    }
  }

  // Exit code
  if (!result.passed) {
    process.exit(1);
  }
}

// Only run main when invoked as a script. Allows tests to import the
// module without triggering the eval pipeline.
const isDirectInvocation =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] != null &&
  /eval-classification\.ts$/.test(process.argv[1]);

if (isDirectInvocation) {
  main().catch((err) => {
    console.error('Eval failed:', err);
    process.exit(1);
  });
}
