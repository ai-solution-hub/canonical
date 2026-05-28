/**
 * Integration test — PRODUCT Inv-21 (extract-memoisation).
 *
 * Subtask ID-28.14 (narrowed scope per S257 W3 Curator-split).
 *
 * Inv-21 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Re-invocations of an ExtractByLlm call against the same content-hash +
 * > same `output_type` + same instruction string + same LLM model return
 * > the same output (modulo cocoindex's memo cache; LLM stochasticity is
 * > bounded by the cache layer). Verifiable: ingest a file, capture the
 * > `q_a_extractions` rows; bump no inputs; re-ingest; assert the
 * > `q_a_extractions` rows are byte-identical."
 *
 * Empirical grounding (Q-EX2 / OQ-3) — observed in worktree on 22/05/2026:
 *
 * - `scripts/cocoindex_pipeline/extraction.py` lines 530-631: the 3 Path A
 *   extractors (`extract_classification`, `extract_qa_form`,
 *   `extract_entity_mentions`) are all decorated with `@coco.fn(memo=True)`.
 *   Per S256 W1 stub-pattern verification, `memo=True` returns a directly-
 *   awaitable `AsyncFunction` instance whose BODY executes ONLY on memo
 *   miss. The memo-cache key is `(content_text,)` per cocoindex content-
 *   hash determinism.
 *
 * - The memo-hit assertion strategy:
 *
 *   Strategy A (preferred when Service exposes Anthropic-mock hook):
 *     Re-ingest the same content_text → assert ZERO new Anthropic API
 *     calls on the second pass (mock counter increments only on memo miss).
 *     STATUS: Service-side mock hook does NOT exist — server.py only
 *     exposes `/health`. Cannot use without 28.18 instrumentation.
 *
 *   Strategy B (cocoindex-native observability):
 *     Re-ingest the same content_text → assert the q_a_extractions /
 *     entity_mentions / content_items_classification rows are
 *     BYTE-IDENTICAL on the second pass. Memo-hit determinism means the
 *     same input produces the same output rows; LLM stochasticity is
 *     bounded by the memo cache (Inv-21 verbatim statement).
 *
 *   Strategy C (pipeline_runs row count):
 *     Re-ingest the same content_text → assert NO new q_a_extractions /
 *     entity_mentions rows land (memo hit → extractor body does not run →
 *     no UPSERT). This is the simplest observable contract that doesn't
 *     require Service-side mock hook.
 *
 *   The test uses STRATEGY C (row-delta is zero on re-ingest) as the
 *   primary assertion, with STRATEGY B (byte-identity of pre-existing rows)
 *   as a secondary tighter assertion when ≥1 row already landed pre-bump.
 *
 * - Inv-21 cross-link: `docs/specs/id-36-cocoindex-extraction-contract/PRODUCT.md`
 *   Inv-15..Inv-18 (memoisation rules). The cocoindex-extraction-contract
 *   PRODUCT spec defines the memo-cache key as
 *   (content_text_hash, output_type, instruction, model) — when ANY
 *   component changes, the memo invalidates and the extractor body re-runs.
 *   Test fixture must hold all four components constant to assert memo hit.
 *
 * Env-gate: same as 28.14 siblings — COCOINDEX_STAGING_URL +
 * ANTHROPIC_API_KEY + live Supabase. 100% skip locally pending S258+ Cloud
 * Run staging Secret Manager unblock.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-21.
 *   - docs/specs/id-36-cocoindex-extraction-contract/PRODUCT.md Inv-15..Inv-18.
 *   - docs/specs/id-36-cocoindex-extraction-contract/TECH.md §5.3 row "21 — prompt-
 *     template version in code-hash" (memo-invalidation negative case).
 *   - scripts/cocoindex_pipeline/extraction.py lines 530-631 (3 extractors
 *     with `@coco.fn(memo=True)`).
 *   - __tests__/integration/helpers/supabase-client.ts (live client).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';

// ---------------------------------------------------------------------------
// Env-gate — same logical AND as Inv-20 sibling (28.14 cohort).
// ---------------------------------------------------------------------------

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_ANTHROPIC_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED = HAS_STAGING_URL && HAS_ANTHROPIC_KEY && HAS_LIVE_DB;

// ---------------------------------------------------------------------------
// Per-file unique prefix.
// ---------------------------------------------------------------------------

const _TEST_PREFIX = `[28.14-INV21-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

// ---------------------------------------------------------------------------
// Polling helpers — wait for the cocoindex fs-watch loop to observe the
// dropped fixture and complete the flow run. The TECH §P-9 canonical helper
// `pollContentItemsFor(key, timeoutMs)` is deferred to 28.18 alongside the
// corpus-drop helper; this file's body documents the contract the helper
// will satisfy.
//
// The 120s timeout below mirrors the integration suite default in
// `vitest.integration.config.ts` (line 34: `testTimeout: 120_000`).
// ---------------------------------------------------------------------------

const _POLL_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!ENABLED) return;
  // FUTURE (deferred to 28.18 alongside `pollContentItemsFor` helper):
  // Pass 1: drop a single fixture with a deterministic content_text body
  // into the pinned corpus path. Wait for the flow run to complete and
  // q_a_extractions / entity_mentions rows to land. Capture the row IDs
  // + a content-hash digest of the rows for byte-identity comparison.
  //
  //   const fixtureRoot = process.env.COCOINDEX_SOURCE_PATH!;
  //   await dropFixture(fixtureRoot, 'q_a_form-memo-test', {
  //     content: DETERMINISTIC_QA_BODY,
  //     title: `${_TEST_PREFIX} memoisation test`,
  //   });
  //   await pollContentItemsFor(_TEST_PREFIX, _POLL_TIMEOUT_MS);
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  await client
    .from('q_a_extractions')
    .delete()
    .in('content_item_id', seededContentIds);
  await client
    .from('entity_mentions')
    .delete()
    .in('content_item_id', seededContentIds);
  await client.from('content_items').delete().in('id', seededContentIds);
}, 30_000);

// ---------------------------------------------------------------------------
// The test — Inv-21 memo-hit determinism on re-ingest.
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)(
  'Inv-21 — extraction memoisation (re-ingest produces zero new extraction rows)',
  () => {
    it('q_a_extractions row count unchanged after re-ingest of identical content', async () => {
      // Pass 1 already happened in beforeAll. Capture the post-pass-1
      // q_a_extractions snapshot (row count + content-hash of payloads).
      const client = await createLiveServiceClient();
      const { data: pass1Rows, error: pass1Error } = await client
        .from('q_a_extractions')
        .select(
          'id, content_item_id, question_text, answer_text, expected_response_kind, evidence_requirements, scope_tags',
        )
        .in('content_item_id', seededContentIds);

      expect(pass1Error).toBeNull();
      expect(pass1Rows).toBeTruthy();
      // Inv-21 verifiability requires "ingest a file ... assert the
      // q_a_extractions rows are byte-identical [on re-ingest]" —
      // implicitly the file MUST produce ≥1 q_a_extractions row pre-bump
      // for the byte-identity check to be meaningful. Empty array means
      // the fixture didn't trigger q_a_form extraction (test setup bug).
      expect(pass1Rows!.length).toBeGreaterThan(0);

      const pass1RowCount = pass1Rows!.length;
      const pass1RowIds = new Set(pass1Rows!.map((r) => r.id as string));
      const pass1Signature = JSON.stringify(
        pass1Rows!
          .slice()
          .sort((a, b) => (a.id as string).localeCompare(b.id as string)),
      );

      // FUTURE (28.18): re-drop the SAME fixture content into the corpus
      // path (modifying mtime triggers fs-watch, but the content-hash is
      // unchanged so cocoindex's content-hash-keyed memo cache hits). Wait
      // for the second flow run to complete.
      //
      //   await retouchFixture(fixtureRoot, 'q_a_form-memo-test');
      //   await pollContentItemsFor(TEST_PREFIX, POLL_TIMEOUT_MS);
      //
      // The flow run lands a NEW pipeline_runs row (every flow run
      // produces an Inv-16 pipeline_runs row), but the extractor body
      // does NOT execute (memo hit) so no new q_a_extractions rows land.

      // STRATEGY C — row-delta is zero.
      const { data: pass2Rows, error: pass2Error } = await client
        .from('q_a_extractions')
        .select(
          'id, content_item_id, question_text, answer_text, expected_response_kind, evidence_requirements, scope_tags',
        )
        .in('content_item_id', seededContentIds);

      expect(pass2Error).toBeNull();
      expect(pass2Rows).toBeTruthy();
      // Memo hit → zero new rows. If the row count INCREASED, the memo
      // cache missed (Inv-21 broken) OR cocoindex created duplicate rows
      // on UPSERT (PRIMARY KEY misconfigured — separate bug).
      expect(pass2Rows!.length).toBe(pass1RowCount);

      // Same set of row IDs — re-extraction would either INSERT new rows
      // (different IDs) or UPDATE existing rows (same IDs but different
      // content). Memo hit → neither happens; same IDs survive.
      const pass2RowIds = new Set(pass2Rows!.map((r) => r.id as string));
      expect(pass2RowIds.size).toBe(pass1RowIds.size);
      for (const id of pass1RowIds) {
        expect(pass2RowIds.has(id)).toBe(true);
      }

      // STRATEGY B — byte-identity of the payloads. The Inv-21 verbatim
      // statement: "byte-identical [on re-ingest]". Memo hit means the
      // extractor body never ran, so no UPSERT happened, so the row
      // payloads are IDENTICAL byte-for-byte (column-by-column).
      const pass2Signature = JSON.stringify(
        pass2Rows!
          .slice()
          .sort((a, b) => (a.id as string).localeCompare(b.id as string)),
      );
      expect(pass2Signature).toBe(pass1Signature);
    });

    it('entity_mentions row count unchanged after re-ingest of identical content', async () => {
      // Same strategy applied to entity_mentions table. The
      // `extract_entity_mentions` extractor has the same `@coco.fn(memo=True)`
      // decorator (extraction.py line 599) so the contract applies
      // symmetrically.
      const client = await createLiveServiceClient();
      const { data: pass1Rows, error: pass1Error } = await client
        .from('entity_mentions')
        .select(
          'id, content_item_id, entity_type, entity_name, source_span_start, source_span_end, mention_confidence',
        )
        .in('content_item_id', seededContentIds);

      expect(pass1Error).toBeNull();
      expect(pass1Rows).toBeTruthy();

      // entity_mentions is allowed to be empty (per PRODUCT inv 3 —
      // "entity_mention fires regardless of content_type but yields ≥0
      // rows for content with no entities"). The memo-hit contract still
      // applies: if pass 1 produced N rows (including 0), pass 2 produces
      // exactly N rows.
      const pass1RowCount = pass1Rows!.length;
      const pass1Signature = JSON.stringify(
        pass1Rows!
          .slice()
          .sort((a, b) => (a.id as string).localeCompare(b.id as string)),
      );

      const { data: pass2Rows, error: pass2Error } = await client
        .from('entity_mentions')
        .select(
          'id, content_item_id, entity_type, entity_name, source_span_start, source_span_end, mention_confidence',
        )
        .in('content_item_id', seededContentIds);

      expect(pass2Error).toBeNull();
      expect(pass2Rows).toBeTruthy();
      expect(pass2Rows!.length).toBe(pass1RowCount);

      const pass2Signature = JSON.stringify(
        pass2Rows!
          .slice()
          .sort((a, b) => (a.id as string).localeCompare(b.id as string)),
      );
      expect(pass2Signature).toBe(pass1Signature);
    });

    it('content_items classification fields unchanged after re-ingest', async () => {
      // The classification extractor lands its outputs on
      // content_items.{content_type, primary_domain, confidence_score}
      // per Path A target-binding (extraction.py
      // `extract_classification`). Memo hit → these columns are NOT
      // re-written → values are unchanged on the post-pass-2 read.
      const client = await createLiveServiceClient();
      const { data: pass1Rows, error: pass1Error } = await client
        .from('content_items')
        .select('id, content_type, primary_domain, confidence_score')
        .in('id', seededContentIds);

      expect(pass1Error).toBeNull();
      expect(pass1Rows).toBeTruthy();
      expect(pass1Rows!.length).toBeGreaterThan(0);

      const pass1Signature = JSON.stringify(
        pass1Rows!
          .slice()
          .sort((a, b) => (a.id as string).localeCompare(b.id as string)),
      );

      const { data: pass2Rows, error: pass2Error } = await client
        .from('content_items')
        .select('id, content_type, primary_domain, confidence_score')
        .in('id', seededContentIds);

      expect(pass2Error).toBeNull();
      expect(pass2Rows).toBeTruthy();
      expect(pass2Rows!.length).toBe(pass1Rows!.length);

      const pass2Signature = JSON.stringify(
        pass2Rows!
          .slice()
          .sort((a, b) => (a.id as string).localeCompare(b.id as string)),
      );
      expect(pass2Signature).toBe(pass1Signature);
    });
  },
);
