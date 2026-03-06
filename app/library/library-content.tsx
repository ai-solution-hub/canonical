'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  Filter,
  Loader2,
  Tag,
  FolderPlus,
  ShieldCheck,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { useUserRole } from '@/hooks/use-user-role';
import { CONTENT_LIST_COLUMNS, type ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LibraryFilters {
  domain?: string;
  source_file?: string;
  variant?: 'all' | 'standard_only' | 'advanced_only' | 'both' | 'neither';
  search?: string;
  freshness?: 'fresh' | 'aging' | 'stale' | 'expired';
  verified?: 'verified' | 'unverified';
}

type GroupBy = 'none' | 'source' | 'domain';

// ---------------------------------------------------------------------------
// Hook: useLibraryFilters (URL search params)
// ---------------------------------------------------------------------------

function useLibraryFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: LibraryFilters = useMemo(
    () => ({
      domain: searchParams.get('domain') || undefined,
      source_file: searchParams.get('source') || undefined,
      variant:
        (searchParams.get('variant') as LibraryFilters['variant']) || undefined,
      search: searchParams.get('q') || undefined,
      freshness:
        (searchParams.get('freshness') as LibraryFilters['freshness']) || undefined,
      verified:
        (searchParams.get('verified') as LibraryFilters['verified']) || undefined,
    }),
    [searchParams],
  );

  const groupBy: GroupBy = useMemo(
    () => (searchParams.get('group') as GroupBy) || 'none',
    [searchParams],
  );

  const setGroupBy = useCallback(
    (value: GroupBy) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'none') {
        params.delete('group');
      } else {
        params.set('group', value);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const setFilters = useCallback(
    (updates: Partial<LibraryFilters>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        const paramKey = key === 'source_file' ? 'source' : key === 'search' ? 'q' : key;
        if (value) {
          params.set(paramKey, value);
        } else {
          params.delete(paramKey);
        }
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const activeCount = [
    filters.domain,
    filters.source_file,
    filters.variant,
    filters.search,
    filters.freshness,
    filters.verified,
  ].filter(Boolean).length;

  return { filters, setFilters, clearFilters, activeCount, groupBy, setGroupBy };
}

// ---------------------------------------------------------------------------
// QA Row Component
// ---------------------------------------------------------------------------

function QARow({
  item,
  selected,
  onToggleSelect,
}: {
  item: ContentListItem;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const metadata = item.metadata as Record<string, unknown> | null;
  const hasStandard = !!item.answer_standard;
  const hasAdvanced = !!item.answer_advanced;
  const sourceFile = metadata?.source_file as string | undefined;

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      setCopiedField(label);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedField(null), 2000);
    },
    [],
  );

  const freshness = item.freshness as string | null;
  const freshnessColour =
    freshness === 'fresh'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : freshness === 'aging'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : freshness === 'stale'
          ? 'bg-red-500/10 text-red-700 dark:text-red-400'
          : 'bg-muted text-muted-foreground';

  return (
    <div
      data-qa-row
      tabIndex={0}
      className={cn(
        'rounded-lg border border-border bg-card transition-colors hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-primary/30 border-primary/40',
      )}
    >
      {/* Row header — always visible */}
      <div className="flex w-full items-start gap-3 p-4">
        {/* Checkbox */}
        {onToggleSelect && (
          <div
            className="mt-0.5 shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] -m-2.5"
            role="presentation"
          >
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onToggleSelect(item.id)}
              aria-label={`Select "${item.title}"`}
              className="cursor-pointer"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-start gap-3 text-left min-w-0"
          aria-expanded={expanded}
        >
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug">
            {item.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {item.primary_domain && (
              <span>
                {item.primary_domain}
                {item.primary_subtopic ? ` > ${item.primary_subtopic}` : ''}
              </span>
            )}
            {sourceFile && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[200px]">{sourceFile}</span>
              </>
            )}
            {freshness && (
              <>
                <span aria-hidden="true">·</span>
                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', freshnessColour)}>
                  {freshness}
                </Badge>
              </>
            )}
            {hasStandard && hasAdvanced && (
              <>
                <span aria-hidden="true">·</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Standard + Advanced
                </Badge>
              </>
            )}
          </div>
        </div>
        </button>
        <Link
          href={`/item/${item.id}`}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Open detail view"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      {/* Expanded answer content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 pl-11">
          {hasStandard && (
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Standard
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  onClick={() => handleCopy(item.answer_standard!, 'Standard answer')}
                >
                  {copiedField === 'Standard answer' ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy
                </Button>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                {item.answer_standard}
              </p>
            </div>
          )}
          {hasAdvanced && (
            <div className={hasStandard ? 'mt-4 border-t border-border/50 pt-3' : ''}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Advanced
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  onClick={() => handleCopy(item.answer_advanced!, 'Advanced answer')}
                >
                  {copiedField === 'Advanced answer' ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy
                </Button>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                {item.answer_advanced}
              </p>
            </div>
          )}
          {!hasStandard && !hasAdvanced && item.content && (
            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
              {item.content}
            </p>
          )}
          {!hasStandard && !hasAdvanced && !item.content && (
            <p className="text-sm italic text-muted-foreground">
              No answer recorded yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleGroup — expandable section for grouped Q&A pairs
// ---------------------------------------------------------------------------

function CollapsibleGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-muted/50 px-4 py-2.5 text-left border-l-4 border-primary/40 hover:bg-muted/80 transition-colors"
      >
        <span className="shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Badge variant="secondary" className="ml-auto tabular-nums text-xs">
          {count}
        </Badge>
      </button>
      {expanded && (
        <div className="space-y-2 p-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// groupItems — group ContentListItems by source or domain
// ---------------------------------------------------------------------------

function groupItems(
  items: ContentListItem[],
  groupBy: GroupBy,
): Map<string, ContentListItem[]> {
  const groups = new Map<string, ContentListItem[]>();

  for (const item of items) {
    let key: string;
    if (groupBy === 'source') {
      const metadata = item.metadata as Record<string, unknown> | null;
      key = (metadata?.source_file as string) || 'No source';
    } else {
      key = item.primary_domain || 'Unclassified';
    }

    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Workspace type for the assign dialog
// ---------------------------------------------------------------------------

interface WorkspaceOption {
  id: string;
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// BulkActionToolbar — appears when 1+ items selected
// ---------------------------------------------------------------------------

function BulkActionToolbar({
  selectedCount,
  isAdmin,
  bulkOperating,
  bulkProgress,
  onBulkReclassify,
  onBulkTag,
  onBulkAssign,
  onBulkVerify,
  onBulkDelete,
  onClearSelection,
}: {
  selectedCount: number;
  isAdmin: boolean;
  bulkOperating: boolean;
  bulkProgress: { current: number; total: number; label: string };
  onBulkReclassify: () => void;
  onBulkTag: () => void;
  onBulkAssign: () => void;
  onBulkVerify: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {selectedCount} selected
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkReclassify}
            disabled={bulkOperating}
          >
            <RefreshCw className="size-3.5" />
            Re-classify
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkTag}
            disabled={bulkOperating}
          >
            <Tag className="size-3.5" />
            Tag
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkAssign}
            disabled={bulkOperating}
          >
            <FolderPlus className="size-3.5" />
            Assign to workspace
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkVerify}
            disabled={bulkOperating}
          >
            <ShieldCheck className="size-3.5" />
            Verify
          </Button>

          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={bulkOperating}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selectedCount} Q&A pair{selectedCount !== 1 ? 's' : ''}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. The selected Q&A pairs will be
                    permanently removed from the library.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onBulkDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete {selectedCount} item{selectedCount !== 1 ? 's' : ''}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 text-xs"
          onClick={onClearSelection}
          disabled={bulkOperating}
        >
          Clear selection
        </Button>
      </div>

      {/* Progress bar */}
      {bulkOperating && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>
              {bulkProgress.label} {bulkProgress.current}/{bulkProgress.total}...
            </span>
          </div>
          <Progress
            value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0}
            className="h-1.5"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LibraryContent
// ---------------------------------------------------------------------------

export function LibraryContent() {
  const supabase = createClient();
  const { filters, setFilters, clearFilters, activeCount, groupBy, setGroupBy } = useLibraryFilters();
  const { domains } = useTaxonomy();
  const { canAdmin } = useUserRole();

  const [items, setItems] = useState<ContentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOperating, setBulkOperating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, label: '' });

  // Dialog state
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  // Trigger for re-fetching data after bulk operations
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length && items.length > 0) {
        return new Set();
      }
      return new Set(items.map((i) => i.id));
    });
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters.domain, filters.source_file, filters.variant, filters.search, filters.freshness, filters.verified]);

  // Bulk operation runner
  const runBulkOperation = useCallback(
    async (
      label: string,
      operation: (id: string, item: ContentListItem) => Promise<boolean>,
    ) => {
      const ids = Array.from(selectedIds);
      setBulkOperating(true);
      setBulkProgress({ current: 0, total: ids.length, label });
      let successCount = 0;

      for (let i = 0; i < ids.length; i++) {
        const item = items.find((it) => it.id === ids[i]);
        if (!item) continue;

        try {
          const ok = await operation(ids[i], item);
          if (ok) successCount++;
        } catch {
          // continue processing remaining items
        }

        setBulkProgress({ current: i + 1, total: ids.length, label });
      }

      setBulkOperating(false);
      setBulkProgress({ current: 0, total: 0, label: '' });
      setSelectedIds(new Set());
      setFetchTrigger((prev) => prev + 1);

      return successCount;
    },
    [selectedIds, items],
  );

  // Bulk re-classify
  const handleBulkReclassify = useCallback(async () => {
    const count = await runBulkOperation('Re-classifying', async (id) => {
      const res = await fetch(`/api/items/${id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      return res.ok;
    });
    toast.success(`Re-classified ${count} item${count !== 1 ? 's' : ''}`);
  }, [runBulkOperation]);

  // Bulk tag — opens dialog
  const handleBulkTagOpen = useCallback(() => {
    setTagInput('');
    setTagDialogOpen(true);
  }, []);

  const handleBulkTagConfirm = useCallback(async () => {
    const newTags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (newTags.length === 0) {
      toast.error('Enter at least one tag');
      return;
    }
    setTagDialogOpen(false);

    const count = await runBulkOperation('Tagging', async (id, item) => {
      const existing = (item.user_tags as string[] | null) ?? [];
      const merged = [...new Set([...existing, ...newTags])];
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'user_tags', value: merged }),
      });
      return res.ok;
    });
    toast.success(`Tagged ${count} item${count !== 1 ? 's' : ''} with: ${newTags.join(', ')}`);
  }, [tagInput, runBulkOperation]);

  // Bulk assign — opens dialog
  const handleBulkAssignOpen = useCallback(async () => {
    setSelectedWorkspaceId('');
    setAssignDialogOpen(true);
    setWorkspacesLoading(true);

    try {
      const res = await fetch('/api/workspaces');
      if (res.ok) {
        const data = await res.json();
        const ws = Array.isArray(data) ? data : data.workspaces ?? [];
        setWorkspaces(
          ws.map((w: { id: string; name: string; type?: string }) => ({
            id: w.id,
            name: w.name,
            type: w.type ?? 'project',
          })),
        );
      }
    } catch {
      toast.error('Failed to load workspaces');
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  const handleBulkAssignConfirm = useCallback(async () => {
    if (!selectedWorkspaceId) {
      toast.error('Select a workspace');
      return;
    }
    setAssignDialogOpen(false);

    const count = await runBulkOperation('Assigning', async (id) => {
      const res = await fetch(`/api/items/${id}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: selectedWorkspaceId, action: 'assign' }),
      });
      return res.ok;
    });
    const ws = workspaces.find((w) => w.id === selectedWorkspaceId);
    toast.success(`Assigned ${count} item${count !== 1 ? 's' : ''} to "${ws?.name ?? 'workspace'}"`);
  }, [selectedWorkspaceId, workspaces, runBulkOperation]);

  // Bulk verify
  const handleBulkVerify = useCallback(async () => {
    const count = await runBulkOperation('Verifying', async (id) => {
      const res = await fetch('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, action: 'verify' }),
      });
      return res.ok;
    });
    toast.success(`Verified ${count} item${count !== 1 ? 's' : ''}`);
  }, [runBulkOperation]);

  // Bulk delete (admin only)
  const handleBulkDelete = useCallback(async () => {
    const count = await runBulkOperation('Deleting', async (id) => {
      const res = await fetch(`/api/items/${id}`, {
        method: 'DELETE',
      });
      return res.ok;
    });
    toast.success(`Deleted ${count} item${count !== 1 ? 's' : ''}`);
  }, [runBulkOperation]);

  // Fetch Q&A pairs
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);

      let query = supabase
        .from('content_items')
        .select(CONTENT_LIST_COLUMNS.trim())
        .eq('content_type', 'q_a_pair')
        .or('governance_review_status.is.null,governance_review_status.neq.draft')
        .order('primary_domain', { ascending: true })
        .order('title', { ascending: true });

      if (filters.domain) {
        query = query.eq('primary_domain', filters.domain);
      }

      if (filters.source_file) {
        query = query.eq('metadata->>source_file', filters.source_file);
      }

      if (filters.variant === 'both') {
        query = query.not('answer_standard', 'is', null).not('answer_advanced', 'is', null);
      } else if (filters.variant === 'standard_only') {
        query = query.not('answer_standard', 'is', null).is('answer_advanced', null);
      } else if (filters.variant === 'advanced_only') {
        query = query.is('answer_standard', null).not('answer_advanced', 'is', null);
      } else if (filters.variant === 'neither') {
        query = query.is('answer_standard', null).is('answer_advanced', null);
      }

      if (filters.freshness) {
        query = query.eq('freshness', filters.freshness);
      }

      if (filters.verified === 'verified') {
        query = query.not('verified_at', 'is', null);
      } else if (filters.verified === 'unverified') {
        query = query.is('verified_at', null);
      }

      if (filters.search) {
        query = query.or(
          `title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`,
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error('Failed to fetch Q&A pairs:', error);
        setIsLoading(false);
        return;
      }

      const fetched = Array.isArray(data) ? (data as unknown as ContentListItem[]) : [];
      setItems(fetched);
      setIsLoading(false);
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.domain, filters.source_file, filters.variant, filters.search, filters.freshness, filters.verified, fetchTrigger]);

  // Fetch distinct source files for filter dropdown
  useEffect(() => {
    const fetchSources = async () => {
      const { data } = await supabase
        .from('content_items')
        .select('metadata->>source_file')
        .eq('content_type', 'q_a_pair')
        .not('metadata->>source_file', 'is', null)
        .not('metadata->>source_file', 'eq', '');

      if (data) {
        const unique = [
          ...new Set(
            (data as Array<{ source_file: string }>).map((r) => r.source_file).filter(Boolean),
          ),
        ].sort();
        setSourceFiles(unique);
      }
    };
    fetchSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats
  const standardCount = items.filter((i) => i.answer_standard).length;
  const advancedCount = items.filter((i) => i.answer_advanced).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Q&A Library</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isLoading ? (
              <span className="inline-block h-4 w-48 animate-pulse rounded bg-accent align-middle" />
            ) : (
              <>
                {items.length} Q&A pair{items.length !== 1 ? 's' : ''}
                {standardCount > 0 && (
                  <span> · {standardCount} standard</span>
                )}
                {advancedCount > 0 && (
                  <span> · {advancedCount} advanced</span>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search questions and answers..."
            value={filters.search ?? ''}
            onChange={(e) => setFilters({ search: e.target.value || undefined })}
            className="h-9 pl-9"
            aria-label="Search Q&A pairs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.domain ?? '__all__'}
            onValueChange={(v) => setFilters({ domain: v === '__all__' ? undefined : v })}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="All domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All domains</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.source_file ?? '__all__'}
            onValueChange={(v) => setFilters({ source_file: v === '__all__' ? undefined : v })}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All sources</SelectItem>
              {sourceFiles.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.variant ?? 'all'}
            onValueChange={(v) =>
              setFilters({ variant: v === 'all' ? undefined : (v as LibraryFilters['variant']) })
            }
          >
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="All variants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All variants</SelectItem>
              <SelectItem value="both">Standard + Advanced</SelectItem>
              <SelectItem value="standard_only">Standard only</SelectItem>
              <SelectItem value="advanced_only">Advanced only</SelectItem>
              <SelectItem value="neither">No answer</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.freshness ?? 'all'}
            onValueChange={(v) =>
              setFilters({ freshness: v === 'all' ? undefined : (v as LibraryFilters['freshness']) })
            }
          >
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue placeholder="All freshness" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All freshness</SelectItem>
              <SelectItem value="fresh">Fresh</SelectItem>
              <SelectItem value="aging">Ageing</SelectItem>
              <SelectItem value="stale">Stale</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.verified ?? 'all'}
            onValueChange={(v) =>
              setFilters({ verified: v === 'all' ? undefined : (v as LibraryFilters['verified']) })
            }
          >
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as GroupBy)}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="No grouping" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No grouping</SelectItem>
              <SelectItem value="source">By source document</SelectItem>
              <SelectItem value="domain">By domain</SelectItem>
            </SelectContent>
          </Select>

          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs">
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Q&A List */}
      <div
        className="mt-6 space-y-2"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          const rows = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>('[data-qa-row]'),
          );
          if (rows.length === 0) return;
          const idx = rows.indexOf(document.activeElement as HTMLElement);
          let next: number;
          if (e.key === 'ArrowDown') {
            next = idx < rows.length - 1 ? idx + 1 : 0;
          } else {
            next = idx > 0 ? idx - 1 : rows.length - 1;
          }
          rows[next].focus();
          e.preventDefault();
        }}
      >
        {/* Bulk action toolbar */}
        <BulkActionToolbar
          selectedCount={selectedIds.size}
          isAdmin={canAdmin}
          bulkOperating={bulkOperating}
          bulkProgress={bulkProgress}
          onBulkReclassify={handleBulkReclassify}
          onBulkTag={handleBulkTagOpen}
          onBulkAssign={handleBulkAssignOpen}
          onBulkVerify={handleBulkVerify}
          onBulkDelete={handleBulkDelete}
          onClearSelection={clearSelection}
        />

        {/* Select all header */}
        {!isLoading && items.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/30 border border-border/50">
            <div
              className="flex items-center justify-center min-w-[44px] min-h-[44px] -m-2.5"
              role="presentation"
            >
              <Checkbox
                checked={items.length > 0 && selectedIds.size === items.length}
                onCheckedChange={toggleSelectAll}
                aria-label={
                  selectedIds.size === items.length
                    ? 'Deselect all Q&A pairs'
                    : 'Select all Q&A pairs'
                }
                className="cursor-pointer"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {selectedIds.size === items.length && items.length > 0
                ? `All ${items.length} selected`
                : 'Select all'}
            </span>
          </div>
        )}

        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-accent" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Filter className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {activeCount > 0
                ? 'No Q&A pairs match your filters.'
                : 'No Q&A pairs in the library yet.'}
            </p>
            {activeCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : groupBy !== 'none' ? (
          <div className="space-y-3">
            {Array.from(groupItems(items, groupBy).entries()).map(([groupName, groupedItems]) => (
              <CollapsibleGroup key={groupName} label={groupName} count={groupedItems.length}>
                {groupedItems.map((item) => (
                  <QARow
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </CollapsibleGroup>
            ))}
          </div>
        ) : (
          items.map((item) => (
            <QARow
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelect}
            />
          ))
        )}
      </div>

      {/* Tag dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add tags to {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''}</DialogTitle>
            <DialogDescription>
              Enter comma-separated tags. They will be merged with any existing tags on each item.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="e.g. important, needs-review, client-facing"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleBulkTagConfirm();
              }
            }}
            aria-label="Tags (comma-separated)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkTagConfirm} disabled={!tagInput.trim()}>
              <Tag className="mr-1.5 size-3.5" />
              Apply tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign to workspace dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} to workspace</DialogTitle>
            <DialogDescription>
              Select a workspace to assign the selected Q&A pairs to.
            </DialogDescription>
          </DialogHeader>
          {workspacesLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading workspaces...
            </div>
          ) : (
            <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                    <span className="ml-2 text-xs text-muted-foreground">({ws.type})</span>
                  </SelectItem>
                ))}
                {workspaces.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    No workspaces found
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkAssignConfirm} disabled={!selectedWorkspaceId || workspacesLoading}>
              <FolderPlus className="mr-1.5 size-3.5" />
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
