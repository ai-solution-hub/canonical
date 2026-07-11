'use client';

/**
 * `<FileTree>` — the full-bundle file-explorer tree (ID-132 {132.32}
 * G-LANDING-IMPL, OKF-LANDING.md LI-15/LI-16).
 *
 * Recursively renders every node `walkBundleTree` (via `GET
 * /api/okf/[bundleId]/tree`) surfaced — directories and files alike, at any
 * nesting depth. `index.md` is not privileged in this component (it renders
 * as an ordinary tree entry); `<FileExplorer>` is the one that treats it as
 * the default-selected entry (LI-15: "index.md is the entry point, not the
 * boundary").
 *
 * A file node with `renderable: false` (LI-16 — `ontology.json` and any
 * other machine-facing file) renders as plain, non-interactive text rather
 * than a button: it is listed, per the ratified rule, but never openable in
 * the render pane.
 */
import { Waypoints, FileText, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OkfTreeNode } from '@/lib/query/okf';

interface FileTreeProps {
  nodes: OkfTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  className?: string;
}

function TreeNode({
  node,
  selectedPath,
  onSelectFile,
  depth,
}: {
  node: OkfTreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  depth: number;
}) {
  const indent = { paddingLeft: `${depth * 0.75}rem` };

  if (node.type === 'directory') {
    return (
      <li>
        <div
          style={indent}
          className="flex items-center gap-1.5 py-1 text-sm font-semibold text-muted-foreground"
        >
          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
          {node.name}
        </div>
        <ul>
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
        </ul>
      </li>
    );
  }

  const selected = node.path === selectedPath;

  if (!node.renderable) {
    return (
      <li>
        <div
          style={indent}
          className="flex items-center gap-1.5 py-1 text-sm text-muted-foreground/70"
          aria-label={`${node.name} (machine-facing file, not rendered)`}
        >
          <Waypoints className="size-3.5 shrink-0" aria-hidden="true" />
          {node.name}
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        style={indent}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelectFile(node.path)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1 text-left text-sm transition-colors',
          selected
            ? 'bg-accent text-accent-foreground'
            : 'text-foreground hover:bg-accent/50',
        )}
      >
        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
        {node.name}
      </button>
    </li>
  );
}

export function FileTree({
  nodes,
  selectedPath,
  onSelectFile,
  className,
}: FileTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className={cn('p-4 text-sm text-muted-foreground', className)}>
        This bundle has no files yet.
      </div>
    );
  }

  return (
    <nav
      aria-label="Bundle file tree"
      data-testid="file-tree"
      className={cn('overflow-y-auto p-2', className)}
    >
      <ul className="space-y-0.5">
        {nodes.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            depth={0}
          />
        ))}
      </ul>
    </nav>
  );
}
