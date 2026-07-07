/**
 * GET /api/okf/[bundleId]/graph — the PRIMARY read for the `{132.14}`
 * G-VIEWER bundle viewer (TECH-ADDENDUM-reference-agents.md Part 2 §Target
 * TS surface).
 *
 * Server-side loader behind `app/okf/[bundleId]/page.tsx`. Reads the
 * client-owned bundle working tree directly (Reframe B — the viewer's
 * primary data source is the BUNDLE, not `api.*`): builds the concept graph
 * (`lib/okf/bundle-graph.ts`, the ported `generator.py`), parses `index.md`
 * for the `<BundleNav>` progressive-disclosure tree (falling back to `null`
 * when absent — soft-dep `{132.10}`, `<BundleNav>` groups by `type`
 * instead), and parses `log.md` for `<BundleLog>`.
 *
 * AUTHED — deliberately NOT added to `proxy.ts` `publicRoutes`. No specific
 * role restriction beyond authentication (default `getAuthorisedClient()`
 * roles): this is a read-only internal viewer, not a public/write surface.
 *
 * `api.*` (ID-131 G-API, inherited) is NOT read here — that is the
 * secondary resource-resolution lane, `GET /api/okf/resource`, hit lazily on
 * a `resource:` pointer click.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { buildBundleGraph } from '@/lib/okf/bundle-graph';
import { parseBundleNav } from '@/lib/okf/parse-index';
import { parseBundleLog } from '@/lib/okf/parse-log';
import { resolveOkfBundleRoot } from '@/lib/okf/resolve-bundle-root';

type RouteContext = { params: Promise<{ bundleId: string }> };

const INDEX_FILE = 'index.md';
const LOG_FILE = 'log.md';

export const GET = defineRoute(
  z.unknown(),
  async (_request: NextRequest, context: RouteContext) => {
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

      const graph = buildBundleGraph(bundleRoot);

      const indexPath = path.join(bundleRoot, INDEX_FILE);
      const nav = fs.existsSync(indexPath)
        ? parseBundleNav(fs.readFileSync(indexPath, 'utf-8'))
        : null;

      const logPath = path.join(bundleRoot, LOG_FILE);
      const log = fs.existsSync(logPath)
        ? parseBundleLog(fs.readFileSync(logPath, 'utf-8'))
        : [];

      return NextResponse.json({ ...graph, nav, log });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to build bundle graph') },
        { status: 500 },
      );
    }
  },
);
