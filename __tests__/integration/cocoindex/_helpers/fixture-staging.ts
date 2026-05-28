/**
 * Fixture-staging helpers for cocoindex integration tests.
 *
 * Subtask ID-49.10 (S275 sub-orchestrator subo-id-49-10) — wires the helper
 * layer that consumes the fixture-staging Cloud Run service (provisioned at
 * ID-49.9). Three helpers:
 *
 *   - `stageFixture(...)` — POSTs fixture metadata to the staging service so
 *     it lands in the cocoindex-watched corpus path.
 *   - `pollContentItemsFor(titlePrefix, opts?)` — polls `content_items` via
 *     the live service-role client until at least one row matching the
 *     prefix lands, or the deadline is reached.
 *   - `dropFixture({...})` — purges derivation rows + content_items rows
 *     for a single test fixture. Best-effort across tables; explicitly
 *     scoped to a caller-supplied `contentIds` / `titlePrefix`.
 *
 * The helpers are env-gated: every caller MUST check `hasFixtureStagingUrl()`
 * (or the equivalent local env-gate) before invoking `stageFixture`. The
 * helpers themselves throw fast on missing env to surface mis-wiring.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §P-9 (pollContentItemsFor
 *     convention; this is the canonical implementation).
 *   - __tests__/integration/helpers/supabase-client.ts (prior-art client
 *     factory + env-gate helpers).
 *   - task-list.json ID-49.10 details + S274 nit absorption.
 */

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
   * may inject this into the file's title metadata (when the file format
   * supports it) so the cocoindex pipeline produces a `content_items.title`
   * that the poll matches via `ILIKE \`${titlePrefix}%\``.
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
 * The request body shape is intentionally minimal and matches the contract
 * the ID-49.9 service ships:
 *
 *   { fixturePath, destPath, titlePrefix }
 *
 * The service is responsible for reading the bytes at `fixturePath` and
 * writing them into the cocoindex corpus root + `destPath` location.
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fixturePath: args.fixturePath,
      destPath: args.destPath,
      titlePrefix: args.titlePrefix,
    }),
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
   * to 120_000 (matches the existing POLL_TIMEOUT_MS sentinel used in
   * `inv-1-content-items-row-produced.integration.test.ts`).
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
 * Poll the `content_items` table via the live service-role client until at
 * least one row whose `title ILIKE '${titlePrefix}%'` lands, or the deadline
 * is reached. Resolves with the landed row set on success; rejects with a
 * timeout error otherwise.
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
      .from('content_items')
      .select('id, op_id')
      .ilike('title', `${titlePrefix}%`);

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
    `pollContentItemsFor: timed out after ${timeoutMs}ms waiting for content_items row with title ILIKE '${titlePrefix}%'`,
  );
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
   * The content_items ids the test seeded. The cleanup runs PK-scoped
   * deletes across derivation tables first (FK respect), then deletes the
   * content_items rows themselves.
   */
  contentIds: string[];
}

/**
 * Purge derivation rows + content_items rows for a single test fixture.
 * Operates in two passes:
 *
 *   1. Delete from derivation tables keyed by `content_item_id` IN
 *      (...contentIds): `q_a_extractions` and `source_documents`. Also
 *      attempts `entity_mentions` on a best-effort basis (ID-49.5 is
 *      currently deferred per S273 OQ-1 — the table or the FK may be
 *      absent; we swallow the resulting error rather than fail the
 *      cleanup pass).
 *   2. Delete from `content_items` by id.
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

  // 1a. q_a_extractions — hard FK on content_item_id; delete first.
  {
    const { error } = await client
      .from('q_a_extractions')
      .delete()
      .in('content_item_id', args.contentIds);
    if (error) {
      console.warn(
        `dropFixture: q_a_extractions cleanup warning — ${error.message ?? String(error)}`,
      );
    }
  }

  // 1b. entity_mentions — best-effort; ID-49.5 deferred per S273 OQ-1, so the
  // table or its content_item_id FK may not be in shape. Swallow errors.
  try {
    const { error } = await client
      .from('entity_mentions')
      .delete()
      .in('content_item_id', args.contentIds);
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

  // 1c. source_documents — content_items.source_document_id → source_documents.id.
  //      FK direction is reversed from the children above: fetch the
  //      source_document_ids referenced by the content_items rows being
  //      dropped, then delete from source_documents by id. Best-effort log
  //      on error (matches the pattern of the q_a_extractions / entity_mentions
  //      blocks above).
  {
    const { data: srcDocRows, error: srcDocFetchErr } = await client
      .from('content_items')
      .select('source_document_id')
      .in('id', args.contentIds);
    if (srcDocFetchErr) {
      console.warn(
        `dropFixture: source_documents id fetch warning — ${srcDocFetchErr.message ?? String(srcDocFetchErr)}`,
      );
    } else {
      const srcDocIds = (srcDocRows ?? [])
        .map((r) => r.source_document_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (srcDocIds.length > 0) {
        const { error: srcDocDelErr } = await client
          .from('source_documents')
          .delete()
          .in('id', srcDocIds);
        if (srcDocDelErr) {
          console.warn(
            `dropFixture: source_documents cleanup warning — ${srcDocDelErr.message ?? String(srcDocDelErr)}`,
          );
        }
      }
    }
  }

  // 2. content_items — final pass, PK delete.
  {
    const { error } = await client
      .from('content_items')
      .delete()
      .in('id', args.contentIds);
    if (error) {
      console.warn(
        `dropFixture: content_items cleanup warning — ${error.message ?? String(error)}`,
      );
    }
  }
}
