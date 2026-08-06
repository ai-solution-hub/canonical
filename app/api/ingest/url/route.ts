import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { normaliseUrl } from '@/lib/extraction/url-normalise';
import { validateUrl } from '@/lib/extraction/url-validation';
import { logger, updateRequestContext, withRequestContext } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { IngestUrlBodySchema } from '@/lib/validation/ingest-schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

/**
 * Derive a non-empty title fallback from the URL (last path segment, else
 * host). id-417 / DR-124: the source_documents provenance shell this used to
 * name is gone — reference_ingest lands reference_items ONLY; this now only
 * backstops an empty extracted title.
 */
function deriveTitleFallback(normalised: string): string {
  try {
    const parsed = new URL(normalised);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last || parsed.hostname;
  } catch {
    // normaliseUrl already validated the URL upstream; defence-in-depth.
    return normalised;
  }
}

const IngestUrlResponseSchema = z.union([
  // Idempotency hit — existing reference returned.
  z.object({
    url_already_exists: z.literal(true),
    existing_item: z.object({
      id: z.string(),
      title: z.string().nullable(),
    }),
  }),
  // Newly-ingested reference (reduced response, TECH §3.1–§3.3). summary
  // comes from the reference_ingest RPC row and lands in a nullable column,
  // so model it nullable. (id-417 / DR-130: the domain fields retired with
  // the subject-taxonomy axis.)
  z.object({
    id: z.string(),
    title: z.string().nullable(),
    source_url: z.string(),
    summary: z.string().nullable(),
    warnings: z.array(z.string()),
  }),
]);

export const POST = withRequestContext(
  defineRoute(IngestUrlResponseSchema, async (request: NextRequest) => {
    try {
      // 1. Auth check: editor or admin
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase, role } = auth;

      // Upgrade the request scope with the resolved user so subsequent
      // log lines + any Sentry events carry userId/userRole.
      updateRequestContext({ userId: user.id, userRole: role });

      // 2. Rate limit: 10 req/min
      const rl = checkRateLimit(`ingest:url:${user.id}`, 10, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      // 3. Parse and validate request body
      const raw = await request.json();
      const parsed = parseBody(IngestUrlBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const { url } = parsed.data;

      // 4. SSRF validation
      const urlCheck = validateUrl(url);
      if (!urlCheck.valid) {
        return NextResponse.json({ error: urlCheck.error }, { status: 400 });
      }

      // Normalise the URL so the reference identity (uuid5 PK, minted server-side
      // by reference_ingest) is stable and matches the async feed path's
      // normalise_url. All downstream identity + dedup keys off this value.
      const normalised = normaliseUrl(url);

      // 5. Idempotency / URL-exists check (TECH §2.2) — re-pointed to the
      // reference layer. reference_items has no archived_at; a hit returns the
      // existing reference so the form's existing-item branch is unchanged.
      const existing = await sb(
        supabase
          .from('reference_items')
          .select('id, title')
          .eq('source_url', normalised)
          .limit(1)
          .maybeSingle(),
        'reference_items.byUrl',
      );

      if (existing) {
        return NextResponse.json({
          url_already_exists: true,
          existing_item: { id: existing.id, title: existing.title },
        });
      }

      // 6. Extract content from URL (lazy imports for serverless) — OQ-B body
      // producer. reference_items.body is NOT NULL.
      //
      // {112.10}: the route owns the SSRF-gated fetch (`fetchForExtraction`,
      // which keeps `validateUrl` + the 20 MB cap + redirect re-validation) and
      // then hands HTML to the B1 `/extract` PURE CLEANER via `cleanViaWorker`
      // (Trafilatura, in-house parity with the cocoindex worker). The PDF branch
      // stays IN-PROCESS via unpdf. There is deliberately NO in-process
      // Readability fallback — a fallback would keep @mozilla/readability alive
      // past the {112.13} deletion (PI-1/PI-2/PI-9).
      const { fetchForExtraction, extractHtmlMetadata } =
        await import('@/lib/extraction/url');
      const warnings: string[] = [];

      // `body` is the cleaned text. (id-417 / DR-124: the extractor/mime/
      // page-count provenance fields retired with the sd shell — the
      // reference item IS the record.)
      let body: string;
      let title: string;
      let summarySource: string | null;

      let fetched: Awaited<ReturnType<typeof fetchForExtraction>>;
      try {
        fetched = await fetchForExtraction(url);
      } catch (err) {
        // A blocked redirect / over-cap / upstream fetch failure is a content
        // problem with the requested URL, not an extraction-service outage.
        return NextResponse.json(
          { error: safeErrorMessage(err, 'Failed to fetch URL') },
          { status: 422 },
        );
      }

      if (fetched.kind === 'pdf') {
        // PDF: clean in-process via unpdf (the pure cleaner is HTML-only).
        const { extractPdfText } = await import('@/lib/extraction/pdf');
        const pdf = await extractPdfText(fetched.buffer);
        body = pdf.text;
        title = '';
        summarySource = null;
      } else {
        // HTML: hand the already-fetched bytes to the B1 /extract pure cleaner.
        // SOFT COUPLE (load-bearing): an unreachable endpoint / non-2xx / unset
        // config throws `ExtractEndpointError` → recoverable 503 (NOT a 500, and
        // NO Readability fallback). The 503 (outage) is DISTINCT from the 422
        // REJECT verdict (content too short) handled below.
        const { cleanViaWorker, ExtractEndpointError } =
          await import('@/lib/extraction/clean-via-worker');
        let cleaned;
        try {
          cleaned = await cleanViaWorker(fetched.html, fetched.finalUrl);
        } catch (err) {
          if (err instanceof ExtractEndpointError) {
            logger.warn(
              { err, op: 'ingest_url', stage: 'extract_endpoint' },
              '/extract cleaner unavailable',
            );
            return NextResponse.json(
              {
                error:
                  'Content extraction is temporarily unavailable. Please retry shortly.',
              },
              { status: 503 },
            );
          }
          throw err;
        }

        // 7. Quality gate (TECH §4.4 / PI-5) — driven by the endpoint verdict:
        // REJECT → 422 (preserves the prior <100-char 422), WARN → warning.
        if (cleaned.verdict === 'reject') {
          return NextResponse.json(
            {
              error:
                'Could not extract meaningful content from this page (less than 100 characters)',
            },
            { status: 422 },
          );
        }
        if (cleaned.warnings.length > 0) {
          warnings.push(...cleaned.warnings);
        }

        const meta = extractHtmlMetadata(fetched.html);
        body = cleaned.text;
        title = meta.title;
        summarySource = meta.excerpt || meta.ogDescription || null;
      }

      // 8. Embedding for reference_items.embedding
      const { generateEmbedding } = await import('@/lib/ai/embed');
      const embeddingText = `${title}\n\n${body}`;
      let embeddingValue: string | null = null;
      try {
        const embeddingArray = await generateEmbedding(embeddingText);
        embeddingValue = JSON.stringify(embeddingArray);
      } catch {
        warnings.push('Embedding generation failed');
      }

      // (Step 9 — classification — retired: id-417 / DR-130, the subject
      // taxonomy and the classifyText stage are gone.)

      // 9. Title fallback: guarded non-empty (reference_items.title NOT NULL).
      const titleFallback = deriveTitleFallback(normalised);

      // summary: the HTML path derives an excerpt / og:description locally; PDF
      // has none. References carry the feed-declared summary, so the excerpt is
      // the closest manual-path equivalent.
      const summary = summarySource;

      // 10. Land the reference via the owner-gated reference_ingest RPC
      // (id-417 / DR-124: reference_items ONLY — no source_documents shell,
      // server-side uuid5 PK, already_existed idempotency, record_embeddings
      // dual-write).
      //
      // NOTE (post-regen straggler): the generated Args type still carries the
      // OLD 14-param shape until the types regen after the id-417 migration
      // applies; the cast below bridges that window and can then be dropped.
      const ingestArgs = {
        p_source_url: normalised,
        p_title: title || titleFallback,
        p_body: body,
        p_summary: summary,
        p_embedding: embeddingValue,
        p_published_at: null,
      };
      const ingested = await sb(
        supabase.rpc(
          'reference_ingest',
          ingestArgs as unknown as Database['public']['Functions']['reference_ingest']['Args'],
        ),
        'reference_items.ingest',
      );

      const row = Array.isArray(ingested) ? ingested[0] : ingested;
      if (!row) {
        return NextResponse.json(
          { error: 'Failed to create reference item' },
          { status: 500 },
        );
      }

      // (Step 11b — sd attribution — retired with the sd shell, id-417 /
      // DR-124: reference_ingest no longer mints a source_documents row.)

      // 12. Reduced response (TECH §3.1–§3.3) — no content_type / suggested_layer
      // / topic_suggestion / guide_section_suggestions / duplicate_matches.
      return NextResponse.json({
        id: row.reference_id,
        title: row.title,
        source_url: normalised,
        summary: row.summary,
        warnings,
      });
    } catch (err) {
      logger.error({ err, op: 'ingest_url' }, 'Failed to ingest URL');
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to ingest URL') },
        { status: 500 },
      );
    }
  }),
);
