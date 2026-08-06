'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, FileText, RefreshCcw } from 'lucide-react';
import { ContentRenderer } from '@/components/item-detail/content-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateUK } from '@/lib/format';
import type { ReferenceDetail } from '@/types/reference';

/**
 * Read-only reference detail surface for `/reference/[id]` (ID-111.7).
 *
 * Renders the verbatim reference (title, markdown body via the shared
 * `ContentRenderer`, summary, layer badge, outbound `source_url`,
 * UK-formatted `published_at`). No write/edit/governance/star/tag controls
 * (PRODUCT.md B-3, B-24) — the only interactive affordances are outbound
 * links and the error-state retry. (id-417 / DR-130 + DR-124: the
 * domain/subtopic badges and the B-28 source_documents provenance block
 * retired with the subject-taxonomy axis and the sd shell.)
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

interface ReferenceDetailClientProps {
  reference: ReferenceDetail;
}

export function ReferenceDetailClient({
  reference,
}: ReferenceDetailClientProps) {
  const publishedLabel = reference.published_at
    ? formatDateUK(reference.published_at)
    : 'No publication date';

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

        {reference.layer && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{reference.layer}</Badge>
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
