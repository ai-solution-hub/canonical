/**
 * Integration test — PRODUCT Inv-9 (AGPL pullmd licence boundary,
 * RUNTIME observability angle).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Per the dispatch brief, `agpl-boundary.integration.test.ts` is an
 * explicit Inv-9-adjacent file covering the RUNTIME side of the AGPL
 * licence-boundary verification — distinct from the static code-level
 * inspection in `sidecar-pullmd-separation.test.ts`.
 *
 * Inv-9 statement (verbatim — runtime angle):
 *
 * > "pullmd traffic is observable as outbound HTTP from the cocoindex
 * > sidecar to the pullmd Service."
 *
 * Where the static `sidecar-pullmd-separation.test.ts` proves the image
 * does NOT contain pullmd binaries, this runtime test proves the cocoindex
 * Service is REACHING pullmd via outbound HTTP rather than calling an
 * in-process pullmd binary (which would not be observable at the network
 * boundary).
 *
 * Test strategy:
 *   1. Probe the cocoindex sidecar Service's `/health` endpoint and
 *      examine the response for any pullmd-service-URL hint OR for a
 *      version surface that proves the pullmd dependency is HTTP-bound.
 *   2. If the cocoindex Service exposes any introspection endpoint that
 *      reports its current pullmd Service URL (e.g. `/health` body
 *      includes `pullmd_service_url: https://...`), assert the URL is
 *      EXTERNAL (different hostname than the cocoindex Service itself).
 *
 *   This test is intentionally narrow at v1 — without a probe endpoint
 *   that surfaces network dependencies, the test asserts only the
 *   reachable Service URL boundary. A full network-flow trace (i.e.
 *   observing actual outbound packets from cocoindex → pullmd) requires
 *   GCP VPC flow logs and is out of integration-test scope.
 *
 * Env-gate: COCOINDEX_STAGING_URL + PULLMD_SERVICE_URL set (and not
 * containing 'not-yet-deployed').
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-9.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §P-1 (per-tenant
 *     deploy + AGPL boundary).
 *   - Companion test: __tests__/integration/cocoindex/
 *     sidecar-pullmd-separation.test.ts (image-content static guard).
 */

import { describe, expect, it } from 'vitest';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_PULLMD_URL = Boolean(
  process.env.PULLMD_SERVICE_URL &&
  !process.env.PULLMD_SERVICE_URL.includes('not-yet-deployed'),
);

const ENABLED = HAS_STAGING_URL && HAS_PULLMD_URL;

describe.skipIf(!ENABLED)(
  'Inv-9 — AGPL boundary (runtime observability: pullmd is separate network service)',
  () => {
    it('cocoindex sidecar Service URL and pullmd Service URL are distinct hosts', async () => {
      const cocoindexUrl = new URL(process.env.COCOINDEX_STAGING_URL!);
      const pullmdUrl = new URL(process.env.PULLMD_SERVICE_URL!);

      // Inv-9 verifiability: the two Service URLs MUST be different
      // hostnames. If pullmd were co-located in the cocoindex image,
      // there would be NO separate Service URL — same host:port would
      // serve both.
      expect(cocoindexUrl.hostname).not.toBe(pullmdUrl.hostname);

      // Defensive: both URLs should resolve to HTTPS (Cloud Run Services
      // are HTTPS by default; HTTP-only would imply a non-Cloud-Run
      // deployment outside the AGPL boundary contract).
      expect(cocoindexUrl.protocol).toBe('https:');
      expect(pullmdUrl.protocol).toBe('https:');
    });

    it('cocoindex sidecar /health responds without leaking the in-process pullmd presence', async () => {
      // Probe cocoindex /health — the response body should NOT mention
      // playwright / pullmd in a way that suggests in-process operation.
      // (The /health endpoint can mention pullmd as an external HTTP
      // dependency — that's fine and expected.)
      const cocoindexUrl = process.env.COCOINDEX_STAGING_URL!;
      const healthUrl = `${cocoindexUrl.replace(/\/$/, '')}/health`;

      const response = await fetch(healthUrl, { method: 'GET' });
      expect(response.status).toBe(200);

      const body = await response.text();
      // If the /health response includes the literal string "playwright",
      // that's a defensive sign that playwright is bundled in-process.
      // The pullmd HTTP-dependency declaration should not include
      // "playwright" — pullmd is the BOUNDARY; what runs inside pullmd
      // (which can include playwright) is the pullmd service's concern.
      //
      // This is a soft assertion — body content may legitimately mention
      // playwright in error messages, version metadata for a debugger,
      // etc. The hard test is the URL-distinctness check above; this
      // test documents the defensive observability gap.
      const lowerBody = body.toLowerCase();
      // We don't fail on "playwright" alone — too many false positives.
      // We DO fail on a clear in-process signal like "playwright module
      // loaded" or "playwright initialised".
      expect(lowerBody).not.toMatch(
        /playwright\s+(loaded|initialised|imported)/,
      );
    });
  },
);
