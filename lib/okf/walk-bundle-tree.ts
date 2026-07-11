/**
 * Full-bundle file-tree walk + traversal-safe path resolution (ID-132
 * {132.32} G-LANDING-IMPL, OKF-LANDING.md LI-15/LI-16/LI-17).
 *
 * Broadens `lib/okf/bundle-graph.ts`'s `walkMarkdownFiles` (which walks
 * *only* `.md` files within an already-resolved bundle, for the concept
 * graph) to the WHOLE bundle tree — every file and nested subdirectory is
 * listable, not only concept markdown (LI-15: "index.md is the entry point,
 * not the boundary"). `bundle-graph.ts` itself is untouched (LI-13
 * non-regression) — this is a net-new, parallel read for the file-explorer
 * surface.
 *
 * `renderable` (LI-16) is a plain `.md`-suffix check: `ontology.json` (the
 * DR-027 machine-facing effective-ontology JSON) and any other non-markdown
 * file is listed but flagged non-renderable, so the render pane can decline
 * to open it as human content. The backing per-file read route
 * (`app/api/okf/[bundleId]/file/route.ts`) additionally enforces this
 * server-side (defense in depth, matching the auth posture elsewhere in this
 * surface).
 *
 * `resolveBundleTreePath` reuses the containment-guard DISCIPLINE already
 * proven in `bundle-graph.ts:extractLinks` (lines ~117-119: `path.resolve` +
 * `path.relative`, rejecting `..`/absolute escapes) — replicated here rather
 * than imported, since `extractLinks` resolves a *discovered markdown link*
 * relative to a document's own directory, while this validates an
 * *arbitrary caller-supplied path* (URL/query) relative to the bundle root;
 * same algorithm, different call shape.
 */
import fs from 'node:fs';
import path from 'node:path';

/** One node in the full-bundle file-explorer tree (LI-15). */
export interface OkfTreeNode {
  name: string;
  /** Bundle-root-relative, POSIX-separated path. */
  path: string;
  type: 'file' | 'directory';
  /** Files only: `false` for machine-facing files (e.g. `ontology.json`) — LI-16. */
  renderable?: boolean;
  /** Directories only. */
  children?: OkfTreeNode[];
}

function toPosixPath(bundleRootResolved: string, fullPath: string): string {
  return path.relative(bundleRootResolved, fullPath).split(path.sep).join('/');
}

function walk(dir: string, bundleRootResolved: string): OkfTreeNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes = entries.map((entry): OkfTreeNode => {
    const full = path.join(dir, entry.name);
    const relPath = toPosixPath(bundleRootResolved, full);
    if (entry.isDirectory()) {
      return {
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: walk(full, bundleRootResolved),
      };
    }
    return {
      name: entry.name,
      path: relPath,
      type: 'file',
      renderable: entry.name.endsWith('.md'),
    };
  });
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Walk `bundleRoot`'s entire working tree (LI-15) into a nested,
 * name-sorted node list. Every file and directory is listed — `ontology.json`
 * included but `renderable: false` (LI-16).
 */
export function walkBundleTree(bundleRoot: string): OkfTreeNode[] {
  const bundleRootResolved = path.resolve(bundleRoot);
  return walk(bundleRootResolved, bundleRootResolved);
}

/**
 * Resolve a caller-supplied bundle-root-relative path to an absolute
 * filesystem path, rejecting any path that would escape `bundleRoot`
 * (LI-17 — the per-file read's traversal-safety guard).
 *
 * @throws when `relPath` resolves outside `bundleRoot` (`..`/absolute
 *   escape, or resolves to the root itself).
 */
export function resolveBundleTreePath(
  bundleRoot: string,
  relPath: string,
): string {
  const bundleRootResolved = path.resolve(bundleRoot);
  const resolved = path.resolve(bundleRootResolved, relPath);
  const rel = path.relative(bundleRootResolved, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes bundle root: ${relPath}`);
  }
  return resolved;
}
