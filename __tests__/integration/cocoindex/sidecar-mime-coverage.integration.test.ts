/**
 * Integration test — PRODUCT Inv-7 (extractor binary availability per MIME).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-7 statement (verbatim from
 * `docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Every extractor invocation the pipeline makes — Docling for
 * > PDF/DOCX/XLSX — succeeds against the sidecar's runtime environment for
 * > the supported file-corpus MIME set, even when the orchestrator Vercel
 * > host has no local extractor binary. The orchestrator MUST NOT attempt
 * > to invoke an extractor binary in-process at the Vercel layer.
 * > Verifiable: ingest one file of each MIME (PDF, DOCX, XLSX, markdown)
 * > end-to-end via the canonical pipeline; each lands a `content_items`
 * > row with non-empty `content` text."
 *
 * Test strategy:
 *   Drop one fixture per MIME type into the source-binding location, then
 *   poll Supabase for the resulting `source_documents` row (ID-131.19 M6
 *   retirement: content_items DROPPED at M6) and its `content_chunks` rows.
 *   Each document MUST land at least one chunk with non-empty `content` —
 *   no chunks / empty content proves the extractor was not invoked OR the
 *   extractor failed silently (broken Inv-7).
 *
 *   id-392 M6 retarget: the extraction-proof assertion home is
 *   `content_chunks.content`, NOT `source_documents.extracted_text` — the
 *   pipeline writes the extracted body to `content_chunks` (ordered by
 *   `position`) and leaves `extracted_text` permanently NULL, so the prior
 *   extracted_text poll could never land. The poll idiom mirrors
 *   chunking.integration.test.ts (pollContentItemsFor →
 *   pollContentChunksFor).
 *
 * HTML is NOT a file-corpus MIME (ID-75 WP-D / ID-112.7): a `.html` file
 * staged into the localfs corpus fails LOUDLY (LocalfsHtmlRetiredError);
 * HTML content lands via the URL source, asserted by
 * `url-landing-set.integration.test.ts`. This file therefore covers only the
 * Docling/markdown file-corpus MIMEs.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase. Skip-clean local.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-7.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-7.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md §1 (supported
 *     file-corpus MIME set: PDF/DOCX/XLSX/markdown).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import {
  pollContentChunksFor,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
// The poll helpers (pollContentItemsFor/pollContentChunksFor) require REAL
// live-DB credentials (they throw on the setup.ts dummies), so gate on the
// tighter check — mirrors chunking.integration.test.ts.
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[28.18-INV07-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 180_000;

// MIME-set-to-fixture map. HTML is excluded — it is not a file-corpus MIME
// (ID-75 WP-D / ID-112.7); HTML lands via the URL source instead. Each
// fixture below is a real, checked-in file already proven to ingest via
// other enabled cocoindex integration tests in this directory.
type MimeKind = 'pdf' | 'docx' | 'xlsx' | 'markdown';

const MIME_SET: { kind: MimeKind; fileSuffix: string; fixturePath: string }[] =
  [
    {
      kind: 'markdown',
      fileSuffix: '.md',
      fixturePath: '__tests__/fixtures/cocoindex-chunking/short-clause.md',
    },
    {
      kind: 'pdf',
      fileSuffix: '.pdf',
      fixturePath:
        'docs/testing/test-data/templates/sq-standard-selection-questionnaire/standard-selection-questionnaire-ppn-03-24.pdf',
    },
    {
      kind: 'docx',
      fileSuffix: '.docx',
      fixturePath:
        'docs/testing/test-data/templates/rfp-british-council/annex_2_supplier_response.docx',
    },
    {
      kind: 'xlsx',
      fileSuffix: '.xlsx',
      fixturePath:
        'docs/testing/test-data/templates/rfp-british-council/annex_3_pricing_approach.xlsx',
    },
  ];

beforeAll(async () => {
  if (!ENABLED) return;
  // Drop one fixture per MIME kind via the fixture-staging endpoint.
  // Fire-and-forget (each `it` below polls for its own row) — the dest
  // filename embeds `${TEST_PREFIX}-${mime.kind}` so each MIME's poll
  // (`ilike filename '${TEST_PREFIX}-${mime.kind}%'`) matches only its own
  // fixture.
  await Promise.all(
    MIME_SET.map((mime) =>
      stageFixture({
        fixturePath: mime.fixturePath,
        destPath: `inv-7/${TEST_PREFIX}-${mime.kind}${mime.fileSuffix}`,
        titlePrefix: TEST_PREFIX,
      }),
    ),
  );
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  // ID-131.19 M6 retirement: content_items DROPPED at M6; seededContentIds
  // holds source_documents.id values. The chunk rows asserted below need no
  // separate delete: content_chunks_source_document_id_fkey is ON DELETE
  // CASCADE (20260628200000_id131_extract_reparent.sql).
  await client.from('source_documents').delete().in('id', seededContentIds);
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-7 — sidecar extractor coverage across supported MIME set',
  () => {
    for (const mime of MIME_SET) {
      it(
        `lands non-empty content_chunks rows for ${mime.kind.toUpperCase()} MIME`,
        async () => {
          // Wait for the pipeline to land the source_documents row for
          // this MIME's fixture (filename carries the per-kind prefix).
          const items = await pollContentItemsFor(
            `${TEST_PREFIX}-${mime.kind}`,
            { timeoutMs: POLL_TIMEOUT_MS },
          );
          expect(items.length).toBe(1);
          const parent = items[0]!;
          seededContentIds.push(parent.id);

          // Inv-7 verifiability (id-392 assertion home): the extracted body
          // lives in content_chunks.content, ordered by position. At least
          // one chunk with non-empty content proves the extractor ran and
          // produced text for this MIME; no chunks / whitespace-only
          // content proves it wasn't invoked or failed silently.
          const chunks = await pollContentChunksFor(parent.id, {
            timeoutMs: POLL_TIMEOUT_MS,
          });
          expect(chunks.length).toBeGreaterThan(0);
          for (const chunk of chunks) {
            expect(chunk.content.trim().length).toBeGreaterThan(0);
          }
        },
        // Two sequential polls (row, then chunks), each bounded by
        // POLL_TIMEOUT_MS.
        POLL_TIMEOUT_MS * 2 + 30_000,
      );
    }
  },
);
