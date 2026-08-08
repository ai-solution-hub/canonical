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
 *   - `injectStage5Failure(...)` — credential-scoped Stage-5 failure injection
 *     (Inv-12/13) that produces a REAL exception from inside an UNMODIFIED
 *     resolution stack. The injection is honoured by the `/stage` + `/walk`
 *     directive plumbing in `server.py` (id-414 AC-6); stage_5.py, flow.py,
 *     entity_embedder.py and pair_resolver.py carry no test hook. See the
 *     dedicated docblock on that function for the mechanism, the blast
 *     radius, and the observed exception classes.
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

  // id-415 AC-6/7. A bare timeout message is what made the S538 mention-drop
  // UNDECIDABLE: by the time anyone could look, `afterAll` had run `dropFixture`
  // and the evidence was gone. Capture it HERE, inside the deadline, while the
  // rows (or their absence) are still exactly as the pipeline left them.
  const forensics = await captureEntityMentionForensics(client, opts, deadline);

  throw new Error(
    `pollEntityMentionsFor: timed out after ${timeoutMs}ms waiting for >= ${minRows} entity_mentions row(s) (scope: ${JSON.stringify(
      {
        opId: opts.opId,
        contentItemIds: opts.contentItemIds,
        titlePrefix: opts.titlePrefix,
      },
    )})\n${forensics}`,
  );
}

/**
 * Snapshot the state a timed-out `pollEntityMentionsFor` was looking at, so the
 * failure carries its own evidence instead of needing a bespoke re-run.
 *
 * It answers the four questions that separate the candidate causes, and it is
 * deliberately scope-WIDENING — the poll's own scope is the thing under
 * suspicion, so re-asking the same question adds nothing:
 *
 *   1. `entity_mentions` for the documents, ignoring op_id — distinguishes
 *      "rows exist but carry a different op_id" (a re-stamp) from "no rows"
 *      (a drop, or an ingest that never produced any).
 *   2. `source_documents` — does the row still exist, and under which
 *      `logical_path`/`filename`? A content_hash-first resolve
 *      (`resolve_or_mint_source_identity`, id-138) rewrites `logical_path`
 *      only, so a prefix-keyed poll misses a row that is present and healthy.
 *   3. `content_chunks` counts — separates "this item never ingested" from
 *      "this item ingested but produced no entities", which have different
 *      causes and different owners.
 *   4. `pipeline_runs` covering the poll window — which walks actually ran,
 *      and did any reach a terminal error.
 *
 * Never throws: a diagnostic that can mask the failure it describes is worse
 * than none. Every probe degrades to a noted error line.
 */
async function captureEntityMentionForensics(
  client: Awaited<ReturnType<typeof createLiveServiceClient>>,
  opts: PollEntityMentionsOpts,
  deadline: number,
): Promise<string> {
  const lines: string[] = [
    '--- id-415 forensics (captured before teardown) ---',
  ];
  const note = (label: string, err: unknown): void => {
    lines.push(`  ${label}: PROBE FAILED — ${String(err)}`);
  };

  try {
    // Resolve the document scope independently of the poll's own key.
    let docIds: string[] = opts.contentItemIds ?? [];
    if (docIds.length === 0 && opts.titlePrefix) {
      const { data } = await client
        .from('source_documents')
        .select('id')
        .ilike('filename', `${opts.titlePrefix}%`);
      docIds = (data ?? []).map((r) => r.id as string);
    }
    if (docIds.length === 0 && opts.opId) {
      const { data } = await client
        .from('entity_mentions')
        .select('source_document_id')
        .eq('op_id', opts.opId);
      docIds = [
        ...new Set((data ?? []).map((r) => r.source_document_id as string)),
      ];
    }
    lines.push(`  resolved source_document_ids: ${JSON.stringify(docIds)}`);

    if (docIds.length > 0) {
      // (1) mentions regardless of op_id — re-stamp vs drop.
      try {
        const { data } = await client
          .from('entity_mentions')
          .select('id, source_document_id, op_id, canonical_name, entity_type')
          .in('source_document_id', docIds);
        lines.push(
          `  entity_mentions for those documents, ANY op_id: ${data?.length ?? 0} row(s)` +
            (data && data.length > 0 ? ` — ${JSON.stringify(data)}` : ''),
        );
      } catch (err) {
        note('entity_mentions (any op_id)', err);
      }

      // (2) do the documents still exist, and where do they point?
      try {
        const { data } = await client
          .from('source_documents')
          .select('id, filename, logical_path, storage_path, op_id, created_at')
          .in('id', docIds);
        lines.push(
          `  source_documents: ${data?.length ?? 0} row(s) — ${JSON.stringify(data ?? [])}`,
        );
      } catch (err) {
        note('source_documents', err);
      }

      // (3) did the items ingest at all?
      try {
        const { data } = await client
          .from('content_chunks')
          .select('source_document_id')
          .in('source_document_id', docIds);
        const perDoc = new Map<string, number>();
        for (const row of data ?? []) {
          const key = row.source_document_id as string;
          perDoc.set(key, (perDoc.get(key) ?? 0) + 1);
        }
        lines.push(
          `  content_chunks per source_document: ${JSON.stringify(Object.fromEntries(perDoc))}`,
        );
      } catch (err) {
        note('content_chunks', err);
      }
    }

    // (4) which walks covered the poll window?
    try {
      const windowStart = new Date(deadline - 15 * 60_000).toISOString();
      const { data } = await client
        .from('pipeline_runs')
        .select('op_id, status, started_at, completed_at, result')
        .gte('started_at', windowStart)
        .order('started_at', { ascending: true });
      lines.push(
        `  pipeline_runs since ${windowStart}: ${(data ?? [])
          .map((r) => `${r.op_id}=${r.status}`)
          .join(', ')}`,
      );
    } catch (err) {
      note('pipeline_runs', err);
    }
  } catch (err) {
    note('forensics', err);
  }

  return lines.join('\n');
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
 * id-400 (NM-5): the terminal statuses a run-read may filter on. The
 * status-BLIND read shape is RETIRED (HARNESS §3) — a status-free
 * `.eq('op_id', …).maybeSingle()` resolves the `in_progress` row whose
 * stage_counts is all zeros (census #41 failure #3's mechanism), so every
 * stage-count read now declares which terminal state it binds to.
 * Vocabulary note ([SV]): the enum is
 * `in_progress | completed | completed_with_errors | failed` — there is no
 * `'succeeded'` (the census #15/#18 dead filter).
 */
export type PipelineRunReadStatus =
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

/**
 * The terminal statuses under which a walk RAN THE STAGES — the default filter
 * for every stage-count read.
 *
 * NM-5 forbids the status-BLIND read because it resolves the `in_progress` row
 * whose `stage_counts` is all zeros. It does not say "filter on `completed`",
 * and the difference cost id-415 a nightly. Once id-414 made a walk with
 * contained per-item drops resolve to `completed_with_errors`, a
 * `completed`-only filter started missing runs that had executed every stage —
 * `stage-5-attach-point` (Inv-1) failed exactly this way in run 31271744240,
 * and its own diagnostic said so: *"row(s) exist but carry status
 * ["completed_with_errors"], not 'completed' (cause 2 — the status filter, not
 * the stage)"*.
 *
 * `failed` is deliberately absent: a failed run may have stopped before the
 * stage, so its counters are not evidence the stage ran. A caller asserting
 * about a failed run passes `'failed'` explicitly and means it.
 */
export const TERMINAL_STAGES_RAN: readonly PipelineRunReadStatus[] = [
  'completed',
  'completed_with_errors',
];

/** Normalise the status argument, preserving "one status" callers unchanged. */
function statusList(
  status: PipelineRunReadStatus | readonly PipelineRunReadStatus[],
): PipelineRunReadStatus[] {
  return Array.isArray(status)
    ? [...status]
    : [status as PipelineRunReadStatus];
}

/**
 * Read `pipeline_runs.result.stage_counts.entity_resolution` for a given
 * op_id, STATUS-FILTERED (id-400 NM-5 — default `'completed'`). Returns
 * `undefined` when no row with that op_id+status exists (e.g. the run is
 * still `in_progress`), when the `result` JSONB / `stage_counts` dict is
 * absent, or when the `entity_resolution` key is absent — callers distinguish
 * "counter present and zero" (`0`) from "counter absent" (`undefined`).
 */
export async function readEntityResolutionStageCount(
  opId: string,
  status:
    | PipelineRunReadStatus
    | readonly PipelineRunReadStatus[] = TERMINAL_STAGES_RAN,
): Promise<number | undefined> {
  return readStageCount(opId, 'entity_resolution', status);
}

/**
 * Read `pipeline_runs.result.stage_counts.<stage>` for a given op_id,
 * STATUS-FILTERED (id-400 NM-5 — default `'completed'`; the status-blind
 * shape is retired). Returns `undefined` when no row with that op_id+status
 * exists, when the `result` JSONB / `stage_counts` dict is absent, or when
 * the named stage key is absent, so callers can distinguish "counter present
 * and zero" (`0`) from "counter absent / run not terminal" (`undefined`).
 * Used by the ID-56.9 chunking-stage rollup assertion (Inv-11).
 */
export async function readStageCount(
  opId: string,
  stage: string,
  status:
    | PipelineRunReadStatus
    | readonly PipelineRunReadStatus[] = TERMINAL_STAGES_RAN,
): Promise<number | undefined> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'readStageCount: live DB credentials are not real (or absent). Gate the caller first.',
    );
  }
  const wanted = statusList(status);
  const client = await createLiveServiceClient();
  // `.in(...)` rather than `.eq(...)`, and no `.maybeSingle()`: accepting more
  // than one terminal status means the query can legitimately match more than
  // one row, and `maybeSingle()` would turn that into a query ERROR rather than
  // a result. Pick deterministically instead — earliest wanted status wins, so
  // a `completed` row is preferred over a `completed_with_errors` one.
  const { data: rows, error } = await client
    .from('pipeline_runs')
    .select('status, result')
    .eq('op_id', opId)
    .in('status', wanted);
  if (error) {
    throw new Error(
      `readStageCount: query failed — ${error.message ?? String(error)}`,
    );
  }
  const run =
    wanted
      .map((s) => (rows ?? []).find((r) => r.status === s))
      .find((r) => r !== undefined) ?? null;
  const result = (run?.result as Record<string, unknown> | null) ?? null;
  const stageCounts =
    (result?.stage_counts as Record<string, unknown> | undefined) ?? undefined;
  const value = stageCounts?.[stage];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Explain, in one line, WHY `readStageCount` returned `undefined`.
 *
 * `undefined` conflates four different failures, and a caller asserting
 * `expect(count).toBeDefined()` reports the least useful of all possible
 * messages — "expected undefined to be defined" — which is how the id-415
 * attach-point failure arrived with no cause attached. The four are:
 *
 *   1. no `pipeline_runs` row for that op_id at all;
 *   2. a row exists but under a DIFFERENT terminal status — most often
 *      `completed_with_errors`, which a status-filtered read silently misses
 *      even though the walk ran and the stage executed;
 *   3. the row's `result` JSONB or its `stage_counts` dict is absent;
 *   4. `stage_counts` is present but carries no key for this stage — the only
 *      one of the four that actually means "the stage did not run".
 *
 * Pass the result as the assertion message so the distinction survives into CI
 * output. Never throws: a diagnostic that can mask its subject is worse than
 * none.
 */
export async function explainMissingStageCount(
  opId: string,
  stage: string,
  status:
    | PipelineRunReadStatus
    | readonly PipelineRunReadStatus[] = TERMINAL_STAGES_RAN,
): Promise<string> {
  const wanted = statusList(status);
  try {
    const client = await createLiveServiceClient();
    const { data: rows, error } = await client
      .from('pipeline_runs')
      .select('status, result, started_at, completed_at')
      .eq('op_id', opId);
    if (error) {
      return `stage_counts.${stage} absent; diagnostic query failed — ${error.message ?? String(error)}`;
    }
    if (!rows || rows.length === 0) {
      return `stage_counts.${stage} absent: NO pipeline_runs row for op_id ${opId} (cause 1 — the run never recorded).`;
    }
    const statuses = rows.map((r) => r.status as string);
    const match =
      wanted
        .map((s) => rows.find((r) => r.status === s))
        .find((r) => r !== undefined) ?? undefined;
    if (!match) {
      return (
        `stage_counts.${stage} absent: pipeline_runs row(s) for op_id ${opId} exist but carry status ` +
        `${JSON.stringify(statuses)}, none of ${JSON.stringify(wanted)} (cause 2 — the status filter, ` +
        `not the stage). Note a run that reached a terminal state OTHER than these still ran its ` +
        `stages; only 'failed' is genuine evidence it may not have.`
      );
    }
    const result = (match.result as Record<string, unknown> | null) ?? null;
    if (!result) {
      return `stage_counts.${stage} absent: the '${match.status}' row has a NULL result JSONB (cause 3).`;
    }
    const stageCounts = result.stage_counts as
      | Record<string, unknown>
      | undefined;
    if (!stageCounts) {
      return `stage_counts.${stage} absent: result JSONB carries no stage_counts dict (cause 3). result keys: ${JSON.stringify(Object.keys(result))}`;
    }
    return (
      `stage_counts.${stage} absent: stage_counts is present but has no '${stage}' key ` +
      `(cause 4 — the stage genuinely did not run). Keys present: ${JSON.stringify(Object.keys(stageCounts))}`
    );
  } catch (err) {
    return `stage_counts.${stage} absent; diagnostic threw — ${String(err)}`;
  }
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
 * Poll `pipeline_runs WHERE op_id = <opId>` until the row reaches a terminal
 * SUCCESS status (`completed` OR `completed_with_errors`), or the deadline
 * is reached. This is the C-54 / Stage-5 Inv-3 read-contract gate:
 * `entity_mentions.canonical_name` is only authoritative AFTER the producing
 * run completes (TECH §2.6 row C-54; Stage-5 PRODUCT Inv-3 "canonical_name
 * freshness on successful run").
 *
 * `completed_with_errors` IS terminal success for this gate (id-414 AC-4,
 * coupled to the AC-1 flow change): since the fail-loud resolution, a walk
 * with CONTAINED per-item drops resolves to `completed_with_errors` instead
 * of a bare `completed` — treating only `completed` as success would hang
 * this poll to timeout on any such walk. The run still finished its pass;
 * Stage-5 faults are walk-wide and land `failed`, so the landed rows'
 * post-completion read contract holds. The drops belong to OTHER items —
 * callers assert on the rows they staged, and those assertions (not this
 * gate) fail loudly if the caller's own item was the one dropped. The
 * returned row carries `status` for callers that need to distinguish.
 *
 * Rejects (rather than silently resolving) when the run terminates in a
 * terminal NON-success status (`failed`/`cancelled`/...): such a run cannot
 * satisfy the post-completion read contract, so the caller's assertions
 * would be meaningless. Throws when live-DB credentials are not real
 * (callers MUST env-gate first) and rejects on timeout.
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
      if (status === 'completed' || status === 'completed_with_errors') {
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
    `pollPipelineRunCompleted: timed out after ${timeoutMs}ms waiting for pipeline_runs.status IN ('completed', 'completed_with_errors') for op_id ${opId}`,
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
   * Provenance label. MUST be one of the platform provenance vocabulary —
   * `entity_aliases_provenance_check` allows only 'core' | 'client' |
   * 'recommended' (2026-06-17 squash baseline). Defaults to 'client' (the
   * right bucket for a runtime-inserted row; 'core' denotes platform-seeded
   * baseline data).
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
 * Cleanup scoping is by the returned ids (`cleanupAliasMap`) — provenance
 * was never wired to any query, so a per-test provenance cannot scope
 * concurrent suites (the earlier guidance to pass a test-unique value was
 * inert AND violated `entity_aliases_provenance_check`).
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
    provenance: s.provenance ?? 'client',
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
 * ───────────────────────────────────────────────────────────────────────────
 * HOW THE DIRECTIVE TRAVELS AND WHERE IT IS HONOURED (id-414 AC-6)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Transport: the directive rides as a query-style suffix on `destPath`
 * (`<path>?failStage5=<mode>`), which keeps this helper inside the existing
 * 3-field `stageFixture` contract — no fourth field, no excess property. It
 * is NOT a separate request-body field; an earlier revision of this docblock
 * said it was, and that was never true of the code below.
 *
 * Server side (`scripts/cocoindex_pipeline/server.py`):
 *   1. `_stage_handler` STRIPS the suffix off `destPath` before writing, so
 *      the file lands as `<path>` and extension routing sees a real
 *      extension. The 200 body echoes the path actually written plus a
 *      `failStage5` field confirming the directive was understood.
 *   2. The directive is then ARMED, one-shot, for the next `POST /walk`.
 *      `_run_walk` consumes it via `stage5_failure_injection()`, which
 *      overrides that mode's credential env vars with an invalid sentinel for
 *      the duration of that ONE walk and restores the previous environment in
 *      a `finally`. `failMode: 'embedder'` overrides `OPENAI_API_KEY`;
 *      `failMode: 'pair_resolver'` overrides `ANTHROPIC_API_KEY` +
 *      `ANTHROPIC_AUTH_TOKEN`. An INVALID value is used rather than an unset
 *      one so the provider returns a real 401 (the documented
 *      `AuthenticationError` classes below) instead of the SDK raising at
 *      client construction.
 *   3. `/walk-status` reports `stage5FailureInjected` on an injected walk, so
 *      the injection is attributable rather than looking like a spontaneous
 *      Stage-5 failure.
 *
 * A staging service that does not understand the suffix returns a 400 (the
 * route rejects every unrecognised `?...` tail), and the test's env-gate
 * skip-clean masks it — the directive only fires when the suite is ENABLED.
 *
 * BLAST RADIUS — read before arming this in a shared corpus. Stage 5 is a
 * per-RUN resolution pass, not a per-document step, so an armed directive
 * fails Stage 5 for EVERY document in that walk, not only this fixture. The
 * credential override is process-wide for the walk's duration. Do not arm it
 * while other fixtures in the same walk need a healthy Stage 5.
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
 * Stage a fixture whose next walk's Stage-5 pass is configured to fail.
 *
 * Returns the `stageFixture` result. Note that `result.destPath` is the path
 * the server ACTUALLY wrote — the `?failStage5=` suffix has been stripped —
 * so it is the value to poll or clean up against, not the string passed in.
 *
 * The failure arises from a real credential-rejected model call inside the
 * UNMODIFIED resolution stack (stage_5.py / entity_embedder.py /
 * pair_resolver.py are untouched); the only production code involved is the
 * `/stage` + `/walk` directive plumbing in server.py described in the
 * function-family docblock above, which is where the credential override is
 * scoped and restored.
 */
export async function injectStage5Failure(
  args: InjectStage5FailureArgs,
): Promise<StageFixtureResult> {
  const failMode: Stage5FailMode = args.failMode ?? 'embedder';
  // The directive rides as a query-style suffix on `destPath`, keeping this
  // helper inside the existing 3-field `stageFixture` contract (no excess
  // properties). `_stage_handler` strips the suffix before writing and arms
  // the injection for the next walk; every OTHER `?...` tail is a named 400,
  // so a staging service without this contract rejects the call loudly rather
  // than writing a file named `<path>?failStage5=<mode>`. The env-gate skip
  // masks that rejection (only ENABLED suites reach this call).
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
