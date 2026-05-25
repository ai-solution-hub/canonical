/**
 * Integration test — PRODUCT Inv-7 (extractor binary availability per MIME).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-7 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Every extractor invocation the pipeline makes — Docling for
 * > PDF/DOCX/XLSX; pullmd for HTML — succeeds against the sidecar's runtime
 * > environment for the supported MIME set, even when the orchestrator
 * > Vercel host has no local extractor binary. The orchestrator MUST NOT
 * > attempt to invoke an extractor binary in-process at the Vercel layer.
 * > Verifiable: ingest one file of each MIME (PDF, DOCX, XLSX, HTML,
 * > markdown) end-to-end via the canonical pipeline; each lands a
 * > `content_items` row with non-empty `content` text."
 *
 * Test strategy:
 *   Drop one fixture per MIME type into the source-binding location, then
 *   poll Supabase for the resulting `content_items` rows. Each row MUST
 *   have non-empty `content_text` — empty content proves the extractor
 *   was not invoked OR the extractor failed silently (broken Inv-7).
 *
 * PullMD HTML branch — secondary env gate:
 *   The HTML MIME path requires the pullmd AGPL sidecar to be deployed
 *   (PULLMD_SERVICE_URL secret in GCP Secret Manager). Per S258 W2 close
 *   the PULLMD_SERVICE_URL is a placeholder pending ID-42 deferral. When
 *   PULLMD_SERVICE_URL contains 'not-yet-deployed' or is missing, the
 *   HTML sub-assertion skips cleanly while PDF/DOCX/XLSX/markdown still
 *   assert.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase. Skip-clean local.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-7.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-7.
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md §1 (supported MIME
 *     set: PDF/DOCX/XLSX/HTML/markdown).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

// PullMD secondary env gate — when not yet deployed, HTML sub-assertion
// skips cleanly per the dispatch brief.
const PULLMD_READY = Boolean(
  process.env.PULLMD_SERVICE_URL &&
  !process.env.PULLMD_SERVICE_URL.includes('not-yet-deployed'),
);

const TEST_PREFIX = `[28.18-INV07-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 180_000;

// MIME-set-to-fixture map. The fixture files are deferred to the
// fixture-staging endpoint substrate; this file documents the FUTURE
// contract.
type MimeKind = 'pdf' | 'docx' | 'xlsx' | 'html' | 'markdown';

const MIME_SET: { kind: MimeKind; fileSuffix: string; pullmdGated: boolean }[] =
  [
    { kind: 'markdown', fileSuffix: '.md', pullmdGated: false },
    { kind: 'pdf', fileSuffix: '.pdf', pullmdGated: false },
    { kind: 'docx', fileSuffix: '.docx', pullmdGated: false },
    { kind: 'xlsx', fileSuffix: '.xlsx', pullmdGated: false },
    { kind: 'html', fileSuffix: '.html', pullmdGated: true },
  ];

beforeAll(async () => {
  if (!ENABLED) return;
  // FUTURE: drop one fixture per MIME kind via the fixture-staging endpoint.
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  await client.from('content_items').delete().in('id', seededContentIds);
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-7 — sidecar extractor coverage across supported MIME set',
  () => {
    for (const mime of MIME_SET) {
      const shouldSkipForPullmd = mime.pullmdGated && !PULLMD_READY;
      const testFn = shouldSkipForPullmd ? it.skip : it;

      testFn(
        `lands a content_items row with non-empty content_text for ${mime.kind.toUpperCase()} MIME`,
        async () => {
          const client = await createLiveServiceClient();

          const deadline = Date.now() + POLL_TIMEOUT_MS;
          let landedRow: { id: string; content_text: string } | null = null;

          while (Date.now() < deadline) {
            const { data } = await client
              .from('content_items')
              .select('id, content_text')
              .ilike('title', `${TEST_PREFIX}-${mime.kind}%`)
              .limit(1);

            if (data && data.length > 0 && data[0]!.content_text) {
              landedRow = {
                id: data[0]!.id as string,
                content_text: data[0]!.content_text as string,
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
          expect(landedRow!.content_text.length).toBeGreaterThan(0);
        },
        POLL_TIMEOUT_MS + 30_000,
      );
    }
  },
);
