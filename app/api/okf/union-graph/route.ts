/**
 * GET /api/okf/union-graph — the deployment-level UNION concept graph
 * (ID-132 {132.49} G-CONCEPT-GRAPH-UNION, owner-ratified NATIVE/extend path
 * per {132.39} decision memo §6).
 *
 * **Route-shape decision (journalled per the dispatch brief).** A NEW route,
 * not a widened param on `GET /api/okf/[bundleId]/graph`: a union spans
 * EVERY sibling bundle under `OKF_BUNDLE_ROOT`, which is orthogonal to a
 * single `bundleId` route param, and the union envelope has no per-bundle
 * `nav`/`log` (those are bundle-scoped concepts — `index.md`/`log.md`
 * belong to one bundle, not a merged deployment view). Overloading
 * `[bundleId]` with e.g. a sentinel value would have made the existing
 * route's `nav`/`log` fields meaningless for the union case; a distinct
 * envelope shape (`OkfUnionGraphEnvelope` — `nodes`/`edges`/`bodies`/`types`
 * only) earns a distinct route.
 *
 * Enumerates every configured bundleId (`enumerateOkfBundles`), resolves
 * each to its filesystem root, and merges via `buildUnionBundleGraph`
 * (`lib/okf/bundle-graph.ts`) — node/edge ids namespaced by bundleId.
 * Degrades gracefully like `GET /api/okf/bundles` (LI-4(a)/(b) precedent):
 * an unset/blank `OKF_BUNDLE_ROOT`, or a root with zero bundle subdirs,
 * both resolve to a 200 response with an empty graph — never a crash. A
 * single bundle whose root vanished between enumeration and build is
 * skipped by `buildUnionBundleGraph` itself (warning-logged, not fatal).
 *
 * AUTHED — deliberately NOT added to `proxy.ts` `publicRoutes`, matching
 * every other `/api/okf/*` route (all `/api/*` paths already skip the
 * proxy-level login redirect; each route re-checks auth server-side).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { buildUnionBundleGraph } from '@/lib/okf/bundle-graph';
import { enumerateOkfBundles } from '@/lib/okf/enumerate-bundles';
import { resolveOkfBundleRoot } from '@/lib/okf/resolve-bundle-root';
import type { OkfUnionGraphEnvelope } from '@/lib/query/okf';

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
  ): Promise<NextResponse<OkfUnionGraphEnvelope> | NextResponse> => {
    try {
      const auth = await getAuthorisedClient();
      if (!auth.success) return authFailureResponse(auth);

      const bundleIds = enumerateOkfBundles();
      const sources = bundleIds.map((bundleId) => ({
        bundleId,
        root: resolveOkfBundleRoot(bundleId),
      }));

      const graph = buildUnionBundleGraph(sources);

      return NextResponse.json(graph);
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            err,
            'Failed to build the union concept graph',
          ),
        },
        { status: 500 },
      );
    }
  },
);
