'use client';

/**
 * `<FileExplorer>` — the connected full-bundle file-explorer container for
 * one bundle (ID-132 {132.32} G-LANDING-IMPL, OKF-LANDING.md LI-15/LI-17/LI-18).
 *
 * Owns the two TanStack Query calls (`GET /api/okf/[bundleId]/tree`,
 * `GET /api/okf/[bundleId]/file`) and composes the presenter pair
 * `<FileTree>` (left rail) + `<FileRenderPane>` (right pane) — mirrors the
 * `<BundleViewer>` "container owns queries, children are presenters"
 * pattern already established for the `/okf/[bundleId]` graph viewer.
 *
 * `index.md` is the DEFAULT-selected file once the tree loads (LI-15:
 * "index.md is the entry point, not the boundary") but never privileged
 * beyond that default — any other tree file remains one click away. The
 * default is fully derived (`selectedPath ?? defaultIndexPath`), never a
 * `useEffect`-driven `setState`, so switching bundles just needs a fresh
 * `key={bundleId}` at the call site (`<OkfLanding>`) to reset local state
 * cleanly (components/CLAUDE.md convention).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileRenderPane } from '@/components/okf/file-render-pane';
import { FileTree } from '@/components/okf/file-tree';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchOkfBundleFile,
  fetchOkfBundleTree,
  type OkfTreeNode,
} from '@/lib/query/okf';

interface FileExplorerProps {
  bundleId: string;
  className?: string;
}

// Stable empty-array default (components/CLAUDE.md) — an inline
// `data?.tree ?? []` would create a new reference every render.
const EMPTY_TREE: OkfTreeNode[] = [];

function flattenRenderablePaths(nodes: OkfTreeNode[]): Set<string> {
  const paths = new Set<string>();
  const walk = (list: OkfTreeNode[]) => {
    for (const node of list) {
      if (node.type === 'file' && node.renderable) paths.add(node.path);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}

/** `index.md` always lives at the bundle root (LI-15) — no need to recurse. */
function findRootIndexPath(nodes: OkfTreeNode[]): string | null {
  const found = nodes.find(
    (node) => node.type === 'file' && node.name === 'index.md',
  );
  return found ? found.path : null;
}

export function FileExplorer({ bundleId, className }: FileExplorerProps) {
  const treeQuery = useQuery({
    queryKey: queryKeys.okf.tree(bundleId),
    queryFn: () => fetchOkfBundleTree(bundleId),
  });

  const tree = treeQuery.data?.tree ?? EMPTY_TREE;
  const knownMdPaths = useMemo(() => flattenRenderablePaths(tree), [tree]);
  const defaultPath = useMemo(() => findRootIndexPath(tree), [tree]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const effectivePath = selectedPath ?? defaultPath;

  const fileQuery = useQuery({
    queryKey: queryKeys.okf.file(bundleId, effectivePath ?? ''),
    queryFn: () => fetchOkfBundleFile(bundleId, effectivePath as string),
    enabled: !!effectivePath,
  });

  if (treeQuery.isLoading) {
    return (
      <div
        className={cn('grid h-full grid-cols-[260px_1fr] gap-2 p-2', className)}
      >
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    );
  }

  if (treeQuery.isError) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-6 text-sm text-destructive',
          className,
        )}
      >
        Failed to load this bundle&apos;s files. Please retry shortly.
      </div>
    );
  }

  return (
    <div
      data-testid="file-explorer"
      className={cn('grid h-full grid-cols-[260px_1fr]', className)}
    >
      <FileTree
        nodes={tree}
        selectedPath={effectivePath}
        onSelectFile={setSelectedPath}
        className="border-r border-border"
      />
      <FileRenderPane
        bundleId={bundleId}
        path={effectivePath}
        content={fileQuery.data?.content ?? null}
        isLoading={!!effectivePath && fileQuery.isLoading}
        isError={!!effectivePath && fileQuery.isError}
        knownMdPaths={knownMdPaths}
        onNavigate={setSelectedPath}
      />
    </div>
  );
}
