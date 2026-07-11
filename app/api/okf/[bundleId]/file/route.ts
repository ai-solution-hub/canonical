/**
 * GET /api/okf/[bundleId]/file?path=… — the per-file text read behind the
 * `/okf` full-bundle file-explorer render pane (ID-132 {132.32}
 * G-LANDING-IMPL, OKF-LANDING.md LI-15/LI-16/LI-17).
 *
 * `path` is a bundle-root-relative path taken from a `GET
 * /api/okf/[bundleId]/tree` node the caller already has. Two independent
 * server-side guards, defense-in-depth style (matching this surface's auth
 * posture elsewhere):
 *
 *   1. **`.md`-only (LI-16).** Only markdown files are ever served as render-
 *      ready text — `ontology.json` (or any other non-markdown tree entry)
 *      is rejected with 400 rather than silently rendered. The render pane
 *      never even needs to special-case a "declined to render" branch for a
 *      fetch that already 400s.
 *   2. **Traversal containment (LI-17).** `resolveBundleTreePath` (same
 *      containment discipline as `bundle-graph.ts:extractLinks`) rejects any
 *      path resolving outside the bundle root — `../`, absolute, or a
 *      resolved escape — with 400, before any `fs` read is attempted.
 *   3. **Symlink containment (LI-17 hardening, security blocker fix).**
 *      `resolveBundleTreePath` already re-verifies containment against the
 *      REAL (symlink-resolved) filesystem path via
 *      `assertRealpathWithinBundleRoot` — this route calls that SAME check
 *      again immediately before `fs.readFileSync`, defense in depth against
 *      a committed symlink in the client-owned, externally-synced bundle
 *      repo (DR-016) whose target resolves outside the bundle root.
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
import {
  assertRealpathWithinBundleRoot,
  resolveBundleTreePath,
} from '@/lib/okf/walk-bundle-tree';
import { parseSearchParams } from '@/lib/validation';
import type { OkfBundleFileResult } from '@/lib/query/okf';

type RouteContext = { params: Promise<{ bundleId: string }> };

const fileQuerySchema = z.object({ path: z.string().min(1) });

export const GET = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    context: RouteContext,
  ): Promise<NextResponse<OkfBundleFileResult> | NextResponse> => {
    try {
      const auth = await getAuthorisedClient();
      if (!auth.success) return authFailureResponse(auth);

      const { bundleId } = await context.params;

      const parsedQuery = parseSearchParams(
        fileQuerySchema,
        request.nextUrl.searchParams,
      );
      if (!parsedQuery.success) return parsedQuery.response;
      const { path: relPath } = parsedQuery.data;

      if (!relPath.endsWith('.md')) {
        return NextResponse.json(
          { error: 'Only markdown files can be rendered' },
          { status: 400 },
        );
      }

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

      let filePath: string;
      try {
        filePath = resolveBundleTreePath(bundleRoot, relPath);
      } catch {
        return NextResponse.json(
          { error: 'Invalid file path' },
          { status: 400 },
        );
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // Defense-in-depth re-check immediately before the read (see file-level
      // doc comment, guard 3) — a committed symlink resolving outside the
      // bundle root must never reach fs.readFileSync, which follows it
      // transparently.
      try {
        assertRealpathWithinBundleRoot(bundleRoot, filePath);
      } catch {
        return NextResponse.json(
          { error: 'Invalid file path' },
          { status: 400 },
        );
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return NextResponse.json({ path: relPath, content });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to read bundle file') },
        { status: 500 },
      );
    }
  },
);
