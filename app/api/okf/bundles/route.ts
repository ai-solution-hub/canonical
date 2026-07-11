/**
 * GET /api/okf/bundles — the root-enumeration read behind the `/okf` landing
 * (ID-132 {132.32} G-LANDING-IMPL, OKF-LANDING.md LI-3(a)/LI-14).
 *
 * Enumerates every immediate subdirectory of `OKF_BUNDLE_ROOT` (one client
 * bundle per subdir). Unlike `app/api/okf/[bundleId]/graph/route.ts` (which
 * 500s when `OKF_BUNDLE_ROOT` is unset — a fail-loud per-bundle read),
 * this route degrades gracefully (LI-4(a)/(b)): the `/okf` landing surfaces
 * to every authenticated user via the nav flip (LI-7) before any bundle is
 * configured, so an unset/blank root, or a root with zero bundle subdirs,
 * both resolve to a 200 response with an empty `bundles` list — never a
 * crash. `configured` distinguishes the two empty cases for the landing's
 * copy (LI-4(a) "not configured" vs LI-4(b) "configured, no bundles yet").
 *
 * AUTHED — deliberately NOT added to `proxy.ts` `publicRoutes` (LI-2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { enumerateOkfBundles } from '@/lib/okf/enumerate-bundles';
import { resolveOkfBundleRootDirOrNull } from '@/lib/okf/resolve-bundle-root';
import type { OkfBundleListResult } from '@/lib/query/okf';

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
  ): Promise<NextResponse<OkfBundleListResult> | NextResponse> => {
    try {
      const auth = await getAuthorisedClient();
      if (!auth.success) return authFailureResponse(auth);

      const configured = resolveOkfBundleRootDirOrNull() !== null;
      const bundles = configured ? enumerateOkfBundles() : [];

      return NextResponse.json({ bundles, configured });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to enumerate OKF bundles') },
        { status: 500 },
      );
    }
  },
);
