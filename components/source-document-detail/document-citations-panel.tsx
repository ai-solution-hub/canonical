'use client';

import {
  BookOpen,
  FileQuestion,
  FileStack,
  Inbox,
  MapPin,
  Tag,
} from 'lucide-react';
import { formatDateUK } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SectionErrorState } from '@/components/source-document-detail/section-error-state';
import {
  useDocumentCitations,
  type CitationTargetKind,
} from '@/hooks/source-document-detail/use-source-document-detail';

/**
 * DocumentCitationsPanel — id-135 {135.16} (TECH §3 BI-27, §4, AAT-4).
 * Extended at ID-145 {145.47} (TECH §3/§4, PRODUCT §D1-D5, "wiring" in that
 * Subtask's file ownership) with optional bidirectional-selection props so
 * `ItemCitationOverlay` can pair this panel with a PDF spatial overlay, and
 * (Checker F1 fix) split into a data-fetching wrapper (`DocumentCitationsPanel`,
 * unchanged contract, `useDocumentCitations` internally) and a data-agnostic
 * presentational view (`CitationsPanelView`) — `ItemCitationOverlay` reads
 * citations from a DIFFERENT axis/route (`useProcurementFormCitations`, the
 * form's own citing-side citations) and renders that data through
 * `CitationsPanelView` directly, reusing this exact markup/behaviour without
 * a second implementation.
 *
 * Renders citation rows grouped/labelled by the id-131 BI-23 CITE-EXT
 * `cited_target_kind` (the 4 always-present buckets, keyed by
 * `CitationTargetKind`: `q_a_pair`, `reference_item`, `source_document`,
 * `concept`), each group carrying a text+icon label (BI-4 — never
 * colour-only).
 *
 * `citations` is 0 rows today for `DocumentCitationsPanel`'s own Surface-B
 * axis (the common path until the id-131 {131.11} G-cluster lands
 * extended-contract writers — AAT-4, a Task-level dependency) — that
 * renders a CLEAR "no citations yet" empty state, never an error (BI-27).
 * Own independent TanStack query (BI-30): loading renders a skeleton, a
 * fetch failure renders its own localised non-technical error + retry (the
 * shared `SectionErrorState`, {135.18} convergence pass), without failing
 * the wider Surface B detail page.
 *
 * §D1-D5 wiring (all optional, backward compatible — `SourceDocumentDetailClient`
 * passes only `documentId` and is unaffected): when `onSelectCitation` is
 * supplied, rows become selectable buttons sharing a selection id with a
 * `SpatialOverlay` box layer (select box -> select citation row, and vice
 * versa via `selectedId`); `resolvedCitationIds` marks which citations
 * resolved to an on-page box elsewhere (147-I B1/B2) with a text+icon "On
 * page" hint — a citation NOT in that set still renders as a normal,
 * text-anchored row (§D3/§D4, never implying a wrong location).
 */

const KIND_ORDER: readonly CitationTargetKind[] = [
  'q_a_pair',
  'reference_item',
  'source_document',
  'concept',
];

const KIND_META: Record<
  CitationTargetKind,
  { label: string; icon: typeof FileQuestion }
> = {
  q_a_pair: { label: 'Answers', icon: FileQuestion },
  reference_item: { label: 'References', icon: BookOpen },
  source_document: { label: 'Source documents', icon: FileStack },
  concept: { label: 'Concepts', icon: Tag },
};

/**
 * The subset of a citation row this component's markup actually reads —
 * satisfied structurally by both `CitationSummary` (source-documents
 * citations route) and `ProcurementCitationRow` (procurement citations
 * route), so `CitationsPanelView` is reusable across both citation-read
 * axes without a generic type param.
 */
export interface CitationRowLike {
  id: string;
  cited_text: string | null;
  citation_type: string;
  created_at: string;
}

export type CitationsPanelData = Record<CitationTargetKind, CitationRowLike[]>;

export interface DocumentCitationsPanelProps {
  documentId: string;
  /** Shared selection id (147-H pattern). Omitted: rows are plain, non-interactive list items (existing behaviour). */
  selectedId?: string | null;
  /** Provided together with a spatial overlay — selecting a row selects the shared id (row click -> select box). */
  onSelectCitation?: (citationId: string) => void;
  /** Citation ids that resolved to an on-page box elsewhere (147-I B1/B2) — those rows get an additional "On page" text+icon hint. */
  resolvedCitationIds?: ReadonlySet<string>;
}

export function DocumentCitationsPanel({
  documentId,
  selectedId,
  onSelectCitation,
  resolvedCitationIds,
}: DocumentCitationsPanelProps) {
  const { data, isLoading, isError, refetch } =
    useDocumentCitations(documentId);

  return (
    <CitationsPanelView
      citations={data?.citations}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      selectedId={selectedId}
      onSelectCitation={onSelectCitation}
      resolvedCitationIds={resolvedCitationIds}
    />
  );
}

export interface CitationsPanelViewProps {
  citations: CitationsPanelData | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedId?: string | null;
  onSelectCitation?: (citationId: string) => void;
  resolvedCitationIds?: ReadonlySet<string>;
}

/**
 * The data-agnostic citations presentation — loading skeleton, localised
 * error + retry, grouped list, or honest empty state. Any caller can drive
 * it with its OWN query result (see the module doc above).
 */
export function CitationsPanelView({
  citations,
  isLoading,
  isError,
  onRetry,
  selectedId,
  onSelectCitation,
  resolvedCitationIds,
}: CitationsPanelViewProps) {
  return (
    <section
      aria-label="Citations"
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-medium text-foreground">Citations</h2>
      {isLoading ? (
        <CitationsSkeleton />
      ) : isError ? (
        <SectionErrorState
          heading="Couldn't load citations"
          message="Something went wrong while loading citations. This is usually temporary."
          onRetry={onRetry}
        />
      ) : (
        <CitationsGroupedList
          citations={citations}
          selectedId={selectedId}
          onSelectCitation={onSelectCitation}
          resolvedCitationIds={resolvedCitationIds}
        />
      )}
    </section>
  );
}

function totalCitations(citations: CitationsPanelData | undefined): number {
  if (!citations) return 0;
  return KIND_ORDER.reduce((sum, kind) => sum + citations[kind].length, 0);
}

function CitationsGroupedList({
  citations,
  selectedId,
  onSelectCitation,
  resolvedCitationIds,
}: {
  citations: CitationsPanelData | undefined;
  selectedId?: string | null;
  onSelectCitation?: (citationId: string) => void;
  resolvedCitationIds?: ReadonlySet<string>;
}) {
  if (totalCitations(citations) === 0 || !citations) {
    return <CitationsEmptyState />;
  }

  return (
    <div className="space-y-4">
      {KIND_ORDER.filter((kind) => citations[kind].length > 0).map((kind) => (
        <CitationKindGroup
          key={kind}
          kind={kind}
          rows={citations[kind]}
          selectedId={selectedId}
          onSelectCitation={onSelectCitation}
          resolvedCitationIds={resolvedCitationIds}
        />
      ))}
    </div>
  );
}

function CitationKindGroup({
  kind,
  rows,
  selectedId,
  onSelectCitation,
  resolvedCitationIds,
}: {
  kind: CitationTargetKind;
  rows: CitationRowLike[];
  selectedId?: string | null;
  onSelectCitation?: (citationId: string) => void;
  resolvedCitationIds?: ReadonlySet<string>;
}) {
  const { label, icon: Icon } = KIND_META[kind];
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {label} ({rows.length})
        </span>
      </h3>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <CitationRow
              row={row}
              isSelected={row.id === selectedId}
              isResolved={resolvedCitationIds?.has(row.id) ?? false}
              onSelect={onSelectCitation}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CitationRow({
  row,
  isSelected,
  isResolved,
  onSelect,
}: {
  row: CitationRowLike;
  isSelected: boolean;
  isResolved: boolean;
  onSelect?: (citationId: string) => void;
}) {
  const body = (
    <>
      <p className="truncate">{row.cited_text ?? row.citation_type}</p>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{formatDateUK(row.created_at)}</span>
        {isResolved && (
          <span className="inline-flex items-center gap-0.5 text-primary">
            <MapPin className="size-3" aria-hidden="true" />
            On page
          </span>
        )}
      </div>
    </>
  );

  const rowClassName = cn(
    'w-full rounded-md border p-2 text-left text-sm text-foreground',
    isSelected ? 'border-ring bg-accent' : 'border-border bg-muted/40',
  );

  if (!onSelect) {
    return <div className={rowClassName}>{body}</div>;
  }

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => onSelect(row.id)}
      className={cn(
        rowClassName,
        'cursor-pointer transition-colors hover:bg-accent/60',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none',
      )}
    >
      {body}
    </button>
  );
}

function CitationsSkeleton() {
  return (
    <div role="status" aria-label="Loading citations" className="space-y-2">
      <span className="sr-only">Loading citations...</span>
      <div className="h-4 w-24 animate-pulse rounded bg-accent" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-10 w-full animate-pulse rounded bg-accent" />
      ))}
    </div>
  );
}

function CitationsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
      <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-medium text-foreground">
        No citations yet
      </h3>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        Nothing has cited this document yet. Citations will appear here as other
        records reference it.
      </p>
    </div>
  );
}
