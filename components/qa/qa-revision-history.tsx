'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, ChevronDown, ChevronUp, Loader2, FileX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  RevisionDiffView,
  type RevisionBlob,
} from '@/components/item-detail/revision-diff-view';
import { useDisplayNames } from '@/hooks/use-display-names';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchQAPairHistory,
  type QAPairHistoryEntry,
} from '@/lib/query/fetchers';
import { cn } from '@/lib/utils';

/**
 * QARevisionHistory — the Q&A leg of the v1 user-edit Diff-UI (ID-59 {59.16},
 * PC-14..17 / INV-14..17; bl-273 promote).
 *
 * Mirrors `components/item-detail/version-history.tsx`'s compare affordance for
 * the Q&A surface: fetches `q_a_pair_history` (via TanStack Query — never a raw
 * fetch) and renders the latest two revisions through the source-agnostic
 * `RevisionDiffView`, surfacing each revision's `edit_intent` in the diff
 * metadata. Source = `q_a_pair_history` (INV-14), NOT `source_document_diffs`;
 * the diff is computed client-side inside RevisionDiffView (INV-15/INV-17), so
 * there is no diff table and no per-version detail leg — each history row
 * already carries the full revision body.
 *
 * Default selection = the latest two revisions (explicit version pickers are
 * deferred to v1.1, matching the content surface). Read-only (INV-17).
 */

const EMPTY_VERSIONS: QAPairHistoryEntry[] = [];

interface QARevisionHistoryProps {
  /** The q_a_pairs row id whose history is rendered. */
  qaPairId: string;
  className?: string;
}

/** Map a q_a_pair_history row to the source-agnostic RevisionDiffView blob. */
function toRevisionBlob(
  row: QAPairHistoryEntry,
  createdByLabel: string,
): RevisionBlob {
  return {
    version: row.version,
    // The answer is the diffed body for the Q&A leg (v1 minimal view).
    text: row.answer_standard,
    // q_a_pair_history has no change_type column — origin_kind is the closest
    // provenance signal and renders through RevisionDiffView's type label.
    changeType: row.origin_kind,
    // No change_summary column on the Q&A history table.
    changeSummary: null,
    createdAt: row.changed_at,
    createdByLabel,
    editIntent: row.edit_intent,
  };
}

export function QARevisionHistory({
  qaPairId,
  className,
}: QARevisionHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);

  const {
    data: listData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.qaPairHistory.list(qaPairId, 50),
    queryFn: () => fetchQAPairHistory(qaPairId),
    enabled: isOpen,
  });

  const versions = useMemo(
    () => listData?.versions ?? EMPTY_VERSIONS,
    [listData],
  );
  const total = listData?.total ?? 0;

  const creatorIds = useMemo(
    () => versions.map((v) => v.changed_by),
    [versions],
  );
  const displayNames = useDisplayNames(creatorIds);

  const labelFor = useCallback(
    (changedBy: string | null): string =>
      changedBy ? (displayNames.get(changedBy) ?? 'Unknown') : 'System',
    [displayNames],
  );

  // List is version-descending: index 0 is newer, index 1 is older.
  const blobs = useMemo<{
    older: RevisionBlob;
    newer: RevisionBlob;
  } | null>(() => {
    const newerRow = versions[0];
    const olderRow = versions[1];
    if (!newerRow || !olderRow) return null;
    return {
      newer: toRevisionBlob(newerRow, labelFor(newerRow.changed_by)),
      older: toRevisionBlob(olderRow, labelFor(olderRow.changed_by)),
    };
  }, [versions, labelFor]);

  return (
    <div className={cn('rounded-lg border', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Revision History
          </span>
          {total > 0 && (
            <Badge variant="secondary" className="text-[11px]">
              {total}
            </Badge>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-border px-4 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="py-4 text-sm text-muted-foreground">
              Couldn&apos;t load the revision history. Please try again.
            </p>
          ) : blobs ? (
            <RevisionDiffView older={blobs.older} newer={blobs.newer} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <FileX
                className="size-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                No earlier revision to compare yet. Edits will be tracked
                automatically.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
