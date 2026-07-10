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
 *   poll Supabase for the resulting `source_documents` rows (ID-131.19 M6
 *   retirement: content_items DROPPED at M6). Each row MUST have non-empty
 *   `extracted_text` — empty content proves the extractor was not invoked
 *   OR the extractor failed silently (broken Inv-7).
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
  hasLiveDbCredentials,
} from '../helpers/supabase-client';
import { stageFixture } from './_helpers/fixture-staging';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

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
  // holds source_documents.id values (see pollContentItemsFor's M6 retarget).
  await client.from('source_documents').delete().in('id', seededContentIds);
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-7 — sidecar extractor coverage across supported MIME set',
  () => {
    for (const mime of MIME_SET) {
      it(
        `lands a source_documents row with non-empty extracted_text for ${mime.kind.toUpperCase()} MIME`,
        async () => {
          const client = await createLiveServiceClient();

          const deadline = Date.now() + POLL_TIMEOUT_MS;
          let landedRow: { id: string; extracted_text: string } | null = null;

          while (Date.now() < deadline) {
            // ID-131.19 M6 retirement: content_items DROPPED at M6;
            // source_documents.filename replaces title, extracted_text
            // replaces content_text.
            const { data } = await client
              .from('source_documents')
              .select('id, extracted_text')
              .ilike('filename', `${TEST_PREFIX}-${mime.kind}%`)
              .limit(1);

            if (data && data.length > 0 && data[0]!.extracted_text) {
              landedRow = {
                id: data[0]!.id as string,
                extracted_text: data[0]!.extracted_text as string,
              };
              seededContentIds.push(landedRow.id);
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, 3_000));
          }

          // Inv-7 verifiability: each MIME fixture MUST land a row with
          // non-empty content. Empty / null content proves the extractor
          // wasn't invoked or failed silently.
          expect(landedRow).not.toBeNull();
          expect(landedRow!.extracted_text.length).toBeGreaterThan(0);
        },
        POLL_TIMEOUT_MS + 30_000,
      );
    }
  },
);
