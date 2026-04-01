'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { History, ChevronDown, ChevronUp, RotateCcw, Loader2, Eye, FileX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VersionDiff } from '@/components/item-detail/version-diff';
import { useDisplayNames } from '@/hooks/use-display-names';
import { useUserRole } from '@/hooks/use-user-role';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface VersionEntry {
  id: string;
  content_item_id: string;
  version: number;
  title: string;
  change_summary: string | null;
  change_type: string;
  created_by: string | null;
  created_at: string;
}

interface VersionDetail {
  id: string;
  content_item_id: string;
  version: number;
  title: string;
  content: string;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  change_summary: string | null;
  change_type: string;
  created_by: string | null;
  created_at: string;
}

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
      return 'AI Update';
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

export function VersionHistory({
  itemId,
  currentContent,
  currentTitle,
  className,
  onRollback,
}: VersionHistoryProps) {
  const { canEdit } = useUserRole();
  const [isOpen, setIsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [versionDetail, setVersionDetail] = useState<VersionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  // Collect all created_by UUIDs for display name resolution
  const creatorIds = versions.map((v) => v.created_by);
  const displayNames = useDisplayNames(creatorIds);

  const loadingRef = useRef(false);

  const fetchVersions = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/items/${itemId}/history?limit=50`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setVersions(data.versions ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error('Failed to load version history:', err);
      toast.error('Failed to load version history');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [itemId]);

  // Fetch versions when section is opened
  useEffect(() => {
    if (isOpen && versions.length === 0 && !loading) {
      fetchVersions();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewDetail = async (versionId: string) => {
    if (expandedVersion === versionId) {
      setExpandedVersion(null);
      setVersionDetail(null);
      return;
    }

    setExpandedVersion(versionId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/items/${itemId}/history/${versionId}`);
      if (!res.ok) throw new Error('Failed to fetch version');
      const data = await res.json();
      setVersionDetail(data);
    } catch (err) {
      console.error('Failed to load version detail:', err);
      toast.error('Failed to load version detail');
      setExpandedVersion(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    setRollingBack(true);
    try {
      const res = await fetch(`/api/items/${itemId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: versionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Rollback failed');
      }
      toast.success('Content rolled back successfully');
      fetchVersions();
      onRollback?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to rollback',
      );
    } finally {
      setRollingBack(false);
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
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <FileX className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                No version history yet. Changes will be tracked automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {versions.map((version) => {
                const isExpanded = expandedVersion === version.id;
                const creatorName = version.created_by
                  ? displayNames.get(version.created_by) ?? 'Unknown'
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
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {creatorName} <span aria-hidden="true">&middot;</span>{' '}
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
                            onClick={() => handleRollback(version.id)}
                            disabled={rollingBack}
                            className="h-7 gap-1 text-xs"
                          >
                            {rollingBack ? (
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
                        {loadingDetail ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : versionDetail ? (
                          <div className="space-y-3">
                            {versionDetail.title !== currentTitle && (
                              <div>
                                <p className="mb-1 text-xs font-medium text-muted-foreground">
                                  Title
                                </p>
                                <VersionDiff
                                  oldText={versionDetail.title}
                                  newText={currentTitle}
                                />
                              </div>
                            )}
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">
                                Content
                              </p>
                              <VersionDiff
                                oldText={versionDetail.content}
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
  );
}
