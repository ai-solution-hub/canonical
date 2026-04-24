'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { formatDateUK } from '@/lib/format';
import { useUserRole } from '@/hooks/use-user-role';
import {
  detectMarkdownIngest,
  formatConfidencePercent,
  getIngestionSourceLabel,
  parseImportBatchDate,
  truncateUrl,
} from '@/components/reader/source-metadata-helpers';

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

// ---------------------------------------------------------------------------
// Type-specific field blocks
// ---------------------------------------------------------------------------

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

function QAPairFields({
  sourceFile,
  sectionName,
  answerStandard,
  answerAdvanced,
  importBatch,
}: {
  sourceFile: string | null;
  sectionName: string | null;
  answerStandard: string | null;
  answerAdvanced: string | null;
  importBatch: string | null;
}) {
  const hasStandard = !!answerStandard;
  const hasAdvanced = !!answerAdvanced;
  let answerVariants: string;
  if (hasStandard && hasAdvanced) answerVariants = 'Standard + Advanced';
  else if (hasAdvanced) answerVariants = 'Advanced only';
  else answerVariants = 'Standard only';

  const importedDate = parseImportBatchDate(importBatch);
  const importedDateUk = importedDate
    ? formatDateUK(importedDate.toISOString())
    : null;

  return (
    <>
      {sourceFile && (
        <MetadataRow label="Source document">{sourceFile}</MetadataRow>
      )}
      {sectionName && <MetadataRow label="Section">{sectionName}</MetadataRow>}
      <MetadataRow label="Answer variants">{answerVariants}</MetadataRow>
      {importedDateUk && (
        <MetadataRow label="Imported on">{importedDateUk}</MetadataRow>
      )}
    </>
  );
}

function MarkdownFields({
  sourceFile,
  sourceFolder,
  createdAt,
}: {
  sourceFile: string | null;
  sourceFolder: string | null;
  createdAt: string | null;
}) {
  const ingestionDate = createdAt ? formatDateUK(createdAt) : null;
  return (
    <>
      {sourceFile && <MetadataRow label="Source file">{sourceFile}</MetadataRow>}
      {sourceFolder && (
        <MetadataRow label="Source folder">{sourceFolder}</MetadataRow>
      )}
      {ingestionDate && (
        <MetadataRow label="Ingestion date">{ingestionDate}</MetadataRow>
      )}
    </>
  );
}

function GenericArticleFields({
  metadata,
}: {
  metadata: Record<string, unknown>;
}) {
  const extractionSource = metadata?.extraction_source as string | undefined;
  const ogDescription = metadata?.og_description as string | undefined;
  const ogType = metadata?.og_type as string | undefined;
  const hasReaderHtml = !!metadata?.reader_html;

  const hasFields = extractionSource || ogDescription || ogType || hasReaderHtml;
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared row primitives
// ---------------------------------------------------------------------------

function IngestionSourceRow({
  rawSource,
  hasFeedArticle,
}: {
  rawSource: string | null | undefined;
  hasFeedArticle: boolean;
}) {
  const label = getIngestionSourceLabel(rawSource, hasFeedArticle);
  if (!label) return null;
  return <MetadataRow label="Ingestion source">{label}</MetadataRow>;
}

function SourceUrlRow({
  sourceUrl,
  contentType,
}: {
  sourceUrl: string | null | undefined;
  contentType: string | null;
}) {
  const empty = !sourceUrl || sourceUrl.trim() === '';
  if (empty && contentType !== 'q_a_pair') return null;
  if (empty) {
    return (
      <MetadataRow label="Source URL">
        <span className="text-muted-foreground italic">No source URL</span>
      </MetadataRow>
    );
  }
  return (
    <MetadataRow label="Source URL">
      <a
        href={sourceUrl as string}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:no-underline break-all"
      >
        {truncateUrl(sourceUrl as string, 60)}
      </a>
    </MetadataRow>
  );
}

/**
 * Role-gated classification confidence row.
 *
 * Renders only for `admin` and `editor` roles (`canEdit === true`). Never
 * for viewers, anonymous users, or during role-hook loading state. Plain
 * text percentage — no badge, no icon, no colour coding — per the AI-
 * visibility policy "Editor+admin Source Information surface" amendment.
 */
function ConfidenceRow({
  confidence,
  canEdit,
}: {
  confidence: number | null | undefined;
  canEdit: boolean;
}) {
  if (!canEdit) return null;
  const formatted = formatConfidencePercent(confidence);
  if (formatted == null) return null;
  return (
    <MetadataRow label="Classification confidence">{formatted}</MetadataRow>
  );
}

function WordCountRow({ content }: { content: string | null | undefined }) {
  const wordCount = content
    ? content.trim().split(/\s+/).filter(Boolean).length
    : 0;
  if (wordCount <= 0) return null;
  return (
    <MetadataRow label="Word count">
      {wordCount.toLocaleString('en-GB')}
    </MetadataRow>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Dispatch resolution order (spec §6.4):
 * 1. platform === 'email'           → EmailFields
 * 2. contentType === 'pdf'          → PdfFields
 * 3. contentType === 'q_a_pair'     → QAPairFields
 * 4. feedArticle != null            → FeedArticleFields (Phase 5)
 * 5. detectMarkdownIngest()         → MarkdownFields
 * 6. default                        → GenericArticleFields
 *
 * Edge cases: contentType more specific than platform for Q&A×email; PDF
 * beats feed (not possible under current ingestion); feed beats markdown.
 */
export function SourceMetadata({
  contentType,
  platform,
  metadata,
  content,
  sourceFile,
  sourceUrl,
  classificationConfidence,
  createdAt,
  answerStandard,
  answerAdvanced,
  feedArticle,
}: SourceMetadataProps) {
  // Single hook call per render; `canEdit` passed down as prop to keep
  // subcomponents pure (spec §7.5). During initial fetch `loading === true`
  // and we suppress role-gated rows entirely to avoid flicker + leakage.
  const { canEdit, loading: roleLoading } = useUserRole();
  const effectiveCanEdit = !roleLoading && canEdit;

  const meta = metadata ?? {};

  const sectionName = (meta?.section_name as string | undefined) ?? null;
  const sourceFolder = (meta?.source_folder as string | undefined) ?? null;
  const importBatch = (meta?.import_batch as string | undefined) ?? null;
  const ingestionSourceRaw =
    (meta?.ingestion_source as string | undefined) ?? null;
  const hasFeedArticle = feedArticle != null;

  let platformFields: React.ReactNode = null;
  let typeBlockRendersSourceUrl = false;

  if (platform === 'email') {
    platformFields = <EmailFields metadata={meta} />;
  } else if (contentType === 'pdf') {
    platformFields = <PdfFields metadata={meta} />;
  } else if (contentType === 'q_a_pair') {
    platformFields = (
      <QAPairFields
        sourceFile={sourceFile ?? null}
        sectionName={sectionName}
        answerStandard={answerStandard ?? null}
        answerAdvanced={answerAdvanced ?? null}
        importBatch={importBatch}
      />
    );
  } else if (detectMarkdownIngest(meta)) {
    platformFields = (
      <MarkdownFields
        sourceFile={sourceFile ?? null}
        sourceFolder={sourceFolder}
        createdAt={createdAt ?? null}
      />
    );
  } else {
    platformFields = <GenericArticleFields metadata={meta} />;
  }

  // Empty-accordion rule (§4.5). Phase 5 adds the feedArticle dispatch
  // branch; the feedArticle clause below is already present.
  const hasAnyRow =
    !!sourceFile ||
    !!sourceUrl ||
    contentType === 'q_a_pair' ||
    !!ingestionSourceRaw ||
    !!sectionName ||
    !!importBatch ||
    !!meta?.feed_source_name ||
    !!sourceFolder ||
    !!meta?.newsletter_name ||
    !!meta?.page_count ||
    (content != null && content.trim().length > 0) ||
    (effectiveCanEdit && classificationConfidence != null) ||
    hasFeedArticle;

  if (!hasAnyRow) return null;

  return (
    <Accordion type="single" collapsible className="mt-2">
      <AccordionItem value="source" className="border-t border-border">
        <AccordionTrigger className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline py-3">
          Source Information
        </AccordionTrigger>
        <AccordionContent className="pb-2">
          <dl className="flex flex-col gap-3 text-sm">
            {platformFields}
            {!typeBlockRendersSourceUrl && (
              <SourceUrlRow
                sourceUrl={sourceUrl}
                contentType={contentType}
              />
            )}
            <IngestionSourceRow
              rawSource={ingestionSourceRaw}
              hasFeedArticle={hasFeedArticle}
            />
            <ConfidenceRow
              confidence={classificationConfidence}
              canEdit={effectiveCanEdit}
            />
            <WordCountRow content={content} />
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
