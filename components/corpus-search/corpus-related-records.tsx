'use client';

import {
  Loader2,
  Inbox,
  CircleHelp,
  FileText,
  Link2,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { SectionErrorState } from '@/components/source-document-detail/section-error-state';
import type { CorpusKind, RelatedRecord } from '@/types/corpus-search';

/**
 * CorpusRelatedRecords — ontology-grounded related-records rail (ID-135
 * {135.20}).
 *
 * This is the §9-DROPPED `find_related_items` REPLACEMENT (backlog intent
 * (a) from {131.20} §9 OUTCOMES) — grounded in concept/entity CO-MEMBERSHIP,
 * NOT embedding similarity, and NOT the old IMS `find_related_items`
 * (dropped in id-131; carried none of its 6 columns forward). BI-3
 * (AI-invisible infrastructure): no similarity/score/model/profile field
 * anywhere in this file — relatedness is surfaced as plain "Related", never
 * "AI-suggested".
 *
 * TASK-LEVEL DEPENDENCY: the ontology-grounded related-records read
 * contract/RPC is owned by id-131/id-133 and is NOT YET SHIPPED. This file
 * designs its fetcher boundary against the TARGET `RelatedRecord[]` contract
 * shape (`types/corpus-search.ts`) with a MOCKED read — `fetchRelatedRecords`
 * below resolves to an empty set today (there is no live ontology-grounded
 * data to call), which the rail renders as a clear EMPTY state, never a
 * fabricated list or an error. `fetchRelatedRecords` is the ONLY thing that
 * changes once the real RPC ships: swap its body for a real fetch call
 * against the shipped route, keep the `RelatedRecord[]` return shape and the
 * function signature identical, and neither `useRelatedRecords` nor
 * `CorpusRelatedRecords`/`RelatedRecordsRail` need to change.
 *
 * Primary host today: the {135.18} Surface B source_document detail page
 * (`SourceDocumentDetailClient`). Component takes generic `recordId`/
 * `recordKind` props (not `documentId`) so a follow-on Subtask can mount the
 * SAME rail on Surface A's result expansion ({135.9}) with no component
 * change.
 *
 * Ordering: `RelatedRecordsRail` renders `records` in the exact order
 * received — no `.sort()`/`.filter()`-by-relevance anywhere in this file.
 * Once the real RPC ships, its server-side ordering is what the rail shows.
 *
 * `destinationHref` mirrors `CorpusResultCard`'s BI-14 kind-derived
 * link-destination convention (`components/corpus-search/corpus-result-card.tsx`)
 * — duplicated locally (that module's helper isn't exported, and editing it
 * is outside this Subtask's file-ownership boundary) rather than reused.
 * Same for `RELATED_KIND_META`, which mirrors that file's `KIND_META`
 * text+icon-per-kind convention (BI-4 — never colour-only).
 */

/** Stable empty default (components/CLAUDE.md — never hand a fresh `[]`). */
const EMPTY_RELATED_RECORDS: RelatedRecord[] = [];

const RELATED_KIND_META: Record<
  CorpusKind,
  { label: string; Icon: LucideIcon }
> = {
  answer: { label: 'Answer', Icon: CircleHelp },
  document: { label: 'Document', Icon: FileText },
  reference: { label: 'Reference', Icon: Link2 },
};

/**
 * Derives the link destination from `record.kind` alone (BI-14) — an
 * exhaustive switch over the closed `CorpusKind` union, so a new kind
 * without a case here is a compile error.
 */
function destinationHref(record: RelatedRecord): string {
  switch (record.kind) {
    case 'answer':
      // Mirrors CorpusResultCard's answer destination — the ID-135
      // {135.22} /library/[id] single-pair viewer.
      return `/library/${record.id}`;
    case 'document':
      return `/documents/${record.id}`;
    case 'reference':
      return `/reference/${record.id}`;
  }
}

// ---------------------------------------------------------------------------
// The MOCKED fetcher boundary (id-131/id-133 RPC — NOT YET SHIPPED)
// ---------------------------------------------------------------------------

/**
 * MOCKED contract fetcher. Resolves to an empty set today because there is
 * no live ontology-grounded read to call yet — the honest default is "no
 * related records yet" rather than a fabricated list. See the file-level
 * doc comment above for the swap-in contract this function commits to.
 */
async function fetchRelatedRecords(
  _recordId: string,
  _recordKind: CorpusKind,
): Promise<RelatedRecord[]> {
  return EMPTY_RELATED_RECORDS;
}

function useRelatedRecords(recordId: string, recordKind: CorpusKind) {
  return useQuery<RelatedRecord[]>({
    queryKey: queryKeys.corpusSearch.relatedRecords(recordId, recordKind),
    queryFn: () => fetchRelatedRecords(recordId, recordKind),
    enabled: !!recordId,
  });
}

// ---------------------------------------------------------------------------
// Presentational rail — pure props-driven, no data fetching of its own
// ---------------------------------------------------------------------------

export interface RelatedRecordsRailProps {
  records: RelatedRecord[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * The rail's markup, independent of how `records` was fetched — exported
 * separately so it can be exercised directly with fixture rows (mocked
 * contract rows) without needing a QueryClient or network mocking.
 */
export function RelatedRecordsRail({
  records,
  isLoading,
  isError,
  onRetry,
}: RelatedRecordsRailProps) {
  return (
    <section
      aria-label="Related records"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-medium text-foreground">Related</h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <SectionErrorState
          heading="Couldn't load related records"
          message="Something went wrong while loading related records. This is usually temporary."
          retryLabel="Retry"
          onRetry={onRetry}
        />
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Inbox
            className="size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            No related records found yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {records.map((record) => {
            const { label, Icon } = RELATED_KIND_META[record.kind];
            return (
              <li key={`${record.kind}-${record.id}`}>
                <Link
                  href={destinationHref(record)}
                  prefetch={false}
                  className="group flex items-start gap-2 rounded-md border border-border p-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Icon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="line-clamp-2 flex-1 text-foreground">
                    {record.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Connected container — wires the mocked-contract hook into the rail
// ---------------------------------------------------------------------------

export interface CorpusRelatedRecordsProps {
  /** The anchor record's own id (e.g. a `source_documents.id`). */
  recordId: string;
  /** The anchor record's own kind — narrows the query-key namespace. */
  recordKind: CorpusKind;
}

export function CorpusRelatedRecords({
  recordId,
  recordKind,
}: CorpusRelatedRecordsProps) {
  const { data, isLoading, isError, refetch } = useRelatedRecords(
    recordId,
    recordKind,
  );

  return (
    <RelatedRecordsRail
      records={data ?? EMPTY_RELATED_RECORDS}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
    />
  );
}
