/**
 * OKF bundle concept-graph builder — TS port of the reference viewer's
 * `generator.py` (`_walk_concepts` / `_extract_links` / `_build_graph`,
 * `okf/src/reference_agent/viewer/generator.py:69-126`), ID-132 {132.14}
 * G-VIEWER lift-and-shift.
 *
 * Walks every `.md` file under a bundle root (skipping `index.md`), parses
 * each as an OKF concept document, and resolves internal `.md` links into a
 * Cytoscape-shaped `{nodes, edges}` graph plus a `bodies`/`types` index for
 * the detail panel and type filter.
 *
 * Reframe A (TECH-ADDENDUM-reference-agents.md Part 2): the reference emits
 * a `color`/`palette` field per node for its hardcoded CSS palette. This
 * port DROPS both — semantic design tokens replace every literal colour, so
 * `<ConceptGraph>` resolves a node's fill from `type` via
 * `lib/okf/concept-type-tokens.ts` at render time instead of baking a hex
 * string into the graph payload.
 *
 * Runs SERVER-SIDE ONLY (Node `fs`) — called from
 * `app/api/okf/[bundleId]/graph/route.ts`, never imported into a client
 * bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { parseOkfDocument, OkfDocumentError } from '@/lib/okf/okf-document';

const INDEX_NAME = 'index.md';
// BI-11 (TECH.md:444): a KH bundle also carries a bundle-root `log.md`
// change log, which the REFERENCE format never had (the reference's
// `_walk_concepts` only special-cases `index.md`). Both are bundle-level
// files, never concept docs — skip both, not just `index.md`.
const LOG_NAME = 'log.md';
// Hand-authored bundle-ROOT documents (mirrors the producer's
// `_RESERVED_BUNDLE_FILENAMES`, root-level only — a nested
// `guides/README.md` is still a walkable file): never concept docs.
const RESERVED_ROOT_DOCS = new Set(['README.md', 'CONFORMANCE.md']);
// ](target.md) or ](target.md#anchor) — mirrors generator.py's `_LINK_RE`.
const LINK_RE = /\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_-]*)?\)/g;

export interface BundleGraphNodeData {
  id: string;
  label: string;
  type: string;
  description: string;
  resource: string;
  tags: string[];
  /** Cytoscape node diameter, derived from body length (reference parity). */
  size: number;
}

export interface BundleGraphNode {
  data: BundleGraphNodeData;
}

export interface BundleGraphEdgeData {
  id: string;
  source: string;
  target: string;
}

export interface BundleGraphEdge {
  data: BundleGraphEdgeData;
}

/** The ported `_build_graph` output shape (no `palette` — see module doc). */
export interface BundleGraph {
  nodes: BundleGraphNode[];
  edges: BundleGraphEdge[];
  bodies: Record<string, string>;
  types: string[];
}

interface Concept {
  id: string;
  type: string;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  body: string;
  linksTo: string[];
}

function walkMarkdownFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  walk(root);
  return results.sort();
}

/**
 * Resolve internal `.md` links in `body` to bundle-root-relative concept ids
 * (`.md` suffix stripped, POSIX-separated). A leading-`/` target is the
 * SPEC §5.1 bundle-ABSOLUTE form (the producer's citation-trailer and
 * body-prose cross-link convention) — resolved against the BUNDLE ROOT,
 * never the filesystem root. External links (`://`) and links that resolve
 * outside `bundleRootResolved` are dropped, matching `_extract_links`'s
 * `ValueError`-on-`relative_to` guard.
 */
function extractLinks(
  body: string,
  docDir: string,
  bundleRootResolved: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const target = match[1];
    if (target.includes('://')) continue;

    const resolved = target.startsWith('/')
      ? path.resolve(bundleRootResolved, target.replace(/^\/+/, ''))
      : path.resolve(docDir, target);
    const rel = path.relative(bundleRootResolved, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;

    let relPosix = rel.split(path.sep).join('/');
    if (relPosix.endsWith('.md')) relPosix = relPosix.slice(0, -3);
    if (relPosix && !seen.has(relPosix)) {
      seen.add(relPosix);
      out.push(relPosix);
    }
  }
  return out;
}

function fmString(value: unknown, fallback: string): string {
  return value ? String(value) : fallback;
}

function fmTags(value: unknown): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((t) => String(t));
}

function walkConcepts(bundleRoot: string): Concept[] {
  const bundleRootResolved = path.resolve(bundleRoot);
  const files = walkMarkdownFiles(bundleRootResolved);
  const concepts: Concept[] = [];

  for (const filePath of files) {
    const basename = path.basename(filePath);
    if (basename === INDEX_NAME || basename === LOG_NAME) continue;
    const relPath = path
      .relative(bundleRootResolved, filePath)
      .split(path.sep)
      .join('/');
    if (RESERVED_ROOT_DOCS.has(relPath)) continue;

    const relNoExt = path
      .relative(bundleRootResolved, filePath)
      .replace(/\.md$/, '');
    const conceptId = relNoExt.split(path.sep).join('/');

    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      logger.warn(
        { err, op: 'bundle-graph.walk-concepts.read-failed', filePath },
        `walkConcepts: skipping unreadable file ${filePath}`,
      );
      continue;
    }

    let doc;
    try {
      doc = parseOkfDocument(text);
    } catch (err) {
      if (err instanceof OkfDocumentError) continue;
      throw err;
    }

    const fm = doc.frontmatter ?? {};
    concepts.push({
      id: conceptId,
      type: fmString(fm.type, 'Unknown'),
      title: fmString(fm.title, conceptId),
      description: fmString(fm.description, ''),
      resource: fmString(fm.resource, ''),
      tags: fmTags(fm.tags),
      body: doc.body ?? '',
      linksTo: extractLinks(
        doc.body ?? '',
        path.dirname(filePath),
        bundleRootResolved,
      ),
    });
  }

  return concepts;
}

function toNode(concept: Concept): BundleGraphNode {
  return {
    data: {
      id: concept.id,
      label: concept.title || concept.id,
      type: concept.type,
      description: concept.description,
      resource: concept.resource,
      tags: concept.tags,
      size: 30 + Math.min(60, Math.floor(concept.body.length / 200)),
    },
  };
}

function buildGraph(concepts: Concept[]): BundleGraph {
  const ids = new Set(concepts.map((c) => c.id));
  const nodes = concepts.map(toNode);

  const edges: BundleGraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const concept of concepts) {
    for (const target of concept.linksTo) {
      if (target === concept.id || !ids.has(target)) continue;
      const key = `${concept.id} ${target}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        data: {
          id: `${concept.id}__${target}`,
          source: concept.id,
          target,
        },
      });
    }
  }

  const bodies: Record<string, string> = {};
  for (const concept of concepts) bodies[concept.id] = concept.body;

  const types = Array.from(new Set(concepts.map((c) => c.type))).sort();

  return { nodes, edges, bodies, types };
}

/**
 * Walk `bundleRoot` and build the concept graph — the TS port of
 * `generate_visualization`'s data-derivation half (the reference also
 * inlines the graph into a static HTML file; this port stops at the JSON
 * shape, since the route handler returns it directly as the API response).
 *
 * @throws when `bundleRoot` does not exist or is not a directory.
 */
export function buildBundleGraph(bundleRoot: string): BundleGraph {
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    throw new Error(`Bundle directory not found: ${bundleRoot}`);
  }
  const concepts = walkConcepts(bundleRoot);
  return buildGraph(concepts);
}
