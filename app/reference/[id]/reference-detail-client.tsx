'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, FileText, RefreshCcw } from 'lucide-react';
import { ContentRenderer } from '@/components/item-detail/content-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateUK, formatFileSize } from '@/lib/format';
import type {
  ReferenceDetail,
  ReferenceSourceDocument,
} from '@/types/reference';

/**
 * Read-only reference detail surface for `/reference/[id]` (ID-111.7).
 *
 * Renders the verbatim reference (title, markdown body via the shared
 * `ContentRenderer`, summary, domain/subtopic/layer badges, outbound
 * `source_url`, UK-formatted `published_at`) plus the B-28 provenance block.
 * No write/edit/governance/star/tag controls (PRODUCT.md B-3, B-24) — the only
 * interactive affordances are outbound links and the error-state retry.
 *
 * Spec: PRODUCT.md B-1..B-7, B-27, B-28, B-2, B-26; TECH.md Seam 2.
 */

/**
 * Map `reference_items.ingestion_source` to a plain-language line (B-2).
 * Never surfaces the raw enum (`rss_feed` / `url_import`).
 */
function ingestionSourceLabel(
  source: ReferenceDetail['ingestion_source'],
): string {
  switch (source) {
    case 'rss_feed':
      return 'From an RSS feed';
    case 'url_import':
      return 'Imported from URL';
    default:
      // Exhaustive on the narrowed union; defensive fallback for forward-compat.
      return 'From a source document';
  }
}

/**
 * Map `source_documents.extraction_method` to a plain-language line (B-28).
 * The column is a CHECK-constrained text with producer-prefixed values
 * (`pullmd_*`, `docling*`, `trafilatura*`); we surface the producer in plain
 * language and never the raw enum value.
 */
function extractionMethodLabel(method: string | null): string | null {
  if (!method) return null;
  const lower = method.toLowerCase();
  if (lower.startsWith('pullmd')) return 'Extracted via pullmd';
  if (lower.startsWith('docling')) return 'Extracted via Docling';
  if (lower.startsWith('trafilatura')) return 'Extracted via Trafilatura';
  return 'Extracted from a source document';
}

interface ReferenceDetailClientProps {
  reference: ReferenceDetail;
  /**
   * The B-28 source_documents join result, or `null` when the secondary read
   * failed (graceful degradation — the page still renders, falling back to the
   * ingestion_source line only).
   */
  sourceDocument: ReferenceSourceDocument | null;
}

export function ReferenceDetailClient({
  reference,
  sourceDocument,
}: ReferenceDetailClientProps) {
  const publishedLabel = reference.published_at
    ? formatDateUK(reference.published_at)
    : 'No publication date';

  const extractionLabel = sourceDocument
    ? extractionMethodLabel(sourceDocument.extraction_method)
    : null;
  const landedLabel = sourceDocument
    ? formatDateUK(sourceDocument.created_at)
    : null;
  const documentName = sourceDocument
    ? (sourceDocument.original_filename ?? sourceDocument.filename)
    : null;

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <nav className="mb-6">
        <Link
          href="/reference"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to references
        </Link>
      </nav>

      <header className="mb-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {reference.title}
        </h1>

        {(reference.primary_domain ||
          reference.primary_subtopic ||
          reference.layer) && (
          <div className="flex flex-wrap gap-2">
            {reference.primary_domain && (
              <Badge variant="secondary">{reference.primary_domain}</Badge>
            )}
            {reference.primary_subtopic && (
              <Badge variant="outline">{reference.primary_subtopic}</Badge>
            )}
            {reference.layer && (
              <Badge variant="outline">{reference.layer}</Badge>
            )}
          </div>
        )}

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Published</dt>
            <dd>{publishedLabel}</dd>
          </div>
          {reference.source_url && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Source</dt>
              <dd>
                <a
                  href={reference.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  View source
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </dd>
            </div>
          )}
        </dl>
      </header>

      {reference.summary && (
        <section
          aria-label="Summary"
          className="mb-8 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed text-foreground"
        >
          {reference.summary}
        </section>
      )}

      <section aria-label="Reference content" className="mb-10">
        {reference.body ? (
          <ContentRenderer content={reference.body} />
        ) : (
          <p className="text-sm text-muted-foreground">
            This reference has no body content.
          </p>
        )}
      </section>

      <footer className="border-t border-border pt-6">
        <h2 className="mb-3 text-sm font-medium text-foreground">Provenance</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{ingestionSourceLabel(reference.ingestion_source)}</span>
          </li>
          {documentName && (
            <li className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {documentName}
                {sourceDocument && sourceDocument.file_size != null && (
                  <span className="text-muted-foreground/80">
                    {' '}
                    ({formatFileSize(sourceDocument.file_size)})
                  </span>
                )}
              </span>
            </li>
          )}
          {extractionLabel && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{extractionLabel}</span>
            </li>
          )}
          {landedLabel && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Fetched {landedLabel}</span>
            </li>
          )}
        </ul>
      </footer>
    </article>
  );
}

/**
 * Non-destructive error surface for the detail page (PRODUCT.md B-7). Shown
 * when the primary `reference_get_verbatim` read fails for a reason other than
 * not-found (transport/RPC error). Never a blank page; offers a retry.
 */
export function ReferenceDetailError() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">
        This reference could not be loaded
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Something went wrong while fetching this reference. This is usually
        temporary — please try again.
      </p>
      <Button onClick={() => window.location.reload()} variant="outline">
        <RefreshCcw className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
