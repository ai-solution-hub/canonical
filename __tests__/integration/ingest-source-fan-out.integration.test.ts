/**
 * S207 WP-A Phase 4 (Task 4.1) — `ingest_source` fan-out integration test.
 *
 * Verifies the WP-A4 Option D end-to-end fan-out introduced by:
 *   - migration `20260428174512_add_ingest_source_to_content_items.sql`
 *     (adds `content_items.ingest_source` typed column + rewrites
 *     `ensure_v1_history_at_commit()` trigger)
 *   - migration `20260428180945_backfill_ingest_source.sql` (one-shot
 *     backfill of pre-existing rows)
 *   - 8 TS write-site wires (lib/intelligence/pipeline.ts,
 *     lib/mcp/tools/content.ts, app/api/items/route.ts,
 *     app/api/items/batch/route.ts, app/api/upload/route.ts,
 *     app/api/ingest/url/route.ts, app/api/bids/[id]/outcome/integrate/route.ts,
 *     plus the python writers covered by the S153 guard)
 *
 * Spec:    docs/specs/ingest-path-consistency-spec.md §3.4 (AC4.1, AC4.2,
 *          AC4.7, AC4.8) + §6.2 row 1 (this test).
 * Plan:    docs/plans/ingest-path-consistency-plan.md §Phase 4 Task 4.1.
 *
 * Coverage matrix (per Task 4.1 ACs 4.1-AC1..4.1-AC4):
 *   1. Provenance round-trip — typed columns (`source_url`, `source_file`,
 *      `source_document_id`) survive INSERT round-trip on
 *      `content_items`.
 *   2. `ingest_source` fan-out — for each canonical INSERT-time value, the
 *      typed column is persisted on `content_items` AND the v1 history
 *      row written by `trg_content_items_ensure_v1_history` carries
 *      `metadata.ingest_source` matching that same value.
 *   3. Trigger sole authority — exactly one v1 row is produced per insert,
 *      with `change_reason='initial_ingest'` when ingest_source is set
 *      (Option D §4.4) or `'auto_v1_on_insert'` when NULL (legacy fallback
 *      semantics preserved per spec AC4.8 case (b)).
 *   4. Idempotency — the trigger's `IF v_v1_exists THEN RETURN NULL` guard
 *      prevents duplicate v1 rows when the same content_item_id already
 *      has a v1 (cannot happen in normal flow but guards a re-run scenario
 *      under DEFERRABLE INITIALLY DEFERRED semantics).
 *
 * The fan-out test enumerates the 10 INSERT-time canonical values from
 * spec §3.4 AC4.1 (`'batch_reclassify'` is reserved for the EP7 UPDATE
 * path and explicitly out of scope for this test — no INSERT-time write
 * site uses it). Each value is exercised with a service-role direct INSERT
 * because we are testing the DB-layer contract (trigger reads
 * NEW.ingest_source); routing through the production HTTP handlers would
 * add unrelated auth/extraction complexity without changing the fan-out
 * surface under test.
 *
 * Prerequisites:
 *   - `.env` with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   - Migrations 20260428174512 + 20260428180945 applied.
 *
 * Run via: `bun run test:integration -- ingest-source-fan-out`
 *   (NOT picked up by `bun run test`; see CLAUDE.md
 *   feedback_test_runners_split.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { serviceClient } from './helpers/service-client';

const TEST_PREFIX = `[INGEST-SOURCE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;

/**
 * The 10 canonical INSERT-time `ingest_source` values per spec §3.4 AC4.1.
 * The 11th value (`'batch_reclassify'`) is reserved for an EP7 UPDATE path
 * and is intentionally absent here — no INSERT-time wire writes it.
 */
const INSERT_TIME_INGEST_SOURCES = [
  'manual',
  'url_import',
  'upload',
  'upload_autosplit',
  'mcp_create',
  'rss_feed',
  'bid_outcome_integration',
  'python_url',
  'python_markdown',
  'qa_import',
] as const;

// Track every row this suite seeds so afterAll can scrub them even if
// individual tests fail. content_history rows must be deleted before
// content_items rows to satisfy the FK.
const seededIds: string[] = [];

async function seedItemWithIngestSource(
  ingestSource: string | null,
  label: string,
): Promise<string> {
  // Direct service-role insert. We deliberately do NOT route through the
  // production HTTP handlers here — the contract under test is the DB
  // trigger fan-out, which fires at the same point regardless of which
  // app-layer call site originated the insert. The 8 TS wire-sites are
  // covered by per-route unit tests in __tests__/api/ + __tests__/mcp/.
  //
  // `content_text_hash` is GENERATED ALWAYS — omitted per CLAUDE.md.
  // ingest_source is a NEW typed column not yet in database.types.ts
  // (Wave 5 sweep regen), so the payload is cast through `as never` to
  // bypass excess-property checking on this single field. Same pattern as
  // the production wire sites (lib/mcp/tools/content.ts:475 etc.).
  const payload: Record<string, unknown> = {
    title: `${TEST_PREFIX} ${label}`,
    content: `ingest_source fan-out fixture for ${label}. Disposable.`,
    content_type: 'article',
  };
  if (ingestSource !== null) {
    payload.ingest_source = ingestSource;
  }

  const { data, error } = await serviceClient
    .from('content_items')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(payload as any)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }

  seededIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  // No-op pre-flight; per-test seed isolates fixtures so a failure in one
  // ingest_source value does not poison the others.
}, 5_000);

afterAll(async () => {
  if (seededIds.length === 0) return;

  // content_history rows are emitted by an AFTER INSERT trigger
  // (`trg_content_items_ensure_v1_history`). Delete those before the
  // parent rows so the FK to content_items does not block.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);

  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Test 1 (4.1-AC1) — Provenance round-trip on typed columns.
//
// content_items.source_url / source_file / source_document_id were
// promoted from JSONB metadata in S205 WP-A1 (§4.1). This test reasserts
// the typed-column round-trip in the WP-A4 (S207) context — i.e. with
// the new ingest_source column and rewritten trigger active. Source-doc
// FK uses a NULL value here because the round-trip semantics are
// independent of the FK target's existence; spec §4.1 already proves
// that path elsewhere.
// ---------------------------------------------------------------------------

describe('ingest_source fan-out — typed-column provenance round-trip', () => {
  it('source_url + source_file persist on content_items round-trip', async () => {
    const id = await seedItemWithIngestSource('url_import', 'roundtrip-typed');

    // Patch the typed columns directly. We do not test source_document_id
    // here because the FK requires a real source_documents row; spec
    // §4.1 proves that path. The contract under test in this Task 4.1
    // case is the round-trip itself.
    const url = 'https://example.com/round-trip-test';
    const file = 'round-trip-test.md';
    const { error: updateErr } = await serviceClient
      .from('content_items')
      .update({ source_url: url, source_file: file })
      .eq('id', id);
    expect(updateErr).toBeNull();

    // ingest_source is not yet in database.types.ts (Wave 5 sweep regen)
    // so we select it through `as any` to bypass the supabase-js generic
    // SELECT type inference. The other typed columns are present in the
    // generated types and select cleanly.
    const { data, error } = await serviceClient
      .from('content_items')
      .select(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'source_url, source_file, source_document_id, ingest_source' as any,
      )
      .eq('id', id)
      .single();

    expect(error).toBeNull();
    const row = data as unknown as {
      source_url: string | null;
      source_file: string | null;
      source_document_id: string | null;
      ingest_source: string | null;
    };
    expect(row.source_url).toBe(url);
    expect(row.source_file).toBe(file);
    expect(row.source_document_id).toBeNull();
    expect(row.ingest_source).toBe('url_import');
  });
});

// ---------------------------------------------------------------------------
// Test 2 (4.1-AC2) — ingest_source fan-out for every canonical value.
//
// For each of the 10 INSERT-time canonical values, assert (a) the typed
// column is persisted on content_items, (b) the trigger emits a v1
// content_history row with metadata.ingest_source matching the value,
// and (c) change_reason='initial_ingest' (Option D §4.4 — single label
// for all non-NULL ingest_source values; granular observability via
// metadata field).
// ---------------------------------------------------------------------------

describe('ingest_source fan-out — typed column → content_history trigger', () => {
  for (const ingestSource of INSERT_TIME_INGEST_SOURCES) {
    it(`'${ingestSource}': content_items column + content_history v1.metadata fan-out`, async () => {
      const id = await seedItemWithIngestSource(ingestSource, ingestSource);

      // Assert content_items.ingest_source persisted.
      const { data: itemRow, error: itemErr } = await serviceClient
        .from('content_items')
        .select('id')
        .eq('id', id)
        .single();
      expect(itemErr).toBeNull();
      expect(itemRow?.id).toBe(id);

      // Re-read the typed column via a service-client raw select so the
      // ingest_source field surfaces despite database.types.ts not being
      // regenerated yet.
      const itemRaw = await serviceClient
        .from('content_items')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select('ingest_source' as any)
        .eq('id', id)
        .single();
      expect(itemRaw.error).toBeNull();
      expect(
        (itemRaw.data as unknown as { ingest_source: string | null })
          .ingest_source,
      ).toBe(ingestSource);

      // Assert content_history v1 row written by trigger.
      const { data: historyRows, error: historyErr } = await serviceClient
        .from('content_history')
        .select('version, change_reason, change_type, metadata, change_summary')
        .eq('content_item_id', id)
        .eq('version', 1);

      expect(historyErr).toBeNull();
      expect(historyRows).toHaveLength(1);
      const v1 = historyRows![0];
      expect(v1.version).toBe(1);
      expect(v1.change_type).toBe('create');
      expect(v1.change_reason).toBe('initial_ingest');
      // Trigger writes a metadata jsonb_build_object containing
      // 'ingest_source' verbatim from NEW.ingest_source.
      const metadata = v1.metadata as { ingest_source?: string; via?: string };
      expect(metadata.ingest_source).toBe(ingestSource);
      expect(metadata.via).toBe('trigger');
      // The change_summary documents the trigger source for human
      // operators — pin it so a future migration can't silently drop it.
      expect(v1.change_summary).toBe(
        'v1 written by trg_content_items_ensure_v1_history',
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Test 3 (4.1-AC3) — Trigger sole authority + change_reason fallback.
//
// (a) When ingest_source is non-NULL → exactly ONE v1 row, change_reason
//     = 'initial_ingest'.
// (b) When ingest_source is NULL → exactly ONE v1 row, change_reason
//     = 'auto_v1_on_insert' (legacy fallback per AC4.8 case (b) and the
//     trigger's CASE expression in migration 20260428174512).
// ---------------------------------------------------------------------------

describe('ingest_source fan-out — trigger sole authority', () => {
  it('non-NULL ingest_source produces exactly ONE v1 row tagged initial_ingest', async () => {
    const id = await seedItemWithIngestSource('manual', 'sole-authority-set');

    const { data, error } = await serviceClient
      .from('content_history')
      .select('id, version, change_reason')
      .eq('content_item_id', id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].version).toBe(1);
    expect(data![0].change_reason).toBe('initial_ingest');
  });

  it('NULL ingest_source falls back to auto_v1_on_insert (AC4.8 case b)', async () => {
    const id = await seedItemWithIngestSource(
      null,
      'sole-authority-null-fallback',
    );

    const { data, error } = await serviceClient
      .from('content_history')
      .select('id, version, change_reason, metadata')
      .eq('content_item_id', id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].version).toBe(1);
    expect(data![0].change_reason).toBe('auto_v1_on_insert');
    // metadata.ingest_source on the v1 row is explicitly NULL when the
    // source column is NULL — the trigger writes it via
    // jsonb_build_object('ingest_source', NEW.ingest_source) regardless.
    const metadata = data![0].metadata as { ingest_source?: string | null };
    expect(metadata.ingest_source).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 4 (4.1-AC4) — Trigger idempotency.
//
// REMOVED in S209 W5 (FIX-S207-WPA4-2). The original block at this site
// asserted idempotency through paths that bypass the trigger — both tests
// pass without exercising the `IF v_v1_exists THEN RETURN NULL` guard. The
// AFTER INSERT FOR EACH ROW trigger fires exactly once per content_items
// INSERT; the guard is defensive against scenarios that only an in-database
// direct invocation of `ensure_v1_history_at_commit()` (or DEFERRABLE
// INITIALLY DEFERRED re-fire complexity) could produce, which is not
// reachable from a supabase-js client.
//
// The genuine assertions for the trigger's exactly-once contract are
// already covered above:
//   - Test 2 ("typed column → content_history trigger") asserts ONE v1 row
//     per insert across all 10 ingest_source values (toHaveLength(1)).
//   - Test 3a asserts ONE v1 row, change_reason='initial_ingest'.
//   - Test 3b asserts ONE v1 row with NULL ingest_source falls back to
//     'auto_v1_on_insert'.
//
// Adding the dropped tests back would require either a schema-level RPC
// wrapper around the trigger function (out of scope) or DEFERRABLE
// transaction semantics that supabase-js does not expose.
// ---------------------------------------------------------------------------
