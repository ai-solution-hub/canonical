/**
 * GET /api/okf/[bundleId]/tree — the full-bundle file-explorer tree read
 * behind the `/okf` landing (ID-132 {132.32} G-LANDING-IMPL,
 * OKF-LANDING.md LI-15/LI-16).
 *
 * Distinct from `app/api/okf/[bundleId]/graph/route.ts` (which builds the
 * concept GRAPH, `.md`-only, for the `/okf/[bundleId]` viewer — unchanged,
 * LI-13): this lists the WHOLE bundle working tree (`lib/okf/walk-bundle-tree.ts`),
 * `ontology.json` included but flagged non-renderable (LI-16).
 *
 * Once a `bundleId` is in hand (the caller reached this route via a bundle
 * the `/api/okf/bundles` enumeration already surfaced), `OKF_BUNDLE_ROOT`
 * being unset is an unexpected/misconfigured state, not the LI-4(a) "no
 * bundle configured yet" case — so this route matches the existing
 * `[bundleId]/graph` route's fail-loud-on-unset-root convention (500), never
 * silently reinterpreting a real misconfiguration as an empty tree.
 *
 * AUTHED — deliberately NOT added to `proxy.ts` `publicRoutes` (LI-2).
 */
import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { resolveOkfBundleRoot } from '@/lib/okf/resolve-bundle-root';
import { walkBundleTree } from '@/lib/okf/walk-bundle-tree';
import type { OkfBundleTreeResult } from '@/lib/query/okf';

type RouteContext = { params: Promise<{ bundleId: string }> };

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    context: RouteContext,
  ): Promise<NextResponse<OkfBundleTreeResult> | NextResponse> => {
    try {
      const auth = await getAuthorisedClient();
      if (!auth.success) return authFailureResponse(auth);

      const { bundleId } = await context.params;

      let bundleRoot: string;
      try {
        bundleRoot = resolveOkfBundleRoot(bundleId);
      } catch (err) {
        return NextResponse.json(
          { error: safeErrorMessage(err, 'OKF bundle source not configured') },
          { status: 500 },
        );
      }

      if (!fs.existsSync(bundleRoot)) {
        return NextResponse.json(
          { error: 'Bundle not found' },
          { status: 404 },
        );
      }

      const tree = walkBundleTree(bundleRoot);
      return NextResponse.json({ tree });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to list bundle file tree') },
        { status: 500 },
      );
    }
  },
);
