/**
 * Fixture-staging helpers for cocoindex integration tests.
 *
 * Subtask ID-49.10 (S275 sub-orchestrator subo-id-49-10) — wires the helper
 * layer that consumes the fixture-staging Cloud Run service (provisioned at
 * ID-49.9). Three helpers:
 *
 *   - `stageFixture(...)` — POSTs fixture metadata to the staging service so
 *     it lands in the cocoindex-watched corpus path.
 *   - `pollContentItemsFor(titlePrefix, opts?)` — polls `source_documents`
 *     via the live service-role client until at least one row matching the
 *     prefix lands, or the deadline is reached.
 *   - `dropFixture({...})` — purges derivation rows + `source_documents`
 *     rows for a single test fixture. Best-effort across tables; explicitly
 *     scoped to a caller-supplied `contentIds` / `titlePrefix`.
 *
 * ID-131.19 M6 retirement note (S450 GO tail): `content_items` was DROPPED
 * at M6. `pollContentItemsFor` / `dropFixture` are retained under their
 * ORIGINAL names + signatures (dozens of Stage-5/chunking integration tests
 * import them unchanged) but now read/write `source_documents` directly —
 * the ingest pipeline's actual row-of-record post-ID-131 (entity_mentions /
 * content_chunks / q_a_extractions all key off `source_document_id`, not a
 * content_items id). The prior code already treated the ids these helpers
 * exchange as `source_documents.id` in every FK-join call site (see
 * `pollContentChunksFor`'s `.eq('source_document_id', contentItemId)` below,
 * fed directly from this helper's return value) — this re-point makes that
 * implicit equivalence the literal, honest one. Renaming the exports to
 * `pollSourceDocumentsFor` / drop the `content`-flavoured naming entirely is
 * a follow-up outside this Subtask's file-ownership boundary (would require
 * touching every consumer test file, not just this helper).
 *
 * The helpers are env-gated: every caller MUST check
 * `Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL)` (the standing local
 * HAS_FIXTURE_STAGING gate in each consumer test) before invoking
 * `stageFixture`. The helpers themselves throw fast on missing env to
 * surface mis-wiring.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-9 (pollContentItemsFor
 *     convention; this is the canonical implementation).
 *   - __tests__/integration/helpers/supabase-client.ts (prior-art client
 *     factory + env-gate helpers).
 *   - task-list.json ID-49.10 details + S274 nit absorption.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  loadCorpusManifest,
  walkedBaselinePathSet,
} from '@/lib/corpus/fixture-manifest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../../helpers/supabase-client';

import { runWalk, type WalkResult } from './walk';

// ---------------------------------------------------------------------------
// stageFixture
// ---------------------------------------------------------------------------

export interface StageFixtureArgs {
  /**
   * Repository-relative or absolute path to the source fixture file. The
   * staging service reads the bytes and drops them into the cocoindex
   * watched corpus path.
   */
  fixturePath: string;
  /**
   * Destination path RELATIVE to the cocoindex corpus root. The service
   * combines this with the configured COCOINDEX_SOURCE_PATH and writes the
   * fixture into the resulting location. Must include the file extension.
   */
  destPath: string;
  /**
   * Title prefix the calling test will later poll for. The staging service
   * writes the fixture under a dest filename carrying this prefix, and the
   * cocoindex pipeline stamps `source_documents.filename` from the ingested
   * path basename, so the poll matches via `ILIKE \`${titlePrefix}%\`` on
   * `filename` (post-ID-131.19 M6 retarget — was `content_items.title`).
   */
  titlePrefix: string;
  /**
   * id-400 (W2, HARNESS §2): stage → request `/walk` → await completion is
   * the DEFAULT staging sequence — the 10 s background pump is deleted, so a
   * staged fixture is only ever absorbed by a walk the test itself requested
   * (and can attribute). Pass `walk: false` for the rare stage-only caller
   * (e.g. batching several stages before ONE shared walk).
   */
  walk?: boolean;
  /**
   * Request the absorbing walk in cocoindex's full-reprocess update mode
   * (`POST /walk` body `{ full_reprocess: true }`) instead of the default
   * memo-respecting pass.
   *
   * The directive belongs to `/walk`, NOT to `destPath`. `destPath` is a
   * corpus-relative path written VERBATIM, so a `?fullReprocess=1` suffix
   * would land in the filename and break extension routing — `POST /stage`
   * names that a 400 (`server.py::parse_stage_dest_path`, id-414 W5), and its
   * one allowlisted suffix is `?failStage5=<mode>`. Ignored when
   * `walk: false`, since there is then no walk to configure.
   */
  fullReprocess?: boolean;
  /** Walk budget override (ms) — forwarded to `runWalk`. */
  walkTimeoutMs?: number;
}

export interface StageFixtureResult {
  /**
   * The destination path the staging service wrote to (echoed back from
   * the service for sanity-checking — may include a corpus-root prefix the
   * caller did not supply).
   */
  destPath: string;
  /**
   * Service-side request id (audit-trail). May be absent if the staging
   * service does not emit one.
   */
  requestId?: string;
  /**
   * id-400 (W2/NM-5): the awaited walk that absorbed this staging — the
   * test's ATTRIBUTION ANCHOR (`walk.opId` is the run that processed the
   * fixture; bind op_id assertions to it, never to "latest row"). Absent
   * only when the caller passed `walk: false`.
   */
  walk?: WalkResult;
}

/**
 * Stage a fixture into the cocoindex-watched corpus path by POSTing to the
 * fixture-staging service. Throws when COCOINDEX_FIXTURE_STAGING_URL is
 * unset (callers must env-gate first).
 *
 * The bytes travel on the wire as `multipart/form-data` (ID-62.8, OQ-62-7) —
 * NOT a JSON path the writer cannot see. The runner reads the fixture bytes
 * at `args.fixturePath` here and sends them as a `file` part; the co-resident
 * `POST /stage` route (ID-62.5) writes them under the corpus root at
 * `destPath`. Three parts, matching the route contract exactly:
 *
 *   - `file`        — the fixture bytes (filename = `basename(destPath)`)
 *   - `destPath`    — corpus-relative destination (text)
 *   - `titlePrefix` — informational; the route does NO in-byte injection
 *                     (OQ-62-6), so the caller embeds the prefix in the dest
 *                     filename and the pipeline derives the title from the path.
 *
 * `StageFixtureArgs` is unchanged, so callers compile unchanged (Inv-26).
 */
export async function stageFixture(
  args: StageFixtureArgs,
): Promise<StageFixtureResult> {
  const baseUrl = process.env.COCOINDEX_FIXTURE_STAGING_URL;
  if (!baseUrl) {
    throw new Error(
      'stageFixture: COCOINDEX_FIXTURE_STAGING_URL is unset. Gate the caller behind a COCOINDEX_FIXTURE_STAGING_URL env check before invoking.',
    );
  }

  // Normalise: callers may pass either bare URL or URL-with-trailing-slash.
  const endpoint = `${baseUrl.replace(/\/$/, '')}/stage`;

  // Read the fixture bytes runner-side and ship them as multipart — bytes on
  // the wire, not a path the writer can't resolve (Inv-2, Inv-19). `fetch`
  // sets the multipart boundary itself, so we MUST NOT set Content-Type.
  const fileBytes = await readFile(args.fixturePath);
  const formData = new FormData();
  formData.append('file', new Blob([fileBytes]), basename(args.destPath));
  formData.append('destPath', args.destPath);
  formData.append('titlePrefix', args.titlePrefix);

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '<no body>');
    throw new Error(
      `stageFixture: staging service returned ${response.status} ${response.statusText} — ${bodyText}`,
    );
  }

  const body = (await response.json().catch(() => ({}))) as {
    destPath?: string;
    requestId?: string;
  };

  // id-400 (W2, HARNESS §2): stage → request /walk → await completion. With
  // the pump deleted this awaited walk is the ONLY thing that absorbs the
  // fixture; its result is the caller's attribution anchor. Walks are
  // corpus-wide and memo-cheap post-id-400 (unchanged items scan+skip), so
  // one walk per staging is bounded at the mock-tier corpus size.
  let walk: WalkResult | undefined;
  if (args.walk !== false) {
    walk = await runWalk({
      fullReprocess: args.fullReprocess,
      timeoutMs: args.walkTimeoutMs,
    });
  }

  return {
    destPath: body.destPath ?? args.destPath,
    requestId: body.requestId,
    walk,
  };
}

// ---------------------------------------------------------------------------
// pollContentItemsFor
// ---------------------------------------------------------------------------

export interface PollContentItemsOpts {
  /**
   * Maximum wait, in milliseconds, for at least one row to land. Defaults
   * to 120_000 (matches the POLL_TIMEOUT_MS sentinel used across the
   * cocoindex integration suite — formerly pinned to the now-retired
   * `inv-1-content-items-row-produced.integration.test.ts`, ID-131.19 M6).
   */
  timeoutMs?: number;
  /**
   * Interval between poll attempts. Defaults to 2_000.
   */
  pollIntervalMs?: number;
  /**
   * When true, only rows with a non-null `op_id` match — i.e. rows written
   * by an actual pipeline run. Tests that seed their own NULL-op_id
   * `source_documents` row under the SAME prefix they later poll (e.g. the
   * Inv-8 classifyContent-coexistence seed) set this so the poll waits for
   * the pipeline's row instead of matching their own seed instantly.
   * Default false (unchanged behaviour).
   */
  requireOpId?: boolean;
}

export interface PolledContentItemRow {
  id: string;
  op_id: string | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * Poll the `source_documents` table via the live service-role client until
 * at least one row whose `filename ILIKE '${titlePrefix}%'` lands, or the
 * deadline is reached. Resolves with the landed row set on success; rejects
 * with a timeout error otherwise.
 *
 * ID-131.19 M6 retarget: this originally polled `content_items.title`;
 * `content_items` was DROPPED at M6. `source_documents.filename` is stamped
 * from the ingested path basename (`file.file_path.path.name` in
 * scripts/cocoindex_pipeline/flow.py), which is exactly the destination
 * filename `stageFixture` callers construct from `titlePrefix` (e.g.
 * `destPath: \`corpus/\${titlePrefix}.md\``), so the ILIKE-prefix match is
 * unchanged in spirit. The returned `id` is now literally
 * `source_documents.id` — every consumer already fed this value into FK
 * joins keyed on `source_document_id` (see `pollContentChunksFor` below),
 * so this is a correctness fix, not just a rename.
 *
 * Throws when live-DB credentials are not real (callers must env-gate via
 * `hasRealLiveDbCredentials()` first).
 *
 * The selected columns are intentionally narrow — `id` + `op_id` — to keep
 * the helper composable across invariant tests. Callers can re-query with
 * a wider projection once they have the row id.
 */
export async function pollContentItemsFor(
  titlePrefix: string,
  opts: PollContentItemsOpts = {},
): Promise<PolledContentItemRow[]> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'pollContentItemsFor: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() before invoking.',
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const client = await createLiveServiceClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let query = client
      .from('source_documents')
      .select('id, op_id')
      .ilike('filename', `${titlePrefix}%`);
    if (opts.requireOpId) {
      query = query.not('op_id', 'is', null);
    }
    const { data, error } = await query;

    if (error) {
      // Surface PostgREST / network errors to the caller. Network-isolation
      // failures (ENOTFOUND etc.) are caller-handled via
      // `isNetworkIsolationError` on a per-test basis if needed.
      throw new Error(
        `pollContentItemsFor: query failed — ${error.message ?? String(error)}`,
      );
    }

    if (data && data.length > 0) {
      return data.map((r) => ({
        id: r.id as string,
        op_id: (r.op_id as string | null) ?? null,
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `pollContentItemsFor: timed out after ${timeoutMs}ms waiting for source_documents row with filename ILIKE '${titlePrefix}%'${
      opts.requireOpId ? ' (non-null op_id required)' : ''
    }`,
  );
}

// ---------------------------------------------------------------------------
// pollContentChunksFor (ID-56.9)
// ---------------------------------------------------------------------------

export interface PollContentChunksOpts {
  /** Maximum wait, ms, for at least `minRows` rows. Default 120_000. */
  timeoutMs?: number;
  /** Interval between poll attempts, ms. Default 2_000. */
  pollIntervalMs?: number;
  /** Minimum number of rows to wait for before resolving. Default 1. */
  minRows?: number;
}

/**
 * The narrow `content_chunks` projection the ID-56.9 chunking-stage invariant
 * tests assert on. Mirrors the columns written by the {56.8} chunking stage
 * (PRODUCT C-10..C-13) plus the heading-derived columns the test verifies are
 * NULL / the DB default `'{}'` (C-13 + [GAP-CMI-004] disposition (a)).
 *
 * NB: `content_chunks.embedding` was DROPPED by migration
 * 20260706120000_id131_drop_inline_vector_cols (ID-131 {131.19} / DR-036) —
 * chunk vectors live on the separate `record_embeddings` table keyed by
 * (owner_kind='content_chunk', owner_id=<chunk id>). Callers asserting on
 * the vector use `fetchChunkEmbedding` below.
 */
export interface PolledContentChunkRow {
  id: string;
  source_document_id: string;
  content: string;
  position: number;
  char_count: number;
  word_count: number;
  op_id: string | null;
  heading_text: string | null;
  heading_level: number | null;
  heading_path: string[] | null;
  parent_chunk_id: string | null;
}

const CONTENT_CHUNK_COLUMNS =
  'id, source_document_id, content, position, char_count, word_count, op_id, heading_text, heading_level, heading_path, parent_chunk_id';

/**
 * Poll `content_chunks` for a given `source_document_id` via the live service-role
 * client until at least `minRows` rows land, or the deadline is reached. Rows
 * are returned ordered by `position` ascending so callers can assert the
 * monotonic 0,1,2... run (C-11). Mirrors `pollContentItemsFor`'s shape: a
 * service-role client, a poll-with-timeout loop, and a reject on timeout.
 *
 * Throws when live-DB credentials are not real (callers must env-gate via
 * `hasRealLiveDbCredentials()` first), and rejects on timeout.
 */
export async function pollContentChunksFor(
  contentItemId: string,
  opts: PollContentChunksOpts = {},
): Promise<PolledContentChunkRow[]> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'pollContentChunksFor: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const minRows = opts.minRows ?? 1;

  const client = await createLiveServiceClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data, error } = await client
      .from('content_chunks')
      .select(CONTENT_CHUNK_COLUMNS)
      .eq('source_document_id', contentItemId)
      .order('position', { ascending: true });

    if (error) {
      throw new Error(
        `pollContentChunksFor: query failed — ${error.message ?? String(error)}`,
      );
    }

    if (data && data.length >= minRows) {
      return data.map(toPolledContentChunkRow);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `pollContentChunksFor: timed out after ${timeoutMs}ms waiting for >= ${minRows} content_chunks row(s) for source_document_id ${contentItemId}`,
  );
}

function toPolledContentChunkRow(
  r: Record<string, unknown>,
): PolledContentChunkRow {
  return {
    id: r.id as string,
    source_document_id: r.source_document_id as string,
    content: r.content as string,
    position: r.position as number,
    char_count: r.char_count as number,
    word_count: r.word_count as number,
    op_id: (r.op_id as string | null) ?? null,
    heading_text: (r.heading_text as string | null) ?? null,
    heading_level: (r.heading_level as number | null) ?? null,
    heading_path: (r.heading_path as string[] | null) ?? null,
    parent_chunk_id: (r.parent_chunk_id as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// fetchChunkEmbedding
// ---------------------------------------------------------------------------

export interface ChunkEmbeddingRow {
  id: string;
  embedding: unknown;
}

/**
 * Fetch the `record_embeddings` row for a single `content_chunks` id.
 *
 * `content_chunks.embedding` was DROPPED by migration
 * 20260706120000_id131_drop_inline_vector_cols (ID-131 {131.19} / DR-036);
 * chunk vectors land on `record_embeddings` keyed by
 * (owner_kind='content_chunk', owner_id=<chunk id>) via the flow's
 * `_declare_record_embedding`. Mirrors the proven read in
 * stage-topology.integration.test.ts (owner_kind='source_document').
 *
 * Returns the row (the pgvector value round-trips through PostgREST as an
 * opaque string) or null when no row exists — callers assert non-null /
 * byte-identity per their invariant (C-30 / C-31).
 *
 * Throws when live-DB credentials are not real (callers must env-gate via
 * `hasRealLiveDbCredentials()` first).
 */
export async function fetchChunkEmbedding(
  chunkId: string,
): Promise<ChunkEmbeddingRow | null> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'fetchChunkEmbedding: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }

  const client = await createLiveServiceClient();
  const { data, error } = await client
    .from('record_embeddings')
    .select('id, embedding')
    .eq('owner_kind', 'content_chunk')
    .eq('owner_id', chunkId)
    .limit(1);

  if (error) {
    throw new Error(
      `fetchChunkEmbedding: query failed — ${error.message ?? String(error)}`,
    );
  }

  if (!data || data.length === 0) return null;
  return {
    id: data[0]!.id as string,
    embedding: data[0]!.embedding ?? null,
  };
}

// ---------------------------------------------------------------------------
// dropFixture
// ---------------------------------------------------------------------------

export interface DropFixtureArgs {
  /**
   * Title prefix the fixture was tagged with. Used as a safety scoping
   * guard: cleanup queries always carry this prefix as a secondary filter
   * so a buggy caller cannot accidentally widen the delete blast radius.
   */
  titlePrefix: string;
  /**
   * The `source_documents` ids the test seeded (returned by
   * `pollContentItemsFor` — see its ID-131.19 M6 retarget note). Named
   * `contentIds` for caller-signature stability; the cleanup runs
   * PK-scoped deletes across derivation tables first (FK respect), then
   * deletes the `source_documents` rows themselves.
   */
  contentIds: string[];
}

/**
 * Purge derivation rows + `source_documents` rows for a single test
 * fixture. Operates in two passes:
 *
 *   1. Delete from derivation tables keyed by `source_document_id` IN
 *      (...contentIds): `q_a_extractions`. Also attempts `entity_mentions`
 *      on a best-effort basis (ID-49.5 is currently deferred per S273 OQ-1
 *      — the table or the FK may be absent; we swallow the resulting error
 *      rather than fail the cleanup pass).
 *   2. Delete from `source_documents` by id.
 *
 * ID-131.19 M6 retirement note (S450 GO tail): `content_items` was DROPPED
 * at M6. The prior implementation's step 1c fetched
 * `content_items.source_document_id` for the given `contentIds` and deleted
 * `source_documents` by THAT resolved id — but every other call site in this
 * module already treats `contentIds` as `source_documents.id` values
 * directly (see the q_a_extractions/entity_mentions deletes below, both
 * pre-existing and unchanged), so the fetch-then-resolve indirection was
 * redundant even before M6. This version deletes `source_documents` by
 * `contentIds` directly; the old final "content_items PK delete" pass is
 * removed (the table no longer exists).
 *
 * Refuses to run when `contentIds` is empty OR `titlePrefix` is empty —
 * the helper MUST be scoped to a specific test fixture. Either an empty
 * `contentIds` (poll never landed any rows; nothing to clean) or an
 * empty `titlePrefix` (caller bug) is treated as a no-op + warning.
 *
 * Throws when live-DB credentials are not real (callers must env-gate).
 *
 * Best-effort: errors from individual delete steps are logged via
 * `console.warn` and swallowed so a partial cleanup does not block the
 * subsequent steps. Callers that need strict cleanup semantics can wrap
 * this helper and re-check via `pollContentItemsFor`.
 */
export async function dropFixture(args: DropFixtureArgs): Promise<void> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'dropFixture: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() before invoking.',
    );
  }

  if (!args.titlePrefix || args.titlePrefix.length === 0) {
    console.warn(
      'dropFixture: called with empty titlePrefix; refusing to run (defensive scoping guard).',
    );
    return;
  }

  if (!args.contentIds || args.contentIds.length === 0) {
    // Nothing to clean — typical when the staging path failed to land any
    // rows. Not an error.
    return;
  }

  const client = await createLiveServiceClient();

  // ── Walked-baseline refusal (D1 owner amendment, S511; DR-133) ───────────
  //
  // `contentIds` comes from `pollContentItemsFor`, which matches
  // `filename ILIKE '<titlePrefix>%'`. That is normally the test's own row —
  // but not always, and the exception destroys Platform data.
  //
  // `resolve_or_mint_source_identity` is content-hash FIRST. A fixture staged
  // with bytes identical to a walked-baseline document does not mint a second
  // row; it RESOLVES onto the baseline row. `_upsert_source_document`'s
  // ON CONFLICT then sets `logical_path` AND `filename` from the staging, so
  // the corpus row starts answering to the test's prefix, the poll returns it,
  // and this function deletes a Platform-corpus document by primary key. The
  // walk does not put it back: the identity resolve lives inside the
  // `@coco.fn(memo=True)` `ingest_file`, so an unchanged corpus file memo-hits
  // on every later walk in the run and the row never returns.
  //
  // The sweep's NM-6 guard already refuses this class of delete. It is the only
  // thing that did, and it runs before the walk — it cannot see a deletion that
  // happens in test teardown. Same invariant, second deleter.
  //
  // Both stored paths are tested, mirroring the sweep: `storage_path` catches a
  // corpus row whose `logical_path` a test has rewritten, `logical_path` catches
  // a row minted at a test path that now names a baseline file.
  const baselinePaths = walkedBaselinePathSet(loadCorpusManifest());
  const { data: candidateRows, error: candidateError } = await client
    .from('source_documents')
    .select('id, storage_path, logical_path, filename')
    .in('id', args.contentIds);
  if (candidateError) {
    throw new Error(
      `dropFixture: could not read candidate rows before deleting — ${candidateError.message ?? String(candidateError)}. ` +
        'Refusing to delete blind: an unchecked delete here can remove a Platform-corpus document.',
    );
  }

  const protectedRows = (candidateRows ?? []).filter(
    (r) =>
      baselinePaths.has((r.storage_path as string | null) ?? '') ||
      baselinePaths.has((r.logical_path as string | null) ?? ''),
  );
  const protectedIds = new Set(protectedRows.map((r) => r.id as string));
  const deletableIds = args.contentIds.filter((id) => !protectedIds.has(id));

  // Clean up everything that IS the test's own, so a breach does not also
  // strand rows. The refusal is raised afterwards.
  if (deletableIds.length > 0) {
    // 1a. q_a_extractions — hard FK on source_document_id; delete first.
    {
      const { error } = await client
        .from('q_a_extractions')
        .delete()
        .in('source_document_id', deletableIds);
      if (error) {
        console.warn(
          `dropFixture: q_a_extractions cleanup warning — ${error.message ?? String(error)}`,
        );
      }
    }

    // 1b. entity_mentions — best-effort; ID-49.5 deferred per S273 OQ-1, so the
    // table or its source_document_id FK may not be in shape. Swallow errors.
    try {
      const { error } = await client
        .from('entity_mentions')
        .delete()
        .in('source_document_id', deletableIds);
      if (error) {
        console.warn(
          `dropFixture: entity_mentions cleanup skipped — ${error.message ?? String(error)}`,
        );
      }
    } catch (e) {
      console.warn(
        `dropFixture: entity_mentions cleanup threw — ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // 2. source_documents — final pass, PK delete.
    {
      const { error } = await client
        .from('source_documents')
        .delete()
        .in('id', deletableIds);
      if (error) {
        console.warn(
          `dropFixture: source_documents cleanup warning — ${error.message ?? String(error)}`,
        );
      }
    }
  }

  if (protectedRows.length > 0) {
    const detail = protectedRows
      .map(
        (r) =>
          `  id=${r.id} storage_path=${JSON.stringify(r.storage_path)} ` +
          `logical_path=${JSON.stringify(r.logical_path)} filename=${JSON.stringify(r.filename)}`,
      )
      .join('\n');
    throw new Error(
      `dropFixture: REFUSED to delete ${protectedRows.length} walked-baseline row(s) for ` +
        `titlePrefix ${args.titlePrefix}. These are Platform-corpus documents, not this ` +
        "test's fixture — the test staged bytes identical to a walked-baseline document, so " +
        'content-hash-first identity resolved its staging onto the corpus row instead of ' +
        'minting a new one. The corpus row is intact; this test needs a distinct-bytes ' +
        `fixture (DR-133).\n${detail}`,
    );
  }
}
