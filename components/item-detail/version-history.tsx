'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  useQueries,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  History,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Loader2,
  Eye,
  FileX,
  GitCompareArrows,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VersionDiff } from '@/components/item-detail/version-diff';
import {
  RevisionDiffView,
  type RevisionBlob,
} from '@/components/item-detail/revision-diff-view';
import { useDisplayNames } from '@/hooks/use-display-names';
import { useUserRole } from '@/hooks/use-user-role';
import { toast } from 'sonner';
import { captureClientException } from '@/lib/client-telemetry';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchItemHistoryList,
  fetchItemHistoryVersion,
  rollbackItemVersion,
  type ItemHistoryEntry,
} from '@/lib/query/fetchers';
import { cn } from '@/lib/utils';

/** Stable empty default so the memoised list keeps a stable reference. */
const EMPTY_VERSIONS: ItemHistoryEntry[] = [];

interface VersionHistoryProps {
  itemId: string;
  /** Current content of the item, for diff comparison */
  currentContent: string;
  currentTitle: string;
  className?: string;
  onRollback?: () => void;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function changeTypeLabel(type: string): string {
  switch (type) {
    case 'create':
      return 'Created';
    case 'edit':
      return 'Edited';
    case 'ai_update':
      return 'Auto update';
    case 'import':
      return 'Imported';
    case 'merge':
      return 'Merged';
    case 'rollback':
      return 'Rollback';
    default:
      return type;
  }
}

/**
 * CompareVersionsPanel — the v1 MINIMAL user-edit Diff-UI affordance
 * (ID-59 {59.12}). Fetches the full bodies of two chosen revisions via
 * TanStack Query and renders the old↔new diff plus each revision's metadata
 * (including the new `edit_intent`) through RevisionDiffView.
 *
 * Reads `content_history` only (via the per-version detail route) — never
 * `source_document_diffs` (INV-17). The diff itself is computed client-side
 * inside RevisionDiffView; no diff table is involved.
 */
function CompareVersionsPanel({
  itemId,
  olderEntry,
  newerEntry,
  displayNames,
}: {
  itemId: string;
  olderEntry: ItemHistoryEntry;
  newerEntry: ItemHistoryEntry;
  displayNames: Map<string, string>;
}) {
  const results = useQueries({
    queries: [
      {
        queryKey: queryKeys.itemHistory.version(itemId, olderEntry.id),
        queryFn: () => fetchItemHistoryVersion(itemId, olderEntry.id),
        staleTime: 5 * 60 * 1000,
      },
      {
        queryKey: queryKeys.itemHistory.version(itemId, newerEntry.id),
        queryFn: () => fetchItemHistoryVersion(itemId, newerEntry.id),
        staleTime: 5 * 60 * 1000,
      },
    ],
  });

  const [olderQuery, newerQuery] = results;
  const isLoading = olderQuery.isLoading || newerQuery.isLoading;
  const isError = olderQuery.isError || newerQuery.isError;
  const olderData = olderQuery.data;
  const newerData = newerQuery.data;

  const labelFor = useCallback(
    (createdBy: string | null): string =>
      createdBy ? (displayNames.get(createdBy) ?? 'Unknown') : 'System',
    [displayNames],
  );

  const blobs = useMemo<{
    older: RevisionBlob;
    newer: RevisionBlob;
  } | null>(() => {
    if (!olderData || !newerData) return null;
    return {
      older: {
        version: olderData.version,
        text: olderData.content,
        changeType: olderData.change_type,
        changeSummary: olderData.change_summary,
        createdAt: olderData.created_at,
        createdByLabel: labelFor(olderData.created_by),
        editIntent: olderData.edit_intent,
      },
      newer: {
        version: newerData.version,
        text: newerData.content,
        changeType: newerData.change_type,
        changeSummary: newerData.change_summary,
        createdAt: newerData.created_at,
        createdByLabel: labelFor(newerData.created_by),
        editIntent: newerData.edit_intent,
      },
    };
  }, [olderData, newerData, labelFor]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !blobs) {
    return (
      <p className="px-1 py-4 text-sm text-muted-foreground">
        Couldn&apos;t load the selected revisions to compare. Please try again.
      </p>
    );
  }

  return <RevisionDiffView older={blobs.older} newer={blobs.newer} />;
}

export function VersionHistory({
  itemId,
  currentContent,
  currentTitle,
  className,
  onRollback,
}: VersionHistoryProps) {
  const { canEdit } = useUserRole();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  // Compare-two-versions affordance (ID-59 {59.12}). Defaults to the latest
  // two revisions; explicit version pickers are deferred to v1.1.
  const [compareMode, setCompareMode] = useState(false);
  const [olderVersionId, setOlderVersionId] = useState<string | null>(null);
  const [newerVersionId, setNewerVersionId] = useState<string | null>(null);

  // List leg — TanStack Query (bl-279). Fetcher + key are authored in
  // lib/query/fetchers.ts / lib/query/query-keys.ts; the section only fetches
  // once expanded. Telemetry + toast fire from the queryFn catch so the
  // remediated silent-failure contract (scope `…loadList`) is preserved.
  const {
    data: listData,
    isLoading: loading,
    isError: hasListError,
    refetch: refetchVersions,
  } = useQuery({
    queryKey: queryKeys.itemHistory.list(itemId, 50),
    queryFn: async () => {
      try {
        return await fetchItemHistoryList(itemId);
      } catch (err) {
        captureClientException(err, {
          scope: 'item-detail.version-history.loadList',
          extras: { itemId },
        });
        toast.error('Failed to load version history');
        throw err;
      }
    },
    enabled: isOpen,
  });

  const { versions: rawVersions, total: rawTotal } = listData ?? {};
  const versions = useMemo(() => rawVersions ?? EMPTY_VERSIONS, [rawVersions]);
  const total = rawTotal ?? 0;

  // Collect all created_by UUIDs for display name resolution
  const creatorIds = useMemo(
    () => versions.map((v) => v.created_by),
    [versions],
  );
  const displayNames = useDisplayNames(creatorIds);

  // Whether a meaningful comparison is even possible (need ≥2 revisions).
  const canCompare = versions.length >= 2;

  // Resolve the two chosen revisions. Falls back to the latest two (the
  // list is version-descending, so index 1 is older, index 0 is newer).
  const olderEntry = useMemo(
    () => versions.find((v) => v.id === olderVersionId) ?? versions[1] ?? null,
    [versions, olderVersionId],
  );
  const newerEntry = useMemo(
    () => versions.find((v) => v.id === newerVersionId) ?? versions[0] ?? null,
    [versions, newerVersionId],
  );

  // Detail leg — TanStack Query (ID-106.1). Fetches the full body of the
  // expanded version; only runs when a version is expanded. Telemetry + toast
  // fire from the queryFn catch so the remediated silent-failure contract
  // (scope `…loadDetail`) is preserved.
  const detailQuery = useQuery({
    queryKey: queryKeys.itemHistory.version(itemId, expandedVersion ?? ''),
    queryFn: async () => {
      const versionId = expandedVersion!;
      try {
        return await fetchItemHistoryVersion(itemId, versionId);
      } catch (err) {
        captureClientException(err, {
          scope: 'item-detail.version-history.loadDetail',
          extras: { itemId, versionId },
        });
        toast.error('Failed to load version detail');
        throw err;
      }
    },
    enabled: expandedVersion !== null,
    staleTime: 5 * 60 * 1000,
  });

  // Rollback mutation leg (ID-106.1). Uses useMutation so the query cache is
  // properly invalidated on success, replacing the old raw-fetch + refetch.
  const rollbackMutation = useMutation({
    mutationFn: (versionId: string) => rollbackItemVersion(itemId, versionId),
    onSuccess: () => {
      toast.success('Content rolled back successfully');
      void queryClient.invalidateQueries({
        queryKey: queryKeys.itemHistory.all(itemId),
      });
      onRollback?.();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to rollback');
    },
  });

  const handleToggleCompare = useCallback(() => {
    setCompareMode((prev) => {
      const next = !prev;
      if (next) {
        // Collapse any expanded single-version diff and default the pickers
        // to the latest two revisions.
        setExpandedVersion(null);
        setNewerVersionId(versions[0]?.id ?? null);
        setOlderVersionId(versions[1]?.id ?? null);
      }
      return next;
    });
  }, [versions]);

  // Pure toggle — no async fetch; detail is driven by detailQuery above.
  const handleViewDetail = (versionId: string) => {
    if (expandedVersion === versionId) {
      setExpandedVersion(null);
    } else {
      setExpandedVersion(versionId);
    }
  };

  return (
    <div className={cn('rounded-lg border', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Version History
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
        <div className="border-t border-border">
          {loading && versions.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : hasListError && versions.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              <p className="mb-3">
                Couldn&apos;t load version history. Please try again.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchVersions()}
                className="gap-1.5"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Retry
              </Button>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <FileX
                className="size-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                No version history yet. Changes will be tracked automatically.
              </p>
            </div>
          ) : (
            <div>
              {/* Compare-two-versions toolbar (ID-59 {59.12}) */}
              {canCompare && (
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                  <span className="text-xs text-muted-foreground">
                    {compareMode
                      ? 'Comparing the two latest versions'
                      : 'Compare two versions'}
                  </span>
                  <Button
                    variant={compareMode ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={handleToggleCompare}
                    className="h-7 gap-1.5 text-xs"
                    aria-pressed={compareMode}
                  >
                    <GitCompareArrows className="size-3.5" aria-hidden="true" />
                    {compareMode ? 'Close compare' : 'Compare versions'}
                  </Button>
                </div>
              )}

              {compareMode && olderEntry && newerEntry ? (
                <div className="px-4 py-3">
                  <CompareVersionsPanel
                    key={`${olderEntry.id}:${newerEntry.id}`}
                    itemId={itemId}
                    olderEntry={olderEntry}
                    newerEntry={newerEntry}
                    displayNames={displayNames}
                  />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {versions.map((version) => {
                    const isExpanded = expandedVersion === version.id;
                    const creatorName = version.created_by
                      ? (displayNames.get(version.created_by) ?? 'Unknown')
                      : 'System';

                    return (
                      <div key={version.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="shrink-0 text-[10px]"
                              >
                                v{version.version}
                              </Badge>
                              <Badge
                                variant="secondary"
                                className="shrink-0 text-[10px]"
                              >
                                {changeTypeLabel(version.change_type)}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-foreground">
                              {version.change_summary ?? 'No description'}
                              {version.change_reason && (
                                <span className="ml-1 text-muted-foreground">
                                  — {version.change_reason}
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {creatorName}{' '}
                              <span aria-hidden="true">&middot;</span>{' '}
                              {formatDateTime(version.created_at)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewDetail(version.id)}
                              className="h-7 gap-1 text-xs"
                            >
                              <Eye className="size-3" />
                              {isExpanded ? 'Hide' : 'Diff'}
                            </Button>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  rollbackMutation.mutate(version.id)
                                }
                                disabled={rollbackMutation.isPending}
                                className="h-7 gap-1 text-xs"
                              >
                                {rollbackMutation.isPending ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="size-3" />
                                )}
                                Restore
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Diff view */}
                        {isExpanded && (
                          <div className="mt-3">
                            {detailQuery.isLoading ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                              </div>
                            ) : detailQuery.data ? (
                              <div className="space-y-3">
                                {detailQuery.data.title !== currentTitle && (
                                  <div>
                                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                                      Title
                                    </p>
                                    <VersionDiff
                                      oldText={detailQuery.data.title}
                                      newText={currentTitle}
                                    />
                                  </div>
                                )}
                                <div>
                                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                                    Content
                                  </p>
                                  <VersionDiff
                                    oldText={detailQuery.data.content}
                                    newText={currentContent}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
