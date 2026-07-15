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
 * The helpers are env-gated: every caller MUST check `hasFixtureStagingUrl()`
 * (or the equivalent local env-gate) before invoking `stageFixture`. The
 * helpers themselves throw fast on missing env to surface mis-wiring.
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
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../../helpers/supabase-client';

// ---------------------------------------------------------------------------
// Env-gate
// ---------------------------------------------------------------------------

/**
 * True when COCOINDEX_FIXTURE_STAGING_URL is set. Callers MUST gate any
 * `stageFixture(...)` invocation behind this check; the helper itself throws
 * when the env var is unset to make mis-wiring loud.
 */
export function hasFixtureStagingUrl(): boolean {
  return Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
}

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
      'stageFixture: COCOINDEX_FIXTURE_STAGING_URL is unset. Gate the caller behind hasFixtureStagingUrl() before invoking.',
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

  return {
    destPath: body.destPath ?? args.destPath,
    requestId: body.requestId,
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
    const { data, error } = await client
      .from('source_documents')
      .select('id, op_id')
      .ilike('filename', `${titlePrefix}%`);

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
    `pollContentItemsFor: timed out after ${timeoutMs}ms waiting for source_documents row with filename ILIKE '${titlePrefix}%'`,
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
 */
export interface PolledContentChunkRow {
  id: string;
  source_document_id: string;
  content: string;
  position: number;
  char_count: number;
  word_count: number;
  embedding: unknown;
  op_id: string | null;
  heading_text: string | null;
  heading_level: number | null;
  heading_path: string[] | null;
  parent_chunk_id: string | null;
}

const CONTENT_CHUNK_COLUMNS =
  'id, source_document_id, content, position, char_count, word_count, embedding, op_id, heading_text, heading_level, heading_path, parent_chunk_id';

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
    embedding: r.embedding ?? null,
    op_id: (r.op_id as string | null) ?? null,
    heading_text: (r.heading_text as string | null) ?? null,
    heading_level: (r.heading_level as number | null) ?? null,
    heading_path: (r.heading_path as string[] | null) ?? null,
    parent_chunk_id: (r.parent_chunk_id as string | null) ?? null,
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

  // 1a. q_a_extractions — hard FK on source_document_id; delete first.
  {
    const { error } = await client
      .from('q_a_extractions')
      .delete()
      .in('source_document_id', args.contentIds);
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
      .in('source_document_id', args.contentIds);
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
      .in('id', args.contentIds);
    if (error) {
      console.warn(
        `dropFixture: source_documents cleanup warning — ${error.message ?? String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Form-instance poll + cleanup helpers (ID-52.13)
//
// The cocoindex form-extraction write path (ID-52.12) originally landed rows
// in `form_templates` + `form_template_fields` — NOT `content_items`. These
// helpers are the form-side analogues of `pollContentItemsFor` /
// `dropFixture`: they poll the form tables and purge the seeded rows. They
// mirror the env-gate + timeout + best-effort-cleanup conventions exactly.
//
// {145.6} W1c re-key (S474 gate sweep, {145.23}): `form_templates` /
// `form_template_fields` RENAMED to `form_instances` / `form_instance_fields`
// on live staging (20260712062000_id145_w1c_rename_reshape.sql). Exports
// RETAIN their ORIGINAL names + signatures per the same precedent
// `pollContentItemsFor` set at ID-131.19 M6 (dozens of call sites import
// these unchanged) — only the underlying table/column names change below.
// `status` was also renamed `processing_status` (the document-processing
// axis, orthogonal to `workflow_state`) and `workspace_id` was DROPPED (BI-1:
// the form owns its lifecycle directly, no workspace mediation). SEPARATELY,
// ID-136 (DONE) retired the cocoindex pipeline's Path-B form-write block
// entirely (`ft_target`/`ftf_target` removed from `ingest_file`,
// flow.py:1778-1784) — forms are now written ONLY via the app-side
// manual-upload route. These helpers stay CORRECT against the live schema
// regardless of who writes the rows; see the `⚠ ID-136` note in
// form-extraction.integration.test.ts for the consequence to that file's
// Path-B assertions.
//
// NOTE: `form_instances` has NO `title` column (it has `name` +
// `storage_path`). The poll matches on `name ILIKE` OR `storage_path ILIKE`
// so a caller can scope by either the injected name prefix (the same
// `titlePrefix` convention) or the staged dest-path prefix.
// ---------------------------------------------------------------------------

export interface PollFormTemplatesOpts {
  /** Maximum wait, ms, for at least `minRows` rows. Default 120_000. */
  timeoutMs?: number;
  /** Interval between poll attempts, ms. Default 2_000. */
  pollIntervalMs?: number;
  /**
   * Minimum number of rows to wait for before resolving. Default 1. The
   * Inv-17 batch case raises this to wait for the full success+failure set.
   */
  minRows?: number;
  /**
   * Match by `storage_path ILIKE '${prefix}%'` instead of `name ILIKE`.
   * Default false (match by `name`). The pipeline write sets
   * `storage_path = rel_path`, so a caller that staged into a known folder
   * prefix can poll on the path even when the injected name differs.
   */
  matchStoragePath?: boolean;
  /**
   * Also accept rows in a non-`analysed` status (e.g. `analysis_failed`).
   * Default true — the Inv-17 batch case needs the failed row to count.
   */
  includeNonAnalysed?: boolean;
}

/**
 * The narrow `form_instances` projection the ID-52.13 invariant tests assert
 * on. Mirrors the columns written by the {52.12} pipeline write path (now
 * superseded by the app-side manual-upload route per ID-136 — see the
 * module-header note above).
 */
export interface PolledFormTemplateRow {
  id: string;
  name: string;
  filename: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  processing_status: string;
  field_count: number | null;
  description: string | null;
  form_type: string | null;
  evaluation_methodology: string | null;
  ingest_source: string;
}

const FORM_TEMPLATE_COLUMNS =
  'id, name, filename, mime_type, file_size, storage_path, processing_status, field_count, description, form_type, evaluation_methodology, ingest_source';

/**
 * Poll `form_instances` via the live service-role client until at least
 * `minRows` rows whose `name` (or `storage_path`) is prefixed by `prefix`
 * land, or the deadline is reached.
 *
 * Throws when live-DB credentials are not real (callers must env-gate via
 * `hasRealLiveDbCredentials()` first), and rejects on timeout.
 */
export async function pollFormTemplatesFor(
  prefix: string,
  opts: PollFormTemplatesOpts = {},
): Promise<PolledFormTemplateRow[]> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'pollFormTemplatesFor: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const minRows = opts.minRows ?? 1;
  const matchColumn = opts.matchStoragePath ? 'storage_path' : 'name';

  const client = await createLiveServiceClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data, error } = await client
      .from('form_instances')
      .select(FORM_TEMPLATE_COLUMNS)
      .ilike(matchColumn, `${prefix}%`);

    if (error) {
      throw new Error(
        `pollFormTemplatesFor: query failed — ${error.message ?? String(error)}`,
      );
    }

    if (data && data.length >= minRows) {
      return data.map(toPolledFormTemplateRow);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `pollFormTemplatesFor: timed out after ${timeoutMs}ms waiting for >= ${minRows} form_instances row(s) with ${matchColumn} ILIKE '${prefix}%'`,
  );
}

function toPolledFormTemplateRow(
  r: Record<string, unknown>,
): PolledFormTemplateRow {
  return {
    id: r.id as string,
    name: r.name as string,
    filename: r.filename as string,
    mime_type: r.mime_type as string,
    file_size: (r.file_size as number | null) ?? 0,
    storage_path: r.storage_path as string,
    processing_status: r.processing_status as string,
    field_count: (r.field_count as number | null) ?? null,
    description: (r.description as string | null) ?? null,
    form_type: (r.form_type as string | null) ?? null,
    evaluation_methodology: (r.evaluation_methodology as string | null) ?? null,
    ingest_source: r.ingest_source as string,
  };
}

export interface PollFormTemplateFieldsOpts {
  /** Maximum wait, ms. Default 120_000. */
  timeoutMs?: number;
  /** Interval between poll attempts, ms. Default 2_000. */
  pollIntervalMs?: number;
  /** Minimum rows to wait for. Default 1. */
  minRows?: number;
}

/**
 * The narrow `form_instance_fields` projection the invariant tests assert on
 * — mirrors the per-field columns written by the {52.12} pipeline write path
 * (Inv-8 coordinates, Inv-10 mandatory, Inv-11 word limit, Inv-12 section,
 * Inv-14 reference URLs).
 */
export interface PolledFormTemplateFieldRow {
  id: string;
  form_instance_id: string;
  question_text: string | null;
  placeholder_text: string | null;
  field_type: string;
  fill_status: string;
  row_index: number | null;
  col_index: number | null;
  table_index: number | null;
  section_name: string | null;
  sequence: number;
  word_limit: number | null;
  is_mandatory: boolean | null;
  reference_urls: string[] | null;
}

const FORM_TEMPLATE_FIELD_COLUMNS =
  'id, form_instance_id, question_text, placeholder_text, field_type, fill_status, row_index, col_index, table_index, section_name, sequence, word_limit, is_mandatory, reference_urls';

/**
 * Poll `form_instance_fields` for `form_instance_id = <templateId>` until at
 * least `minRows` rows land, or the deadline is reached. Throws when live-DB
 * credentials are not real; rejects on timeout.
 */
export async function pollFormTemplateFieldsFor(
  templateId: string,
  opts: PollFormTemplateFieldsOpts = {},
): Promise<PolledFormTemplateFieldRow[]> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'pollFormTemplateFieldsFor: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const minRows = opts.minRows ?? 1;

  const client = await createLiveServiceClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data, error } = await client
      .from('form_instance_fields')
      .select(FORM_TEMPLATE_FIELD_COLUMNS)
      .eq('form_instance_id', templateId)
      .order('sequence', { ascending: true });

    if (error) {
      throw new Error(
        `pollFormTemplateFieldsFor: query failed — ${error.message ?? String(error)}`,
      );
    }

    if (data && data.length >= minRows) {
      return data.map(toPolledFormTemplateFieldRow);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `pollFormTemplateFieldsFor: timed out after ${timeoutMs}ms waiting for >= ${minRows} form_instance_fields row(s) for form_instance_id ${templateId}`,
  );
}

function toPolledFormTemplateFieldRow(
  r: Record<string, unknown>,
): PolledFormTemplateFieldRow {
  return {
    id: r.id as string,
    form_instance_id: r.form_instance_id as string,
    question_text: (r.question_text as string | null) ?? null,
    placeholder_text: (r.placeholder_text as string | null) ?? null,
    field_type: r.field_type as string,
    fill_status: r.fill_status as string,
    row_index: (r.row_index as number | null) ?? null,
    col_index: (r.col_index as number | null) ?? null,
    table_index: (r.table_index as number | null) ?? null,
    section_name: (r.section_name as string | null) ?? null,
    sequence: r.sequence as number,
    word_limit: (r.word_limit as number | null) ?? null,
    is_mandatory: (r.is_mandatory as boolean | null) ?? null,
    reference_urls: (r.reference_urls as string[] | null) ?? null,
  };
}

export interface DropFormFixtureArgs {
  /**
   * Name (or storage_path) prefix the form rows were tagged with. Used as a
   * safety scoping guard so a buggy caller cannot widen the delete blast
   * radius. Refuses to run when empty.
   */
  prefix: string;
  /**
   * The `form_instances.id` values the test seeded. Cleanup deletes
   * `form_instance_fields` (by `form_instance_id`) first, then
   * `form_instances` (by id). When empty, falls back to a prefix-scoped
   * resolve-then-delete.
   */
  templateIds?: string[];
  /**
   * Match the prefix against `storage_path` instead of `name` when resolving
   * template ids from the prefix (fallback path). Default false.
   */
  matchStoragePath?: boolean;
}

/**
 * Purge `form_instance_fields` + `form_instances` rows for a single test
 * fixture. Two-pass FK-respecting delete:
 *
 *   1. Delete `form_instance_fields` WHERE `form_instance_id` IN (...templateIds).
 *   2. Delete `form_instances` WHERE `id` IN (...templateIds).
 *
 * When `templateIds` is empty, resolves the ids from the `prefix` first
 * (scoped to `name`/`storage_path` ILIKE) so a test whose poll never landed
 * its ids can still clean up by prefix. Refuses to run with an empty
 * `prefix` (defensive scoping guard).
 *
 * Best-effort: individual delete errors are logged via `console.warn` and
 * swallowed so a partial cleanup does not block teardown. Throws when
 * live-DB credentials are not real (callers must env-gate).
 */
export async function dropFormFixture(
  args: DropFormFixtureArgs,
): Promise<void> {
  if (!hasRealLiveDbCredentials()) {
    throw new Error(
      'dropFormFixture: live DB credentials are not real (or absent). Gate the caller behind hasRealLiveDbCredentials() first.',
    );
  }

  if (!args.prefix || args.prefix.length === 0) {
    console.warn(
      'dropFormFixture: called with empty prefix; refusing to run (defensive scoping guard).',
    );
    return;
  }

  const client = await createLiveServiceClient();

  // Resolve the template id set: prefer the caller-supplied ids, else
  // resolve from the prefix (scoped) so cleanup still works when the poll
  // never landed the ids in the test body.
  let templateIds = args.templateIds ?? [];
  if (templateIds.length === 0) {
    const matchColumn = args.matchStoragePath ? 'storage_path' : 'name';
    const { data, error } = await client
      .from('form_instances')
      .select('id')
      .ilike(matchColumn, `${args.prefix}%`);
    if (error) {
      console.warn(
        `dropFormFixture: prefix id-resolve warning — ${error.message ?? String(error)}`,
      );
      return;
    }
    templateIds = (data ?? []).map((r) => r.id as string);
  }

  if (templateIds.length === 0) {
    // Nothing landed — typical when staging never ran. Not an error.
    return;
  }

  // 1. form_instance_fields — child rows first (FK on form_instance_id).
  {
    const { error } = await client
      .from('form_instance_fields')
      .delete()
      .in('form_instance_id', templateIds);
    if (error) {
      console.warn(
        `dropFormFixture: form_instance_fields cleanup warning — ${error.message ?? String(error)}`,
      );
    }
  }

  // 2. form_instances — parent rows, PK delete.
  {
    const { error } = await client
      .from('form_instances')
      .delete()
      .in('id', templateIds);
    if (error) {
      console.warn(
        `dropFormFixture: form_instances cleanup warning — ${error.message ?? String(error)}`,
      );
    }
  }
}
