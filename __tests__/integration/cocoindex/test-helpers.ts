/**
 * Stage-5 entity-resolution integration-test helpers (Subtask ID-53.14).
 *
 * Shared utilities for the 16 Stage-5 invariant integration tests
 * (`__tests__/integration/cocoindex/*.integration.test.ts`). These build on
 * the ID-49.10 fixture-staging helper layer (`_helpers/fixture-staging.ts`)
 * which owns the file-drop → poll-source_documents → drop lifecycle (see its
 * ID-131.19 M6 retarget note); this module adds the `entity_mentions`-facing
 * analogues the Stage-5 invariants need:
 *
 *   - `pollEntityMentionsFor(...)` — analogue of `pollContentItemsFor` that
 *     polls `entity_mentions` by op_id, source_document id(s), OR a
 *     title-prefix → source_documents → entity_mentions join, until at least
 *     one row lands (or the deadline is reached).
 *   - `assertOpIdRoundTrip(...)` — given an `entity_mentions.op_id`, asserts
 *     `pipeline_runs WHERE op_id = <value>` returns exactly one row (Inv-6).
 *   - `seedAliasMap(...)` / `cleanupAliasMap(...)` — INSERT active rows into
 *     `entity_aliases` and remove them in cleanup (Inv-10 preload).
 *   - `injectStage5Failure(...)` — config-only Stage-5 failure injection
 *     (Inv-12/13) that produces a REAL exception from inside the resolution
 *     stack WITHOUT any production-code hook. See the dedicated docblock on
 *     that function for the chosen mechanism + observed exception classes.
 *
 * Env-gate: every caller MUST compute the canonical
 * `ENABLED = HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING &&
 * HAS_LIVE_DB` gate (per the ID-49.10 ratified pattern) and wrap its suite in
 * `describe.skipIf(!ENABLED)`. The helpers here throw fast on missing live-DB
 * credentials to surface mis-wiring.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-9 (op_id round-trip),
 *     §P-10 (failure-mode wiring), §P-11 (coexistence), §P-14 (corner cases).
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-6, Inv-10,
 *     Inv-12, Inv-13.
 *   - __tests__/integration/cocoindex/_helpers/fixture-staging.ts (ID-49.10
 *     fixture-staging helper this module composes with).
 *   - scripts/cocoindex_pipeline/stage_5.py / entity_embedder.py /
 *     pair_resolver.py (the resolution stack the failure injection targets).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { expect } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import {
  stageFixture,
  type StageFixtureResult,
} from './_helpers/fixture-staging';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** RFC 4122 v4 UUID matcher — kept in step with the fixture-staging helper. */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The canonical `pipeline_runs.pipeline_name` the cocoindex sidecar stamps on
 * every emission. Centralised here (ID-55.3) as the single TS-side source of
 * truth for the cocoindex integration suite, mirroring the producer constant
 * `KH_CANONICAL_PIPELINE_NAME` in `scripts/cocoindex_pipeline/flow.py`. Import
 * this instead of hardcoding the literal so a pipeline rename surfaces as one
 * edit, not a silent cross-file divergence.
 */
export const KH_CANONICAL_PIPELINE_NAME = 'kh_canonical_pipeline';

/** Default poll ceiling — matches POLL_TIMEOUT_MS used across the suite. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Default poll interval. */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// pollEntityMentionsFor
// ---------------------------------------------------------------------------

/**
 * The narrow `entity_mentions` projection the Stage-5 invariant tests assert
 * on. Selected columns are intentionally limited to the invariant-relevant
 * surface (op_id scope, canonical_name freshness, metadata source spans,
 * context_snippet population, confidence reconciliation).
 */
export interface PolledEntityMentionRow {
  id: string;
  source_document_id: string;
  op_id: string | null;
  canonical_name: string;
  entity_name: string;
  entity_type: string;
  confidence: number | null;
  context_snippet: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PollEntityMentionsOpts {
  /** Match rows whose `op_id` equals this value (Inv-5 scope). */
  opId?: string;
  /**
   * Match rows whose `source_document_id` is in this set. Values are
   * `source_documents.id` (matching `pollContentItemsFor`'s return shape —
   * ID-131.19 M6 retarget; `entity_mentions.source_document_id` is a direct
   * FK to `source_documents`, not the dropped `content_items` table).
   */
  contentItemIds?: string[];
  /**
   * Match rows whose owning `source_documents.filename ILIKE
   * '${titlePrefix}%'`. Resolved via a single query (source_documents →
   * entity_mentions) — `entity_mentions` carries no title column itself.
   * ID-131.19 M6 retarget: this used to route through `content_items.title`
   * (dropped); `source_documents.filename` is the direct equivalent (see
   * `_helpers/fixture-staging.ts`'s `pollContentItemsFor` retarget note).
   */
  titlePrefix?: string;
  /** Maximum wait for at least one row, ms. Default 120_000. */
  timeoutMs?: number;
  /** Interval between poll attempts, ms. Default 2_000. */
  pollIntervalMs?: number;
  /**
   * Minimum number of rows to wait for before resolving. Default 1. Tests
   * that need the full per-document mention set (e.g. cross-document dedup
   * across two docs) can raise this to avoid racing the second document's
   * write.
   */
  minRows?: number;
}

const ENTITY_MENTION_COLUMNS =
  'id, source_document_id, op_id, canonical_name, entity_name, entity_type, confidence, context_snippet, metadata';

/**
 * Poll `entity_mentions` via the live service-role client until at least
 * `minRows` rows matching the supplied scope land, or the deadline is reached.
 *
 * At least one of `opId`, `contentItemIds`, or `titlePrefix` MUST be supplied
 * — an unscoped poll would race the entire table and is rejected.
 *
 * Throws when live-DB credentials are not real (callers must env-gate via
 * `hasRealLiveDbCredentials()` first), and rejects on timeout.
 */
export async function pollEntityMentionsFor(
  opts: PollEntityMentionsOpts,
): Promise<PolledEntityMentionRow[]> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'pollEntityMentionsFor: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }

  if (!opts.opId && !opts.contentItemIds && !opts.titlePrefix) {
    throw new Error(
      'pollEntityMentionsFor: supply at least one of opId / contentItemIds / titlePrefix — an unscoped poll is rejected.',
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const minRows = opts.minRows ?? 1;

  const client = await createLiveServiceClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Resolve the source_documents id scope first when only a titlePrefix is
    // given (entity_mentions has no title/filename column of its own).
    // ID-131.19 M6 retarget: this used to be a two-step content_items ->
    // source_document_id resolution (content_items dropped at M6);
    // source_documents already carries both the filename to ILIKE-match AND
    // the id entity_mentions.source_document_id references directly, so one
    // lookup now suffices.
    let sourceDocumentIds = opts.contentItemIds;
    if (!opts.opId && !sourceDocumentIds && opts.titlePrefix) {
      const { data: docs, error: docsErr } = await client
        .from('source_documents')
        .select('id')
        .ilike('filename', `${opts.titlePrefix}%`);
      if (docsErr) {
        throw new Error(
          `pollEntityMentionsFor: source_documents filename lookup failed — ${docsErr.message ?? String(docsErr)}`,
        );
      }
      sourceDocumentIds = (docs ?? []).map((r) => r.id as string);
      // No source_documents yet → nothing to poll this cycle.
      if (sourceDocumentIds.length === 0) {
        await sleep(pollIntervalMs);
        continue;
      }
    }

    let query = client.from('entity_mentions').select(ENTITY_MENTION_COLUMNS);
    if (opts.opId) {
      query = query.eq('op_id', opts.opId);
    } else if (sourceDocumentIds && sourceDocumentIds.length > 0) {
      query = query.in('source_document_id', sourceDocumentIds);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(
        `pollEntityMentionsFor: query failed — ${error.message ?? String(error)}`,
      );
    }

    if (data && data.length >= minRows) {
      return data.map(toPolledEntityMentionRow);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `pollEntityMentionsFor: timed out after ${timeoutMs}ms waiting for >= ${minRows} entity_mentions row(s) (scope: ${JSON.stringify(
      {
        opId: opts.opId,
        contentItemIds: opts.contentItemIds,
        titlePrefix: opts.titlePrefix,
      },
    )})`,
  );
}

function toPolledEntityMentionRow(
  r: Record<string, unknown>,
): PolledEntityMentionRow {
  return {
    id: r.id as string,
    source_document_id: r.source_document_id as string,
    op_id: (r.op_id as string | null) ?? null,
    canonical_name: r.canonical_name as string,
    entity_name: r.entity_name as string,
    entity_type: r.entity_type as string,
    confidence: (r.confidence as number | null) ?? null,
    context_snippet: (r.context_snippet as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// assertOpIdRoundTrip
// ---------------------------------------------------------------------------

/**
 * Inv-6 round-trip assertion: given an `entity_mentions.op_id`, assert
 * `SELECT * FROM pipeline_runs WHERE op_id = <value>` returns EXACTLY one row,
 * and return that row's id for downstream cleanup.
 *
 * Zero rows proves the op_id does not round-trip (audit-forensics break);
 * more than one proves a duplicate pipeline_runs row (Inv-6 break). The op_id
 * must also be a valid v4 UUID — a malformed value is itself an Inv-6 break.
 *
 * Throws when live-DB credentials are not real (callers must env-gate).
 */
export async function assertOpIdRoundTrip(opId: string): Promise<string> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'assertOpIdRoundTrip: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }

  // op_id must be a valid v4 UUID — a NULL or malformed value is an Inv-6 break.
  expect(opId).toMatch(UUID_V4_REGEX);

  const client = await createLiveServiceClient();
  const { data: runs, error } = await client
    .from('pipeline_runs')
    .select('id, op_id, status, started_at, completed_at, result')
    .eq('op_id', opId);

  if (error) {
    throw new Error(
      `assertOpIdRoundTrip: pipeline_runs query failed — ${error.message ?? String(error)}`,
    );
  }

  // Inv-6: exactly one originating pipeline_runs row.
  expect(runs).not.toBeNull();
  expect(runs!.length).toBe(1);

  const run = runs![0]!;
  expect(run.op_id).toBe(opId);
  expect(run.started_at).not.toBeNull();

  return run.id as string;
}

/**
 * Read `pipeline_runs.result.stage_counts.entity_resolution` for a given op_id.
 * Returns `undefined` when the run row, the `result` JSONB, the `stage_counts`
 * dict, or the `entity_resolution` key is absent — callers distinguish
 * "counter present and zero" (`0`) from "counter absent" (`undefined`).
 */
export async function readEntityResolutionStageCount(
  opId: string,
): Promise<number | undefined> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'readEntityResolutionStageCount: live DB credentials are not real (or absent). Gate the caller first.',
    );
  }
  const client = await createLiveServiceClient();
  const { data: run, error } = await client
    .from('pipeline_runs')
    .select('result')
    .eq('op_id', opId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `readEntityResolutionStageCount: query failed — ${error.message ?? String(error)}`,
    );
  }
  const result = (run?.result as Record<string, unknown> | null) ?? null;
  const stageCounts =
    (result?.stage_counts as Record<string, unknown> | undefined) ?? undefined;
  const value = stageCounts?.entity_resolution;
  return typeof value === 'number' ? value : undefined;
}

/**
 * Read `pipeline_runs.result.stage_counts.<stage>` for a given op_id — the
 * generic analogue of `readEntityResolutionStageCount`. Returns `undefined`
 * when the run row, the `result` JSONB, the `stage_counts` dict, or the named
 * stage key is absent, so callers can distinguish "counter present and zero"
 * (`0`) from "counter absent" (`undefined`). Used by the ID-56.9 chunking-stage
 * rollup assertion to verify the `chunking` counter is elevated into the
 * pipeline_runs rollup (Inv-11, mirrors the {53.14} entity_resolution wire).
 */
export async function readStageCount(
  opId: string,
  stage: string,
): Promise<number | undefined> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'readStageCount: live DB credentials are not real (or absent). Gate the caller first.',
    );
  }
  const client = await createLiveServiceClient();
  const { data: run, error } = await client
    .from('pipeline_runs')
    .select('result')
    .eq('op_id', opId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `readStageCount: query failed — ${error.message ?? String(error)}`,
    );
  }
  const result = (run?.result as Record<string, unknown> | null) ?? null;
  const stageCounts =
    (result?.stage_counts as Record<string, unknown> | undefined) ?? undefined;
  const value = stageCounts?.[stage];
  return typeof value === 'number' ? value : undefined;
}

// ---------------------------------------------------------------------------
// pollPipelineRunCompleted
// ---------------------------------------------------------------------------

/** The narrow `pipeline_runs` projection the completion-gate poll returns. */
export interface PolledPipelineRunRow {
  id: string;
  op_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown> | null;
}

export interface PollPipelineRunOpts {
  /** Maximum wait, ms, for the run to reach a terminal status. Default 180_000. */
  timeoutMs?: number;
  /** Interval between poll attempts, ms. Default 2_000. */
  pollIntervalMs?: number;
}

/**
 * Poll `pipeline_runs WHERE op_id = <opId>` until the row reaches
 * `status='completed'`, or the deadline is reached. This is the C-54 /
 * Stage-5 Inv-3 read-contract gate: `entity_mentions.canonical_name` is only
 * authoritative AFTER the producing run completes (TECH §2.6 row C-54;
 * Stage-5 PRODUCT Inv-3 "canonical_name freshness on successful run").
 *
 * Rejects (rather than silently resolving) when the run terminates in any
 * NON-completed terminal status (`failed`/`cancelled`/...): a non-completed
 * run cannot satisfy the post-completion read contract, so the caller's
 * assertions would be meaningless. Throws when live-DB credentials are not
 * real (callers MUST env-gate first) and rejects on timeout.
 */
export async function pollPipelineRunCompleted(
  opId: string,
  opts: PollPipelineRunOpts = {},
): Promise<PolledPipelineRunRow> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'pollPipelineRunCompleted: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }
  expect(opId).toMatch(UUID_V4_REGEX);

  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const client = await createLiveServiceClient();
  const deadline = Date.now() + timeoutMs;

  // Terminal NON-completed statuses that mean the run can never satisfy the
  // post-completion read contract — surface them rather than poll to timeout.
  const TERMINAL_NON_COMPLETED = new Set(['failed', 'cancelled', 'canceled']);

  while (Date.now() < deadline) {
    const { data: run, error } = await client
      .from('pipeline_runs')
      .select('id, op_id, status, started_at, completed_at, result')
      .eq('op_id', opId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `pollPipelineRunCompleted: query failed — ${error.message ?? String(error)}`,
      );
    }
    if (run) {
      const status = run.status as string;
      if (status === 'completed') {
        return {
          id: run.id as string,
          op_id: run.op_id as string,
          status,
          started_at: (run.started_at as string | null) ?? null,
          completed_at: (run.completed_at as string | null) ?? null,
          result: (run.result as Record<string, unknown> | null) ?? null,
        };
      }
      if (TERMINAL_NON_COMPLETED.has(status)) {
        throw new Error(
          `pollPipelineRunCompleted: run for op_id ${opId} reached terminal NON-completed status '${status}' — cannot satisfy the post-completion read contract.`,
        );
      }
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `pollPipelineRunCompleted: timed out after ${timeoutMs}ms waiting for pipeline_runs.status='completed' for op_id ${opId}`,
  );
}

// ---------------------------------------------------------------------------
// seedAliasMap / cleanupAliasMap
// ---------------------------------------------------------------------------

export interface AliasSeed {
  /** The non-canonical surface form (the per-doc canonical the run produces). */
  alias: string;
  /** The canonical the alias resolves to (what Stage-5 should write). */
  canonical: string;
  /**
   * Provenance label. Defaults to a test-scoped marker so cleanup can locate
   * the seeded rows even if the caller loses the returned ids.
   */
  provenance?: string;
}

export interface SeededAlias {
  id: string;
  alias: string;
  canonical: string;
}

/**
 * INSERT one or more active rows into `entity_aliases` (Inv-10 legacy-alias
 * preload). Rows are inserted with `is_active = true` so Stage-5's
 * `_preload_entity_aliases` (`WHERE is_active = true`) picks them up.
 *
 * Returns the inserted rows (with ids) so the caller can assert + clean up.
 * The `provenance` defaults to a test marker; callers SHOULD pass a
 * test-unique provenance so concurrent suites do not collide.
 *
 * Throws when live-DB credentials are not real (callers must env-gate).
 */
export async function seedAliasMap(seeds: AliasSeed[]): Promise<SeededAlias[]> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'seedAliasMap: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }
  if (seeds.length === 0) return [];

  const client = await createLiveServiceClient();
  const rows = seeds.map((s) => ({
    alias: s.alias,
    canonical: s.canonical,
    is_active: true,
    provenance: s.provenance ?? 'id-53.14-test-seed',
  }));

  const { data, error } = await client
    .from('entity_aliases')
    .insert(rows)
    .select('id, alias, canonical');

  if (error) {
    throw new Error(
      `seedAliasMap: insert failed — ${error.message ?? String(error)}`,
    );
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    alias: r.alias as string,
    canonical: r.canonical as string,
  }));
}

/**
 * Remove seeded `entity_aliases` rows by id (best-effort cleanup). Refuses to
 * run with an empty id set (defensive scoping guard). Errors are logged and
 * swallowed so a partial cleanup does not block teardown.
 */
export async function cleanupAliasMap(aliasIds: string[]): Promise<void> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'cleanupAliasMap: live DB credentials are not real (or absent). Gate the caller first.',
    );
  }
  if (aliasIds.length === 0) return;

  const client = await createLiveServiceClient();
  const { error } = await client
    .from('entity_aliases')
    .delete()
    .in('id', aliasIds);
  if (error) {
    console.warn(
      `cleanupAliasMap: cleanup warning — ${error.message ?? String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// injectStage5Failure
// ---------------------------------------------------------------------------

/**
 * Stage a fixture whose pipeline run is configured to fail DURING the Stage-5
 * resolution pass — WITHOUT any production-code hook (Inv-12 / Inv-13).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CHOSEN MECHANISM (config-only — no prod-code change to stage_5.py/flow.py)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Stage-5's resolution stack makes two outbound model calls, BOTH of which
 * read their credentials from the process environment at call time:
 *
 *   1. `KhEntityEmbedder.embed()` (scripts/cocoindex_pipeline/entity_embedder.py)
 *      wraps cocoindex's `LiteLLMEmbedder("text-embedding-3-large")`. It fires
 *      FIRST, for every distinct entity name in the run (so any run that
 *      produced >= 1 entity_mentions row reaches it). With the embedding
 *      provider key absent / invalid, `LiteLLMEmbedder.embed()` raises
 *      `litellm.exceptions.AuthenticationError` from INSIDE
 *      `cocoindex.ops.entity_resolution.resolve_entities`, which propagates up
 *      through `_run_stage_5_resolution` to flow.py's outer `except` (the §P-10
 *      failure routing). This is the PRIMARY chosen mechanism: earliest-firing,
 *      deterministic, requires only a corpus with >= 1 entity mention.
 *
 *   2. `KhPairResolver._invoke_llm()` (scripts/cocoindex_pipeline/pair_resolver.py)
 *      constructs `anthropic.AsyncAnthropic()` and calls `messages.create`.
 *      With `ANTHROPIC_API_KEY` absent / invalid it raises
 *      `anthropic.AuthenticationError`. Per `_anthropic_retry`'s
 *      `_RETRYABLE_ANTHROPIC_EXCEPTIONS` set, auth errors are NOT retried
 *      (they "propagate immediately" per the helper docstring), so NO
 *      `tenacity.RetryError` wrapping occurs — the bare
 *      `anthropic.AuthenticationError` surfaces. This fires only when a
 *      near-match forces a pair decision (cache miss), so it is the SECONDARY
 *      mechanism (used when a test needs a PairResolver-stack failure
 *      specifically).
 *
 * The staging service performs the failure injection by running the staged
 * fixture's pipeline with the requested credential(s) cleared for that run
 * (`failMode: 'embedder'` clears the embedding provider key; `failMode:
 * 'pair_resolver'` clears `ANTHROPIC_API_KEY`). The request body extends the
 * standard stageFixture contract with a `failStage5` directive; a staging
 * service that does not understand the directive returns a 4xx and the test's
 * env-gate skip-clean masks it (the directive only fires when the suite is
 * ENABLED, i.e. the fixture-staging service is wired).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * OBSERVED / EXPECTED EXCEPTION CLASSES (input for Subtask {53.15})
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   - `failMode: 'embedder'`      → `litellm.exceptions.AuthenticationError`
 *       MRO: AuthenticationError → APIStatusError → APIError → OpenAIError →
 *       Exception. It is NOT an anthropic type, NOT asyncpg.PostgresError, NOT
 *       pydantic.ValidationError, NOT docling.* — so the CURRENT
 *       `_classify_stage_exception` (flow.py:188) returns `None` and the run
 *       routes through the `unclassified` fallback. {53.15} should add an
 *       `entity_resolution_failed` branch keyed on the litellm /
 *       entity_embedder module prefix.
 *
 *   - `failMode: 'pair_resolver'` → `anthropic.AuthenticationError`
 *       MRO: AuthenticationError → APIStatusError → APIError → AnthropicError →
 *       Exception. Because it is an `anthropic.APIStatusError` subclass, the
 *       CURRENT `_classify_stage_exception` MISCLASSIFIES it as
 *       `extraction_provider_unavailable` (the anthropic.APIStatusError branch).
 *       {53.15} must order/guard a Stage-5-specific branch so a PairResolver
 *       auth failure classifies as `entity_resolution_failed`, not as the
 *       Stage-2 extraction class.
 *
 * Inv-12/13 acceptance therefore asserts errorClass TOLERANTLY (accepting
 * either the eventual `entity_resolution_failed` once {53.15} lands, OR the
 * current fallback/misclassification) — the LOAD-BEARING assertions are
 * non-destructiveness (per-item rows survive with their per-doc canonical and
 * op_id) + status='failed' + stageCounts.entity_resolution present.
 */
export type Stage5FailMode = 'embedder' | 'pair_resolver';

export interface InjectStage5FailureArgs {
  /** Source fixture path (same contract as stageFixture). */
  fixturePath: string;
  /** Destination path relative to the corpus root (must include extension). */
  destPath: string;
  /** Title prefix the test polls for. */
  titlePrefix: string;
  /**
   * Which Stage-5 model call to fail. Default 'embedder' (earliest-firing,
   * deterministic). 'pair_resolver' fails the Anthropic pair-decision call.
   */
  failMode?: Stage5FailMode;
}

/**
 * The exception class names the staging service is expected to surface for
 * each failMode — exported so {53.15} (and the Inv-12/13 test) can reference
 * the contract without re-deriving it from the prose above.
 */
export const STAGE5_FAILURE_EXCEPTION_CLASSES: Record<
  Stage5FailMode,
  { className: string; module: string; currentClassification: string }
> = {
  embedder: {
    className: 'AuthenticationError',
    module: 'litellm.exceptions',
    currentClassification: 'unclassified (None → fallback)',
  },
  pair_resolver: {
    className: 'AuthenticationError',
    module: 'anthropic',
    currentClassification: 'extraction_provider_unavailable (misclassified)',
  },
};

/**
 * Stage a fixture configured to fail inside the Stage-5 resolution pass.
 * Delegates to `stageFixture` with an extended request directive; the staging
 * service clears the relevant credential for that run only. Returns the
 * stageFixture result (destPath + requestId).
 *
 * The function itself adds no prod-code hook — the failure arises naturally
 * from the credential-cleared model call inside the unmodified resolution
 * stack. See the function-family docblock above for the full rationale.
 */
export async function injectStage5Failure(
  args: InjectStage5FailureArgs,
): Promise<StageFixtureResult> {
  const failMode: Stage5FailMode = args.failMode ?? 'embedder';
  // The failMode directive is carried on the `destPath` as a query-style
  // suffix (`?failStage5=<mode>`) — the fixture-staging service strips it
  // before writing the file and uses it to clear the relevant credential for
  // that run only. This keeps `injectStage5Failure` within the existing
  // 3-field `stageFixture` contract (no excess properties, no prod-code hook).
  // A staging service that does not understand the suffix 4xxs, and the
  // env-gate skip masks it (only ENABLED suites reach this call).
  return stageFixture({
    fixturePath: args.fixturePath,
    destPath: `${args.destPath}?failStage5=${failMode}`,
    titlePrefix: args.titlePrefix,
  });
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
