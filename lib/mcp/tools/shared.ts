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
import type {
  ProcurementQuestionSummary,
  ProcurementSection,
} from '@/lib/mcp/formatters';
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
export async function getProcurementQueriesModule() {
  return await import('@/lib/domains/procurement/procurement-queries');
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
// Used by both get_procurement_detail and show_procurement_dashboard.
// ---------------------------------------------------------------------------

export async function fetchProcurementSections(
  supabase: ReturnType<typeof createMcpClient>,
  procurementId: string,
): Promise<{
  sections: ProcurementSection[];
  status_breakdown: Record<string, number>;
  confidence_breakdown: Record<string, number>;
}> {
  // ID-145 {145.21} DR-056 re-key: form_questions.workspace_id was DROPPED
  // (W1c, {145.6}) — form_template_id was renamed to form_instance_id and
  // every question now belongs to exactly one form by construction (BI-7).
  // `procurementId` is a form id, not a workspace id, for both callers of
  // this helper (get_procurement_detail + show_procurement_dashboard).
  const questions = await sb(
    supabase
      .from('form_questions')
      .select(
        'id, question_text, section_name, section_sequence, question_sequence, status, confidence_posture, word_limit',
      )
      .eq('form_instance_id', procurementId)
      .order('section_sequence')
      .order('question_sequence'),
    'mcp.tools.shared.bid.questions',
  );

  // Fetch responses for all questions in this bid (avoids N+1)
  const questionIds = questions.map((q: { id: string }) => q.id);
  const { data: responses } =
    questionIds.length > 0
      ? await supabase
          .from('form_responses')
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
  const sectionMap = new Map<string, ProcurementQuestionSummary[]>();
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

  const sections: ProcurementSection[] = [];
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

  // ID-131 (G-MCP-REPOINT): `quality_score` / `previous_quality_score` had
  // no typed home after the content_items → OKF split (BI-11/20 — quality
  // score is derived, never materialised on source_documents or the
  // record_lifecycle facet). The below-threshold and score-drop briefing
  // legs are RETIRED rather than re-pointed — there is no column left to
  // read them from. Both legs return permanently empty arrays; they stay in
  // the `QualityBriefingData` contract (below_threshold/score_drops keys)
  // so existing callers keep compiling and the resource/tool envelope shape
  // is unchanged, but they no longer carry data. `options.threshold` is
  // consequently a no-op now (kept on the type for caller back-compat).
  type BelowThresholdItemType =
    import('@/lib/mcp/formatters/briefing').BelowThresholdItem;
  type ScoreDropItemType =
    import('@/lib/mcp/formatters/briefing').ScoreDropItem;
  const belowThresholdLimited: BelowThresholdItemType[] = [];
  const scoreDropsLimited: ScoreDropItemType[] = [];

  // Freshness transitions — `freshness` / `previous_freshness` now live on
  // the `record_lifecycle` facet (source_document-only axis, BI-20/22), not
  // on the eliminated `content_items` row. Two-step fetch (facet rows, then
  // the owning source_documents for title/domain/archived context) rather
  // than a PostgREST embed, matching this file's other re-pointed helpers.
  // `sb()` (fail-fast) rather than a bare destructure — a facet-read failure
  // here should surface as an error, not silently degrade to "no
  // transitions" (per CLAUDE.md `local/no-unchecked-supabase-error`).
  const lifecycleRows = await sb(
    supabase
      .from('record_lifecycle')
      .select('source_document_id, freshness, previous_freshness')
      .eq('owner_kind', 'source_document')
      .not('previous_freshness', 'is', null)
      .limit(100),
    'mcp.shared.quality_briefing.freshness_facet',
  );

  const freshnessSdIds = (
    lifecycleRows as Array<{
      source_document_id: string | null;
      freshness: string | null;
      previous_freshness: string | null;
    }>
  )
    .map((row) => row.source_document_id)
    .filter((id): id is string => !!id);

  let freshnessSourceDocuments: Array<{
    id: string;
    suggested_title: string | null;
    primary_domain: string | null;
    archived_at: string | null;
  }> = [];
  if (freshnessSdIds.length > 0) {
    let freshnessSdQuery = supabase
      .from('source_documents')
      .select('id, suggested_title, primary_domain, archived_at')
      .in('id', freshnessSdIds);
    if (domainFilter) {
      freshnessSdQuery = freshnessSdQuery.eq('primary_domain', domainFilter);
    }
    freshnessSourceDocuments = (await sb(
      freshnessSdQuery,
      'mcp.shared.quality_briefing.freshness_source_documents',
    )) as typeof freshnessSourceDocuments;
  }

  // Run the remaining queries in parallel.
  const [qualityFlagsResult, coverageAlertsResult, certResult] =
    await Promise.all([
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
    ]);

  // Process freshness transitions — filter to actual changes, joining the
  // facet rows to their (possibly domain-filtered, non-archived) owner.
  type FreshnessTransitionItemType =
    import('@/lib/mcp/formatters/briefing').FreshnessTransitionItem;
  const sourceDocumentById = new Map<
    string,
    { suggested_title: string | null; primary_domain: string | null }
  >();
  for (const sd of freshnessSourceDocuments) {
    if (sd.archived_at) continue;
    sourceDocumentById.set(sd.id, {
      suggested_title: sd.suggested_title,
      primary_domain: sd.primary_domain,
    });
  }

  const freshnessTransitions: FreshnessTransitionItemType[] = [];
  for (const row of lifecycleRows as Array<{
    source_document_id: string | null;
    freshness: string | null;
    previous_freshness: string | null;
  }>) {
    if (!row.source_document_id) continue;
    const owner = sourceDocumentById.get(row.source_document_id);
    if (!owner) continue; // archived or domain-filtered out
    if (row.freshness !== row.previous_freshness) {
      freshnessTransitions.push({
        id: row.source_document_id,
        // ID-131 content-drift: content_items.title had no source_documents
        // successor (BI-11) — suggested_title is the sole display name now.
        title: null,
        suggested_title: owner.suggested_title,
        primary_domain: owner.primary_domain,
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
