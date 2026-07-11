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
 *
 * **Symlink hardening (post-{132.32} Checker finding, security blocker).**
 * The lexical checks above (`path.resolve`/`path.relative` on the raw
 * string) do NOT detect a committed symlink whose TARGET resolves outside
 * the bundle root — `OKF_BUNDLE_ROOT` is a client-owned, externally-synced
 * git repo (DR-016), so a committed symlink is untrusted input, not
 * something this codebase controls. Two containment layers close this:
 * (1) `walk()` excludes every symlink from the tree listing outright
 * (`Dirent.isSymbolicLink()`, itself an lstat-equivalent check — never
 * followed, whether it points in or out of the bundle root), so a symlink
 * is never *offered* by `GET /api/okf/[bundleId]/tree`; (2)
 * `assertRealpathWithinBundleRoot` re-verifies containment against the REAL
 * (symlink-resolved) filesystem path, closing the gap for a `path` query
 * value an attacker supplies directly to `GET /api/okf/[bundleId]/file`
 * without going through the tree at all. `resolveBundleTreePath` calls it
 * once; the file route calls it again immediately before the actual
 * `fs.readFileSync` (defense in depth — matching this surface's existing
 * "re-check even though an earlier layer already checked" auth posture).
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
  const nodes: OkfTreeNode[] = [];
  for (const entry of entries) {
    // Security: never list a symlink, whether it points inside or outside
    // the bundle root — `entry.isSymbolicLink()` reflects the raw dirent
    // (lstat-equivalent, does not follow the link), so a symlinked file or
    // directory is excluded before any recursion or containment check runs
    // (see module doc "Symlink hardening").
    if (entry.isSymbolicLink()) continue;

    const full = path.join(dir, entry.name);
    const relPath = toPosixPath(bundleRootResolved, full);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: walk(full, bundleRootResolved),
      });
      continue;
    }
    nodes.push({
      name: entry.name,
      path: relPath,
      type: 'file',
      renderable: entry.name.endsWith('.md'),
    });
  }
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
 * Second containment layer (LI-17 hardening, security blocker fix): re-verify
 * containment against the REAL filesystem path — following any symlink —
 * rather than trusting the lexical (string-level) result alone. A committed
 * symlink inside `OKF_BUNDLE_ROOT` (a client-owned, externally-synced git
 * repo, DR-016 — untrusted input) can point anywhere on the host; a purely
 * lexical check on the raw path string cannot detect that, and
 * `fs.readFileSync` transparently follows a symlink to its real target.
 *
 * A no-op (never throws) when nothing exists at `candidatePath` yet — a
 * genuinely-missing path is the caller's 404 concern, not a containment
 * violation, and `fs.realpathSync` would otherwise throw ENOENT for that
 * ordinary case too.
 *
 * Exported so both `resolveBundleTreePath` (below) AND the file-read route
 * (`app/api/okf/[bundleId]/file/route.ts`, immediately before its
 * `fs.readFileSync`) call the identical check — defense in depth without
 * duplicating the containment algorithm in two places.
 *
 * @throws when `candidatePath`'s real (symlink-resolved) path resolves
 *   outside the bundle root's real path.
 */
export function assertRealpathWithinBundleRoot(
  bundleRoot: string,
  candidatePath: string,
): void {
  if (!fs.existsSync(candidatePath)) return;

  const realBundleRoot = fs.realpathSync(path.resolve(bundleRoot));
  const realCandidate = fs.realpathSync(candidatePath);
  const rel = path.relative(realBundleRoot, realCandidate);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Path escapes bundle root (symlink target): ${candidatePath}`,
    );
  }
}

/**
 * Resolve a caller-supplied bundle-root-relative path to an absolute
 * filesystem path, rejecting any path that would escape `bundleRoot`
 * (LI-17 — the per-file read's traversal-safety guard).
 *
 * Two containment checks: a lexical one on the raw path string, THEN
 * `assertRealpathWithinBundleRoot`'s real-filesystem (symlink-resolved)
 * re-verification (see that function's doc comment).
 *
 * @throws when `relPath` resolves outside `bundleRoot` (`..`/absolute
 *   escape, resolves to the root itself, or a symlink whose real target
 *   escapes the root).
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

  assertRealpathWithinBundleRoot(bundleRootResolved, resolved);

  return resolved;
}
