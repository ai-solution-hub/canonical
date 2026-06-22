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
import type { Database, Json } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const maxDuration = 60;

/**
 * Derive a non-empty filename for the source_documents provenance row.
 *
 * `source_documents.filename` is NOT NULL. The last path segment is preferred,
 * but a path-less URL (e.g. `https://host/`) has an empty last segment — fall
 * back to the host so a path-less URL still yields a non-empty filename (else
 * the RPC insert 500s on the NOT NULL constraint). ID-110 {110.6} ENG-FIX.
 */
function deriveFilename(normalised: string): string {
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

// TODO(OPS-T1): author ResponseSchema
export const POST = withRequestContext(
  defineRoute(z.unknown(), async (request: NextRequest) => {
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

      // `body` is the cleaned text; `extractor` drives the {112.9} RPC derivation
      // of extraction_method; the metadata fields populate the source_documents
      // provenance row.
      let body: string;
      let title: string;
      let summarySource: string | null;
      let extractor: 'trafilatura' | 'unpdf';
      let mimeType: string;
      let pageCount: number | undefined;

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
        extractor = 'unpdf';
        mimeType = 'application/pdf';
        pageCount = pdf.pageCount;
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
        extractor = 'trafilatura';
        mimeType = 'text/html';
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

      // 9. Classification — POPULATE-UNLESS-ERROR (ID-110 {110.6} DELTA c).
      // Run the pure classifyText() classifier UNCONDITIONALLY to populate
      // primary_domain/primary_subtopic; pass NULL ONLY if it throws. The
      // reference columns are nullable and reference_search projects both for a
      // later backfill, but null-when-inconvenient is avoidable data skew, so we
      // classify here in-request (the manual path is now lighter than before —
      // no entity/temporal/summary passes).
      let primaryDomain: string | null = null;
      let primarySubtopic: string | null = null;
      try {
        const { classifyText } = await import('@/lib/ai/classify');
        const classified = await classifyText({
          supabase,
          title,
          content: body,
        });
        primaryDomain = classified.primary_domain;
        primarySubtopic = classified.primary_subtopic;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`Classification failed: ${msg}`);
      }

      // 10. Provenance fields for the source_documents row (TECH §1.4/§1.5).
      // filename guarded non-empty (source_documents.filename NOT NULL — ENG-FIX).
      // mimeType + extractor are resolved at the extraction branch above:
      // HTML → text/html + 'trafilatura' (PI-11: drives the {112.9} RPC
      // derivation of extraction_method); PDF → application/pdf + 'unpdf'.
      const filename = deriveFilename(normalised);
      const fileSize = Buffer.byteLength(body);
      const contentHash = createHash('sha256').update(body).digest('hex');
      const extractionMetadata: Json = {
        extractor,
        via: 'app_sync_url_import',
        ...(pageCount && { page_count: pageCount }),
      };

      // summary: the HTML path derives an excerpt / og:description locally; PDF
      // has none. References carry the feed-declared summary, so the excerpt is
      // the closest manual-path equivalent (a full generateSummary pass is
      // content_items-only).
      const summary = summarySource;

      // 11. Write the evidence pair via the owner-gated reference_ingest RPC
      // (atomic sd + ri, server-side uuid5 PKs, ON CONFLICT idempotency).
      //
      // The generated RPC Args type marks p_summary / p_primary_domain /
      // p_primary_subtopic / p_embedding / p_published_at as required `string`
      // because the type generator cannot infer SQL nullability — but the RPC
      // body inserts each straight into a NULLABLE column, so NULL is valid at the
      // DB. We cast the nullable fields at this boundary; the DB is the source of
      // truth (migration 20260614010200).
      const ingestArgs = {
        p_source_url: normalised,
        p_title: title || filename,
        p_body: body,
        p_summary: summary,
        p_primary_domain: primaryDomain,
        p_primary_subtopic: primarySubtopic,
        p_embedding: embeddingValue,
        p_published_at: null,
        p_filename: filename,
        p_mime_type: mimeType,
        p_file_size: fileSize,
        p_content_hash: contentHash,
        p_extraction_metadata: extractionMetadata,
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

      // 12. Reduced response (TECH §3.1–§3.3) — no content_type / suggested_layer
      // / topic_suggestion / guide_section_suggestions / duplicate_matches.
      return NextResponse.json({
        id: row.reference_id,
        title: row.title,
        source_url: normalised,
        summary: row.summary,
        primary_domain: row.primary_domain,
        primary_subtopic: row.primary_subtopic,
        warnings,
        dedup_status: 'clean' as const,
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
