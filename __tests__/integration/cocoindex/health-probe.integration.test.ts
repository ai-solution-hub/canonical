/**
 * Integration test — PRODUCT Inv-6 (sidecar Service availability).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-6 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "The cocoindex pipeline executes inside a Cloud Run Service (not a
 * > Vercel function, not a Cloud Run Job at v1 per O-Q2), and that Service
 * > is reachable at a stable Service URL from the orchestrator-side Vercel
 * > routes. Verifiable: an HTTP health probe to the sidecar's `/health`
 * > (or equivalent) returns `200 OK` from the Vercel host within the
 * > Cloud Run Service warm-start window."
 *
 * Per TECH §2.10 Inv-6 maps to "(workflow step + smoke deploy verify)" —
 * NOT a distinct test file. However the dispatch brief explicitly calls
 * for `health-probe.integration.test.ts` (Inv-6) as part of the 19-file
 * acceptance scope. This file lands the integration-test substrate for
 * Inv-6 so the acceptance criterion is satisfied both at the workflow-
 * step level (the CI smoke deploy verify) AND at the test-file level
 * (this file's runtime probe).
 *
 * Empirical grounding: per 28.15 server.py the sidecar HTTP wrapper
 * exposes ONLY `/health` (no `/trigger`, no `/run`). The endpoint is the
 * canonical reachability probe; flow execution is fs-watch driven (not
 * HTTP-driven).
 *
 * Env-gate: COCOINDEX_STAGING_URL only. Skip-clean locally pending
 * staging deploy.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-6.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-6
 *     (workflow step + smoke deploy verify).
 *   - scripts/cocoindex_pipeline/server.py (the /health endpoint).
 */

import { describe, expect, it } from 'vitest';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);

const ENABLED = HAS_STAGING_URL;

// Cloud Run warm-start window per Inv-6 — the probe must complete within
// the Service's serve-time budget; on a cold start the first probe can
// hit 10-15s. Allow 30s before declaring the Service unreachable.
const PROBE_TIMEOUT_MS = 30_000;

describe.skipIf(!ENABLED)(
  'Inv-6 — sidecar Service availability (HTTP /health probe returns 200)',
  () => {
    it('GET /health returns 200 OK within the warm-start window', async () => {
      const serviceUrl = process.env.COCOINDEX_STAGING_URL!;
      const healthUrl = `${serviceUrl.replace(/\/$/, '')}/health`;

      const controller = new AbortController();
      const timeoutHandle = setTimeout(
        () => controller.abort(),
        PROBE_TIMEOUT_MS,
      );

      let response: Response;
      try {
        response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal,
          // Allow Cloud Run to issue any caching headers it likes — we
          // assert on the status code only.
        });
      } finally {
        clearTimeout(timeoutHandle);
      }

      // Inv-6 verifiability: HTTP 200 OK proves the sidecar is reachable
      // and the wrapper process is up. Any non-200 indicates either a
      // deploy failure or a runtime crash; both break Inv-6.
      expect(response.status).toBe(200);

      // Defensive: the response body should be valid JSON or a non-empty
      // string — empty body suggests a Cloud Run proxy returned the 200
      // before the Service actually emitted anything (broken wrapper).
      const body = await response.text();
      expect(body.length).toBeGreaterThan(0);
    }, PROBE_TIMEOUT_MS + 10_000);
  },
);
