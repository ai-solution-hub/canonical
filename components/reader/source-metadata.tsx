'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

/**
 * Shape of a feed-articles + feed-sources join row, as returned by the
 * `app/item/[id]/page.tsx` fetcher. `null` when the item is not from a feed.
 *
 * Spec: `docs/specs/source-information-spec.md` §5.1.
 */
export interface FeedArticleJoin {
  /** `feed_articles.published_at` (timestamptz → ISO string). */
  published_at: string | null;
  feed_source: {
    name: string;
    url: string;
    source_type: 'rss' | 'web' | 'api';
  } | null;
}

interface SourceMetadataProps {
  contentType: string | null;
  platform: string | null;
  metadata: Record<string, unknown> | null;
  content?: string | null;

  // New additive props — all optional to preserve backwards compatibility
  // with the single existing call-site in `metadata-sidebar.tsx`.
  sourceFile?: string | null;
  sourceUrl?: string | null;
  classificationConfidence?: number | null;
  createdAt?: string | null;
  answerStandard?: string | null;
  answerAdvanced?: string | null;
  feedArticle?: FeedArticleJoin | null;
}

function MetadataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

function EmailFields({ metadata }: { metadata: Record<string, unknown> }) {
  const newsletterName = metadata?.newsletter_name as string | undefined;
  const emailSubject = metadata?.email_subject as string | undefined;
  const emailFrom = metadata?.email_from as string | undefined;

  const hasFields = newsletterName || emailSubject || emailFrom;
  if (!hasFields) return null;

  return (
    <>
      {newsletterName && (
        <MetadataRow label="Newsletter">{newsletterName}</MetadataRow>
      )}
      {emailSubject && (
        <MetadataRow label="Subject">{emailSubject}</MetadataRow>
      )}
      {emailFrom && <MetadataRow label="From">{emailFrom}</MetadataRow>}
    </>
  );
}

function PdfFields({ metadata }: { metadata: Record<string, unknown> }) {
  const pageCount = metadata?.page_count as number | undefined;

  if (pageCount == null) return null;

  return <MetadataRow label="Pages">{pageCount}</MetadataRow>;
}

function GenericWebFields({
  metadata,
  content,
}: {
  metadata: Record<string, unknown>;
  content?: string | null;
}) {
  const extractionSource = metadata?.extraction_source as string | undefined;
  const ogDescription = metadata?.og_description as string | undefined;
  const ogType = metadata?.og_type as string | undefined;
  const hasReaderHtml = !!metadata?.reader_html;
  const wordCount = content
    ? content.trim().split(/\s+/).filter(Boolean).length
    : null;

  const hasFields =
    extractionSource ||
    ogDescription ||
    ogType ||
    hasReaderHtml ||
    (wordCount && wordCount > 0);
  if (!hasFields) return null;

  return (
    <>
      {extractionSource && (
        <MetadataRow label="Extraction method">{extractionSource}</MetadataRow>
      )}
      {ogDescription && (
        <MetadataRow label="OG description">
          <span className="line-clamp-3">{ogDescription}</span>
        </MetadataRow>
      )}
      {ogType && <MetadataRow label="OG type">{ogType}</MetadataRow>}
      {hasReaderHtml && (
        <MetadataRow label="Reader view">Available</MetadataRow>
      )}
      {wordCount != null && wordCount > 0 && (
        <MetadataRow label="Word count">
          {wordCount.toLocaleString('en-GB')}
        </MetadataRow>
      )}
    </>
  );
}

function IngestionRow({ metadata }: { metadata: Record<string, unknown> }) {
  const ingestionSource = metadata?.ingestion_source as string | undefined;
  if (!ingestionSource) return null;

  return <MetadataRow label="Ingestion source">{ingestionSource}</MetadataRow>;
}

export function SourceMetadata({
  contentType,
  platform,
  metadata,
  content,
}: SourceMetadataProps) {
  if (!metadata) return null;

  let platformFields: React.ReactNode = null;

  if (platform === 'email') {
    platformFields = <EmailFields metadata={metadata} />;
  } else if (contentType === 'pdf') {
    platformFields = <PdfFields metadata={metadata} />;
  } else {
    platformFields = <GenericWebFields metadata={metadata} content={content} />;
  }

  const ingestionRow = <IngestionRow metadata={metadata} />;

  // Don't render the accordion if there are no fields to show
  if (!platformFields && !metadata?.ingestion_source) return null;

  return (
    <Accordion type="single" collapsible className="mt-2">
      <AccordionItem value="source" className="border-t border-border">
        <AccordionTrigger className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline py-3">
          Source Details
        </AccordionTrigger>
        <AccordionContent className="pb-2">
          <dl className="flex flex-col gap-3 text-sm">
            {platformFields}
            {ingestionRow}
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
