/**
 * GET /api/okf/resource?uri=canonical://... — the SECONDARY resource-
 * resolution lane for the `{132.14}` G-VIEWER bundle viewer
 * (TECH-ADDENDUM-reference-agents.md Part 2 §Reframe B).
 *
 * The bundle graph itself never reads `api.*` (see `graph/route.ts`) — this
 * is the ONE place the viewer touches ID-131's G-API surface, gated behind a
 * `resource:` frontmatter pointer click in `<ConceptDetail>`. Per-row
 * pointers (`canonical://source_documents/<uuid>`,
 * `canonical://reference_items/<uuid>`) resolve a single record; the
 * `q_a_pairs` corpus is NEVER addressed by row (BI-7 — its
 * `gen_random_uuid()` PK is not bundle-cited) — only a `scope_tag` filter
 * (BI-8), returning a list.
 *
 * `record_embeddings` is deliberately NOT resolvable here (it is the
 * producer's write target, BI-25 — never a viewer read, per the addendum's
 * `{132.14}` details correction).
 *
 * AUTHED — not in `proxy.ts` publicRoutes. `getAuthorisedClient()`/
 * `tryQuery()` per the quality bars; `.from(table)` resolves to `api.table`
 * at runtime (`lib/supabase/schema.ts` DB_OPTION), never `public.table`
 * directly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseCanonicalResourceUri } from '@/lib/okf/parse-canonical-uri';
import { tryQuery } from '@/lib/supabase/safe';

export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const uri = request.nextUrl.searchParams.get('uri');
    if (!uri) {
      return NextResponse.json(
        { error: 'uri query param is required' },
        { status: 400 },
      );
    }

    const ref = parseCanonicalResourceUri(uri);
    if (!ref) {
      return NextResponse.json(
        { error: 'Unrecognised canonical:// resource uri' },
        { status: 400 },
      );
    }

    if (ref.table === 'source_documents' || ref.table === 'reference_items') {
      const result = await tryQuery(
        supabase.from(ref.table).select('*').eq('id', ref.id).maybeSingle(),
        `okf.resource.${ref.table}`,
      );
      if (!result.ok) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              result.error,
              'Failed to resolve resource pointer',
            ),
          },
          { status: 500 },
        );
      }
      if (!result.data) {
        return NextResponse.json(
          { error: 'Resource not found' },
          { status: 404 },
        );
      }
      return NextResponse.json({ table: ref.table, record: result.data });
    }

    // q_a_pairs — a filtered LIST, never a row (BI-8).
    if ('scopeTag' in ref) {
      const result = await tryQuery(
        supabase
          .from('q_a_pairs')
          .select('*')
          .contains('scope_tag', [ref.scopeTag]),
        'okf.resource.q_a_pairs.scope_tag',
      );
      if (!result.ok) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              result.error,
              'Failed to resolve q_a_pairs resource pointer',
            ),
          },
          { status: 500 },
        );
      }
      return NextResponse.json({
        table: 'q_a_pairs',
        records: result.data ?? [],
      });
    }

    // domain+subtopic form: q_a_pairs carries no domain/subtopic column
    // directly (checked against the live schema at implementation time) —
    // deliberately unresolved rather than silently mis-filtering. See the
    // Executor's discrepancy report.
    return NextResponse.json(
      {
        error:
          'canonical://q_a_pairs?domain=&subtopic= resolution is not yet implemented',
      },
      { status: 501 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to resolve resource pointer') },
      { status: 500 },
    );
  }
});
