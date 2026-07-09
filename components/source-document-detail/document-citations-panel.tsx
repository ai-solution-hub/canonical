'use client';

import { BookOpen, FileQuestion, FileStack, Inbox, Tag } from 'lucide-react';
import { formatDateUK } from '@/lib/format';
import { SectionErrorState } from '@/components/source-document-detail/section-error-state';
import {
  useDocumentCitations,
  type CitationSummary,
  type CitationsByKind,
  type CitationTargetKind,
} from '@/hooks/source-document-detail/use-source-document-detail';

/**
 * DocumentCitationsPanel — id-135 {135.16} (TECH §3 BI-27, §4, AAT-4).
 *
 * Renders citation rows grouped/labelled by the id-131 BI-23 CITE-EXT
 * `cited_target_kind` (the 4 always-present buckets on `CitationsByKind`:
 * `q_a_pair`, `reference_item`, `source_document`, `concept`), each group
 * carrying a text+icon label (BI-4 — never colour-only).
 *
 * `citations` is 0 rows today (the common path until the id-131 {131.11}
 * G-cluster lands extended-contract writers — AAT-4, a Task-level
 * dependency) — that renders a CLEAR "no citations yet" empty state, never
 * an error (BI-27). Own independent TanStack query (BI-30): loading renders
 * a skeleton, a fetch failure renders its own localised non-technical error
 * + retry (the shared `SectionErrorState`, {135.18} convergence pass),
 * without failing the wider Surface B detail page.
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

export interface DocumentCitationsPanelProps {
  documentId: string;
}

export function DocumentCitationsPanel({
  documentId,
}: DocumentCitationsPanelProps) {
  const { data, isLoading, isError, refetch } =
    useDocumentCitations(documentId);

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
          onRetry={() => refetch()}
        />
      ) : (
        <CitationsGroupedList citations={data?.citations} />
      )}
    </section>
  );
}

function totalCitations(citations: CitationsByKind | undefined): number {
  if (!citations) return 0;
  return KIND_ORDER.reduce((sum, kind) => sum + citations[kind].length, 0);
}

function CitationsGroupedList({
  citations,
}: {
  citations: CitationsByKind | undefined;
}) {
  if (totalCitations(citations) === 0 || !citations) {
    return <CitationsEmptyState />;
  }

  return (
    <div className="space-y-4">
      {KIND_ORDER.filter((kind) => citations[kind].length > 0).map((kind) => (
        <CitationKindGroup key={kind} kind={kind} rows={citations[kind]} />
      ))}
    </div>
  );
}

function CitationKindGroup({
  kind,
  rows,
}: {
  kind: CitationTargetKind;
  rows: CitationSummary[];
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
          <li
            key={row.id}
            className="rounded-md border border-border bg-muted/40 p-2 text-sm text-foreground"
          >
            <p className="truncate">{row.cited_text ?? row.citation_type}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatDateUK(row.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
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
