'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { formatDateUK } from '@/lib/format';

interface SourceMetadataProps {
  contentType: string | null;
  platform: string | null;
  metadata: Record<string, unknown> | null;
  content?: string | null;
}

function MetadataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

function RedditFields({ metadata }: { metadata: Record<string, unknown> }) {
  const subreddit = metadata?.subreddit as string | undefined;
  const score = metadata?.score as number | undefined;
  const postType = metadata?.post_type as string | undefined;

  const hasFields = subreddit || score != null || postType;
  if (!hasFields) return null;

  return (
    <>
      {subreddit && <MetadataRow label="Subreddit">r/{subreddit}</MetadataRow>}
      {score != null && <MetadataRow label="Score">{score.toLocaleString('en-GB')}</MetadataRow>}
      {postType && <MetadataRow label="Post type">{postType}</MetadataRow>}
    </>
  );
}

function YouTubeFields({ metadata }: { metadata: Record<string, unknown> }) {
  const channel = (metadata?.host as string) || (metadata?.channel_id as string | undefined);
  const guest = metadata?.guest as string | undefined;
  const publishedAt = metadata?.published_at as string | undefined;
  const captionsType = metadata?.captions_type as string | undefined;

  const hasFields = channel || guest || publishedAt || captionsType;
  if (!hasFields) return null;

  return (
    <>
      {channel && <MetadataRow label="Channel">{channel}</MetadataRow>}
      {guest && <MetadataRow label="Guest">{guest}</MetadataRow>}
      {publishedAt && <MetadataRow label="Published">{formatDateUK(publishedAt)}</MetadataRow>}
      {captionsType && <MetadataRow label="Captions">{captionsType}</MetadataRow>}
    </>
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
      {newsletterName && <MetadataRow label="Newsletter">{newsletterName}</MetadataRow>}
      {emailSubject && <MetadataRow label="Subject">{emailSubject}</MetadataRow>}
      {emailFrom && <MetadataRow label="From">{emailFrom}</MetadataRow>}
    </>
  );
}

function PdfFields({ metadata }: { metadata: Record<string, unknown> }) {
  const pageCount = metadata?.page_count as number | undefined;

  if (pageCount == null) return null;

  return <MetadataRow label="Pages">{pageCount}</MetadataRow>;
}

function LinkedInFields({ metadata }: { metadata: Record<string, unknown> }) {
  const authorHeadline = metadata?.author_headline as string | undefined;
  const mediaType = metadata?.media_type as string | undefined;

  const hasFields = authorHeadline || mediaType;
  if (!hasFields) return null;

  return (
    <>
      {authorHeadline && <MetadataRow label="Headline">{authorHeadline}</MetadataRow>}
      {mediaType && <MetadataRow label="Media type">{mediaType}</MetadataRow>}
    </>
  );
}

function GenericWebFields({ metadata, content }: { metadata: Record<string, unknown>; content?: string | null }) {
  const extractionSource = metadata?.extraction_source as string | undefined;
  const ogDescription = metadata?.og_description as string | undefined;
  const ogType = metadata?.og_type as string | undefined;
  const hasReaderHtml = !!metadata?.reader_html;
  const wordCount = content ? content.trim().split(/\s+/).filter(Boolean).length : null;

  const hasFields = extractionSource || ogDescription || ogType || hasReaderHtml || (wordCount && wordCount > 0);
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
      {hasReaderHtml && <MetadataRow label="Reader view">Available</MetadataRow>}
      {wordCount != null && wordCount > 0 && (
        <MetadataRow label="Word count">{wordCount.toLocaleString('en-GB')}</MetadataRow>
      )}
    </>
  );
}

function IngestionRow({ metadata }: { metadata: Record<string, unknown> }) {
  const ingestionSource = metadata?.ingestion_source as string | undefined;
  if (!ingestionSource) return null;

  return <MetadataRow label="Ingestion source">{ingestionSource}</MetadataRow>;
}

export function SourceMetadata({ contentType, platform, metadata, content }: SourceMetadataProps) {
  if (!metadata) return null;

  let platformFields: React.ReactNode = null;

  if (platform === 'reddit') {
    platformFields = <RedditFields metadata={metadata} />;
  } else if (platform === 'youtube') {
    platformFields = <YouTubeFields metadata={metadata} />;
  } else if (platform === 'email') {
    platformFields = <EmailFields metadata={metadata} />;
  } else if (contentType === 'pdf') {
    platformFields = <PdfFields metadata={metadata} />;
  } else if (platform === 'linkedin') {
    platformFields = <LinkedInFields metadata={metadata} />;
  } else {
    platformFields = <GenericWebFields metadata={metadata} content={content} />;
  }

  const ingestionRow = <IngestionRow metadata={metadata} />;

  // Don't render the accordion if there are no fields to show
  if (!platformFields && !metadata?.ingestion_source) return null;

  return (
    <Accordion type="single" collapsible className="mt-4">
      <AccordionItem value="source" className="rounded-lg border border-border">
        <AccordionTrigger className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline">
          Source Details
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <dl className="flex flex-col gap-3 text-sm">
            {platformFields}
            {ingestionRow}
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
