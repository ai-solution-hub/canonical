/**
 * Shared utilities, types, and lazy import wrappers for MCP tool registrations.
 *
 * All heavy modules are loaded on-demand to prevent Vercel serverless cold
 * start crashes. Module-level imports of OpenAI SDK, dashboard queries, and
 * Anthropic SDK cause the function to crash at the V8/Node level before any
 * application code runs.
 */
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerRequest,
  ServerNotification,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  McpServer,
  RegisteredTool,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  AnySchema,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { BidQuestionSummary, BidSection } from '@/lib/mcp/formatters';
import { createMcpClient } from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';

// ---------------------------------------------------------------------------
// Type alias for the extra parameter in tool callbacks
// ---------------------------------------------------------------------------

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ---------------------------------------------------------------------------
// P0-19: MCP tool annotation constants + `defineTool` / `defineAppTool`
// wrappers (DECISIONS.md v4.1 §3.1 P0-19 / C-6 gate).
//
// The four `ToolAnnotations` advisory fields are declared `Required<>` at the
// type level so every tool has to set every one. Pick one of the four named
// constants below — they encode the only policy-approved combinations.
//
// Why a wrapper instead of modifying SDK types? The SDK types are vendored,
// so we can't tighten `registerTool`'s `annotations` to `Required<>` directly.
// A thin wrapper is the idiomatic TypeScript workaround and has zero runtime
// cost (it just delegates to `server.registerTool`).
// ---------------------------------------------------------------------------

/**
 * A `ToolAnnotations` variant where every advisory field is explicit.
 * `defineTool` enforces this at compile time so no tool can silently omit
 * a field.
 * @public
 */
export type RequiredToolAnnotations = Required<
  Pick<
    ToolAnnotations,
    'readOnlyHint' | 'idempotentHint' | 'destructiveHint' | 'openWorldHint'
  >
>;

/**
 * Pure read — no side effects, safe to retry, non-destructive. Use for every
 * `search_*`, `get_*`, `list_*`, `find_*`, `audit_*`, `suggest_*`, `show_*`
 * tool.
 */
export const READ_ONLY_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Write that is safe to retry (same inputs → same end state) and does not
 * destroy data. Use for `update_*`, `assign_*`, `cite_*` (upsert),
 * `classify_content`, `generate_summary`, `update_governance_status`.
 */
export const SAFE_WRITE_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Destructive write — archives or deletes data. Use for `delete_content_item`
 * and similar hard-delete tools. MCP clients may show an extra confirmation
 * prompt for these.
 */
export const DESTRUCTIVE_WRITE_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

/**
 * Write that is NOT idempotent — each call creates a new row or fresh state.
 * Use for `create_content_item` (fresh UUID per call) and similar creators.
 */
export const NON_IDEMPOTENT_WRITE_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Non-idempotent write that interacts with external systems over the network
 * (third-party HTTP APIs, RSS feeds, etc.). Use for tools that trigger
 * pipelines fetching from outside services — clients can warn users about
 * external interactions.
 */
export const NON_IDEMPOTENT_OPEN_WORLD_WRITE_ANNOTATIONS: RequiredToolAnnotations =
  {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: false,
    openWorldHint: true,
  };

/**
 * Tool config shape for `defineTool`. Mirrors the `config` parameter of
 * `McpServer.registerTool` but tightens `annotations` to the
 * `RequiredToolAnnotations` variant.
 * @public
 */
export interface DefineToolConfig<
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  OutputArgs extends ZodRawShapeCompat | AnySchema = ZodRawShapeCompat,
> {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations: RequiredToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Wrapper over `server.registerTool` that enforces all four
 * `ToolAnnotations` fields at compile time. Use one of the named
 * constants (`READ_ONLY_ANNOTATIONS`, `SAFE_WRITE_ANNOTATIONS`,
 * `DESTRUCTIVE_WRITE_ANNOTATIONS`, `NON_IDEMPOTENT_WRITE_ANNOTATIONS`) for
 * the `annotations` field.
 *
 * Return type mirrors `server.registerTool` so callers keep the same
 * `RegisteredTool` handle.
 */
export function defineTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  server: McpServer,
  name: string,
  config: DefineToolConfig<InputArgs, OutputArgs>,
  cb: ToolCallback<InputArgs>,
): RegisteredTool {
  return server.registerTool(name, config, cb);
}

/**
 * Wrapper over the `@modelcontextprotocol/ext-apps` `registerAppTool` helper
 * that enforces the same `RequiredToolAnnotations` contract as `defineTool`.
 *
 * MCP App tools must carry `_meta.ui.resourceUri` (or the deprecated
 * `_meta["ui/resourceUri"]`); the ext-apps `registerAppTool` normalises this.
 * We keep `_meta` as `Record<string, unknown>` on this wrapper because the
 * ext-apps package's own `McpUiAppToolConfig['_meta']` union is narrower than
 * the SDK's base `_meta` and re-expressing it here would couple us to the
 * ext-apps internal types. Callers always pass `{ ui: { resourceUri: '…' } }`
 * at the call site.
 *
 * `registerAppToolFn` is the `registerAppTool` function obtained from
 * `getExtAppsServer()` (it can't be statically imported because ext-apps is
 * a lazy-loaded module for Vercel cold-start reasons).
 */
export function defineAppTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  // ext-apps `McpUiAppToolConfig` has a narrower `_meta` union than the
  // SDK's `ToolConfig['_meta']`; we delegate to the ext-apps runtime and
  // preserve the `RequiredToolAnnotations` contract on our wrapper. The
  // `any` in `config`, `cb`, and the return type are all load-bearing —
  // every narrower type we tried clashed with the ext-apps internals.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  registerAppToolFn: (
    server: Pick<McpServer, 'registerTool'>,
    name: string,
    config: any,
    cb: any,
  ) => any,
  /* eslint-enable @typescript-eslint/no-explicit-any */
  server: McpServer,
  name: string,
  config: DefineToolConfig<InputArgs, OutputArgs> & {
    _meta: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>,
): RegisteredTool {
  return registerAppToolFn(server, name, config, cb);
}

// ---------------------------------------------------------------------------
// Helper — safely convert typed objects to structuredContent
// ---------------------------------------------------------------------------

/**
 * The MCP SDK requires structuredContent to have a `[x: string]: unknown`
 * index signature. This helper performs a safe cast via JSON round-trip.
 */
export function toStructuredContent(data: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Lazy imports — all heavy modules are loaded on-demand to prevent Vercel
// serverless cold start crashes.
// ---------------------------------------------------------------------------

export async function getGenerateEmbedding() {
  const { generateEmbedding } = await import('@/lib/ai/embed');
  return generateEmbedding;
}
export async function getClassifyContent() {
  const { classifyContent } = await import('@/lib/ai/classify');
  return classifyContent;
}
export async function getGenerateSummary() {
  const { generateSummary } = await import('@/lib/ai/summarise');
  return generateSummary;
}
export async function getDashboardModule() {
  return await import('@/lib/dashboard');
}
export async function getBidQueriesModule() {
  return await import('@/lib/bid/bid-queries');
}
export async function getReorientModule() {
  return await import('@/lib/reorient');
}
export async function getAIErrors() {
  const { AIServiceError } = await import('@/lib/ai/errors');
  return AIServiceError;
}
export async function getExtAppsServer() {
  return await import('@modelcontextprotocol/ext-apps/server');
}

// ---------------------------------------------------------------------------
// Shared helper: fetch questions and responses for a bid, returning
// sections grouped by section_name plus status/confidence breakdowns.
// Used by both get_bid_detail and show_bid_dashboard.
// ---------------------------------------------------------------------------

export async function fetchBidSections(
  supabase: ReturnType<typeof createMcpClient>,
  bidId: string,
): Promise<{
  sections: BidSection[];
  status_breakdown: Record<string, number>;
  confidence_breakdown: Record<string, number>;
}> {
  // Fetch individual questions with ordering
  const questions = await sb(
    supabase
      .from('bid_questions')
      .select(
        'id, question_text, section_name, section_sequence, question_sequence, status, confidence_posture, word_limit',
      )
      .eq('workspace_id', bidId)
      .order('section_sequence')
      .order('question_sequence'),
    'mcp.tools.shared.bid.questions',
  );

  // Fetch responses for all questions in this bid (avoids N+1)
  const questionIds = questions.map((q: { id: string }) => q.id);
  const { data: responses } =
    questionIds.length > 0
      ? await supabase
          .from('bid_responses')
          .select('question_id, response_text, review_status')
          .in('question_id', questionIds)
      : {
          data: [] as Array<{
            question_id: string;
            response_text: string | null;
            review_status: string | null;
          }>,
        };

  // Build a response lookup map
  const responseMap = new Map<
    string,
    { response_text: string | null; review_status: string | null }
  >();
  for (const r of responses ?? []) {
    responseMap.set(r.question_id, r);
  }

  // Group questions into sections
  const sectionMap = new Map<string, BidQuestionSummary[]>();
  for (const q of questions) {
    const sectionName = q.section_name ?? 'Ungrouped';
    if (!sectionMap.has(sectionName)) {
      sectionMap.set(sectionName, []);
    }
    const resp = responseMap.get(q.id);
    sectionMap.get(sectionName)!.push({
      id: q.id,
      question_text: q.question_text,
      status: q.status ?? 'not_started',
      confidence_posture: q.confidence_posture ?? null,
      word_limit: q.word_limit ?? null,
      has_response: !!resp?.response_text,
      review_status: resp?.review_status ?? null,
    });
  }

  const sections: BidSection[] = [];
  for (const [name, qs] of sectionMap) {
    sections.push({ name, questions: qs });
  }

  // Compute breakdowns
  const status_breakdown: Record<string, number> = {};
  const confidence_breakdown: Record<string, number> = {};
  for (const q of questions) {
    const s = q.status ?? 'not_started';
    status_breakdown[s] = (status_breakdown[s] ?? 0) + 1;
    const c = q.confidence_posture ?? 'unmatched';
    confidence_breakdown[c] = (confidence_breakdown[c] ?? 0) + 1;
  }

  return { sections, status_breakdown, confidence_breakdown };
}

// ---------------------------------------------------------------------------
// Shared helper: fetch and process quality briefing data from 6 Supabase
// tables. Used by both the kb://quality-briefing resource and the
// get_quality_briefing tool.
// ---------------------------------------------------------------------------

/** @public */
export interface QualityBriefingOptions {
  domain?: string;
  threshold?: number;
}

export async function fetchQualityBriefingData(
  supabase: ReturnType<typeof createMcpClient>,
  options?: QualityBriefingOptions,
): Promise<import('@/lib/mcp/formatters/briefing').QualityBriefingData> {
  // Lazy import — keeps certification-status out of module evaluation
  const { deriveExpiryStatus } = await import('@/lib/certification-status');

  const domainFilter = options?.domain;
  const thresholdOverride = options?.threshold;

  // Build content_items queries with optional domain filter
  let belowThresholdQuery = supabase
    .from('content_items')
    .select(
      'id, title, suggested_title, primary_domain, primary_subtopic, quality_score, freshness, summary, classification_confidence',
    )
    .is('archived_at', null)
    .not('quality_score', 'is', null)
    .order('quality_score', { ascending: true })
    .limit(100);
  if (domainFilter) {
    belowThresholdQuery = belowThresholdQuery.eq(
      'primary_domain',
      domainFilter,
    );
  }

  let scoreDropsQuery = supabase
    .from('content_items')
    .select(
      'id, title, suggested_title, primary_domain, quality_score, previous_quality_score',
    )
    .is('archived_at', null)
    .not('previous_quality_score', 'is', null)
    .limit(100);
  if (domainFilter) {
    scoreDropsQuery = scoreDropsQuery.eq('primary_domain', domainFilter);
  }

  let freshnessQuery = supabase
    .from('content_items')
    .select(
      'id, title, suggested_title, primary_domain, freshness, previous_freshness',
    )
    .is('archived_at', null)
    .not('previous_freshness', 'is', null)
    .limit(100);
  if (domainFilter) {
    freshnessQuery = freshnessQuery.eq('primary_domain', domainFilter);
  }

  // Run all queries in parallel (including governance_config)
  const [
    belowThresholdResult,
    scoreDropsResult,
    freshnessResult,
    qualityFlagsResult,
    coverageAlertsResult,
    certResult,
    govConfigResult,
  ] = await Promise.all([
    belowThresholdQuery,
    scoreDropsQuery,
    freshnessQuery,
    supabase
      .from('notifications')
      .select('id, type, message, created_at, entity_id')
      .eq('type', 'quality_flag')
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('notifications')
      .select('id, type, message, created_at')
      .eq('type', 'coverage_alert')
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('entity_mentions')
      .select('canonical_name, entity_type, metadata')
      .not('metadata', 'is', null)
      .limit(500),
    supabase
      .from('governance_config')
      .select('domain, quality_score_threshold'),
  ]);

  // Build threshold map from governance_config
  const thresholdMap = new Map<string, number>();
  for (const config of (govConfigResult.data ?? []) as unknown as Array<{
    domain: string;
    quality_score_threshold: number | null;
  }>) {
    if (config.quality_score_threshold != null) {
      thresholdMap.set(config.domain, config.quality_score_threshold);
    }
  }
  const defaultThreshold = 40;

  // Process below-threshold items
  type BelowThresholdItemType =
    import('@/lib/mcp/formatters/briefing').BelowThresholdItem;
  const belowThreshold: BelowThresholdItemType[] = [];
  for (const row of (belowThresholdResult.data ?? []) as unknown as Array<{
    id: string;
    title: string | null;
    suggested_title: string | null;
    primary_domain: string | null;
    primary_subtopic: string | null;
    quality_score: number | null;
    freshness: string | null;
    summary: string | null;
    classification_confidence: number | null;
  }>) {
    if (row.quality_score == null) continue;
    const threshold =
      thresholdOverride ??
      thresholdMap.get(row.primary_domain ?? '') ??
      defaultThreshold;
    if (row.quality_score < threshold) {
      belowThreshold.push({
        id: row.id,
        title: row.title,
        suggested_title: row.suggested_title,
        primary_domain: row.primary_domain,
        primary_subtopic: row.primary_subtopic,
        quality_score: row.quality_score,
        freshness: row.freshness,
        summary: row.summary,
        classification_confidence: row.classification_confidence,
      });
    }
  }
  const belowThresholdLimited = belowThreshold.slice(0, 20);

  // Process score drops — filter to items where score actually dropped
  type ScoreDropItemType =
    import('@/lib/mcp/formatters/briefing').ScoreDropItem;
  const scoreDrops: ScoreDropItemType[] = [];
  for (const row of (scoreDropsResult.data ?? []) as unknown as Array<{
    id: string;
    title: string | null;
    suggested_title: string | null;
    primary_domain: string | null;
    quality_score: number | null;
    previous_quality_score: number | null;
  }>) {
    if (
      row.quality_score != null &&
      row.previous_quality_score != null &&
      row.quality_score < row.previous_quality_score
    ) {
      scoreDrops.push({
        id: row.id,
        title: row.title,
        suggested_title: row.suggested_title,
        primary_domain: row.primary_domain,
        quality_score: row.quality_score,
        previous_quality_score: row.previous_quality_score,
      });
    }
  }
  // Sort by drop magnitude descending, limit to 20
  scoreDrops.sort(
    (a, b) =>
      b.previous_quality_score -
      b.quality_score -
      (a.previous_quality_score - a.quality_score),
  );
  const scoreDropsLimited = scoreDrops.slice(0, 20);

  // Process freshness transitions — filter to actual changes
  type FreshnessTransitionItemType =
    import('@/lib/mcp/formatters/briefing').FreshnessTransitionItem;
  const freshnessTransitions: FreshnessTransitionItemType[] = [];
  for (const row of (freshnessResult.data ?? []) as unknown as Array<{
    id: string;
    title: string | null;
    suggested_title: string | null;
    primary_domain: string | null;
    freshness: string | null;
    previous_freshness: string | null;
  }>) {
    if (row.freshness !== row.previous_freshness) {
      freshnessTransitions.push({
        id: row.id,
        title: row.title,
        suggested_title: row.suggested_title,
        primary_domain: row.primary_domain,
        freshness: row.freshness,
        previous_freshness: row.previous_freshness,
      });
    }
  }
  const freshnessTransitionsLimited = freshnessTransitions.slice(0, 20);

  // Quality flags — already filtered by query
  type QualityFlagNotificationType =
    import('@/lib/mcp/formatters/briefing').QualityFlagNotification;
  const qualityFlags = (qualityFlagsResult.data ??
    []) as QualityFlagNotificationType[];

  // Coverage alerts — already filtered by query
  type CoverageAlertNotificationType =
    import('@/lib/mcp/formatters/briefing').CoverageAlertNotification;
  const coverageAlerts = (coverageAlertsResult.data ??
    []) as CoverageAlertNotificationType[];

  // Process certification warnings — derive expiry status
  type CertificationWarningType =
    import('@/lib/mcp/formatters/briefing').CertificationWarning;
  const certWarnings: CertificationWarningType[] = [];
  const seenCerts = new Set<string>();
  for (const row of (certResult.data ?? []) as Array<{
    canonical_name: string;
    entity_type: string;
    metadata: Record<string, unknown> | null;
  }>) {
    const meta = row.metadata;
    if (!meta) continue;
    const expiryDate = meta.expiry_date as string | undefined;
    if (!expiryDate) continue;

    // Deduplicate by canonical_name
    if (seenCerts.has(row.canonical_name)) continue;
    seenCerts.add(row.canonical_name);

    const status = deriveExpiryStatus(expiryDate);
    if (status === 'expiring_soon' || status === 'expired') {
      certWarnings.push({
        canonical_name: row.canonical_name,
        entity_type: row.entity_type,
        expiry_date: expiryDate,
        status,
      });
    }
  }
  const certWarningsLimited = certWarnings.slice(0, 10);

  const briefingData: import('@/lib/mcp/formatters/briefing').QualityBriefingData =
    {
      below_threshold: belowThresholdLimited,
      score_drops: scoreDropsLimited,
      freshness_transitions: freshnessTransitionsLimited,
      quality_flags: qualityFlags,
      coverage_alerts: coverageAlerts,
      certification_warnings: certWarningsLimited,
      generated_at: new Date().toISOString(),
    };

  return briefingData;
}
