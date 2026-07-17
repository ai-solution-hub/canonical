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
 * `app/api/okf/[bundleId]/graph/route.ts` and
 * `app/api/okf/union-graph/route.ts`, never imported into a client bundle.
 *
 * **G-CONCEPT-GRAPH-UNION (ID-132 {132.49}, owner-ratified NATIVE/extend
 * path per {132.39} decision memo §6).** Widens the single-bundle builder
 * with four doctrine deltas, all additive to the shipped node/edge shape:
 *
 * 1. **Union graph build.** `buildUnionBundleGraph` runs `buildBundleGraph`
 *    per sibling bundle root (`lib/okf/enumerate-bundles.ts` supplies the
 *    roots) and merges the results, namespacing every node/edge id by
 *    `bundleId` (`namespaceUnionId`) so two bundles can never collide even
 *    when they share a concept's relative path. `buildBundleGraph` itself
 *    is UNCHANGED for the existing single-bundle route
 *    (`app/api/okf/[bundleId]/graph/route.ts`) — its node ids stay
 *    unnamespaced, since `<BundleNav>`/`<BundleLog>` backlink/nav wiring
 *    depends on the raw concept id matching `index.md`/`log.md`.
 * 2. **`bundleClass` signal.** The Python producer's `BundleClass` enum
 *    (`scripts/cocoindex_pipeline/producer/bundle_writer.py`,
 *    `client_business | system_baseline | showcase | internal_dev`) is a
 *    RUN-TIME parameter never persisted verbatim to any on-disk bundle
 *    artefact — confirmed by reading `bundle_writer.py`/`flow_def.py`
 *    end-to-end. The best available on-disk signal is the DR-027 ontology
 *    artefact's `overlay` key (`write_ontology_artefact`): `null` for every
 *    non-`client_business` class (OV-10, `bundle_writer.py:1237-1254`), a
 *    composed object for `client_business`. `readBundleClassSignal` derives
 *    a coarser binary `'platform' | 'client'` from that key (`'unknown'`
 *    when `ontology.json` is absent/malformed — never throws), which is
 *    sufficient for the union view's styling need (the decision memo frames
 *    the split as "client vs canonical-okf-system baseline").
 * 3. **A19 `confidence` -> opacity.** `confidenceToOpacity` maps the
 *    producer-emitted categorical `confidence` frontmatter (bl-477,
 *    `producer/frontmatter.py::_CONFIDENCE_VALUES`) to a Cytoscape opacity
 *    tier. DR-081a: the producer currently emits only `strong`/`partial` in
 *    practice; the map still covers the full ratified vocabulary
 *    defensively. Absent confidence renders full-opacity.
 * 4. **Relationship-typed edges + bl-457 IRI scope.** `extractTypedLinks`
 *    splits each concept body at its `# Citations` heading (mirroring the
 *    S451-rider convention already documented above `RESERVED_ROOT_DOCS`):
 *    a link found within that trailer types `cites`; any other internal
 *    link types `related`. `resolveIriScope` projects a node's `type` term
 *    through the bl-457 `context.jsonld` `@context` map
 *    (`producer/iri_projection.py`, DR-082 namespace
 *    `https://w3id.org/canonical/ontology`) into `'base' | 'client' |
 *    'unmapped'` by comparing the minted IRI's prefix against the
 *    `@context`'s own `base`/`client` namespace-prefix entries.
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

// {132.49} G-CONCEPT-GRAPH-UNION — reserved bundle-root artefacts this
// module reads for the union doctrine deltas (never walked as concept
// docs — both are `.json`/`.jsonld`, already excluded by `walkMarkdownFiles`'s
// `.md`-only filter, so no change to that filter is needed).
const ONTOLOGY_FILENAME = 'ontology.json';
const CONTEXT_FILENAME = 'context.jsonld';
// The S451-rider citation-trailer heading (`# Citations`, any `#`-`######`
// level) — mirrors the producer/reference convention every existing
// concept fixture already uses.
const CITATIONS_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+Citations[ \t]*$/im;

export type BundleClassSignal = 'client' | 'platform' | 'unknown';
export type IriScope = 'base' | 'client' | 'unmapped';
export type EdgeRelationship = 'cites' | 'related';

export interface BundleGraphNodeData {
  id: string;
  label: string;
  type: string;
  description: string;
  resource: string;
  tags: string[];
  /** Cytoscape node diameter, derived from body length (reference parity). */
  size: number;
  /** The bundleId this node belongs to — unnamespaced single-bundle builds still set this (defaults to the resolved root's basename). */
  bundleId: string;
  /** Per-bundle-class styling signal, derived from `ontology.json`'s `overlay` key (see module doc §2) — never throws. */
  bundleClass: BundleClassSignal;
  /** A19 (bl-477) categorical confidence, `null` when the concept carries no `confidence` frontmatter. */
  confidence: string | null;
  /** `confidence` mapped to a Cytoscape opacity tier (module doc §3) — absent confidence renders full-opacity (`1`). */
  opacity: number;
  /** bl-457 `@context` IRI scope for this node's `type` term (module doc §4) — `'unmapped'` when `context.jsonld` is absent or the type has no `@context` entry. */
  iriScope: IriScope;
}

export interface BundleGraphNode {
  data: BundleGraphNodeData;
}

export interface BundleGraphEdgeData {
  id: string;
  source: string;
  target: string;
  /** `'cites'` for a link found in the concept's `# Citations` trailer, `'related'` for any other internal cross-link (module doc §4). */
  relationship: EdgeRelationship;
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

interface TypedLink {
  target: string;
  relationship: EdgeRelationship;
}

interface Concept {
  id: string;
  type: string;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  confidence: string | null;
  body: string;
  linksTo: TypedLink[];
}

/** Per-bundle context shared by every node/edge derived from one bundle root. */
interface BundleMeta {
  bundleId: string;
  bundleClass: BundleClassSignal;
  context: ContextDocument | null;
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
 * Resolve internal `.md` links in `text` to bundle-root-relative concept ids
 * (`.md` suffix stripped, POSIX-separated). A leading-`/` target is the
 * SPEC §5.1 bundle-ABSOLUTE form (the producer's citation-trailer and
 * body-prose cross-link convention) — resolved against the BUNDLE ROOT,
 * never the filesystem root. External links (`://`) and links that resolve
 * outside `bundleRootResolved` are dropped, matching `_extract_links`'s
 * `ValueError`-on-`relative_to` guard.
 */
function extractLinks(
  text: string,
  docDir: string,
  bundleRootResolved: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
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

/**
 * Split `body` at its `# Citations` heading (any level, case-insensitive)
 * into `{ main, citations }` — `citations` runs from the heading line to
 * the next heading of the SAME OR SHALLOWER level, or end-of-body. No
 * heading present -> `{ main: body, citations: '' }`.
 */
function splitCitationsTrailer(body: string): {
  main: string;
  citations: string;
} {
  const match = CITATIONS_HEADING_RE.exec(body);
  if (!match) return { main: body, citations: '' };

  const headingLevel = match[1].length;
  const headingStart = match.index;
  const afterHeading = body.slice(headingStart + match[0].length);
  const nextHeadingRe = new RegExp(
    `^ {0,3}#{1,${headingLevel}}[ \\t]+\\S`,
    'm',
  );
  const nextMatch = nextHeadingRe.exec(afterHeading);
  const citationsEnd =
    nextMatch !== null
      ? headingStart + match[0].length + nextMatch.index
      : body.length;

  return {
    main: body.slice(0, headingStart) + body.slice(citationsEnd),
    citations: body.slice(headingStart, citationsEnd),
  };
}

/**
 * Resolve every internal `.md` link in `body` into a relationship-typed
 * link ({132.49} module doc §4). A link inside the `# Citations` trailer is
 * processed FIRST so it wins the per-concept dedup below — a target cited
 * in the trailer is a `cites` edge even when the SAME target is also
 * mentioned inline in the prose body.
 */
function extractTypedLinks(
  body: string,
  docDir: string,
  bundleRootResolved: string,
): TypedLink[] {
  const { main, citations } = splitCitationsTrailer(body);
  const out: TypedLink[] = [];
  const seen = new Set<string>();

  for (const target of extractLinks(citations, docDir, bundleRootResolved)) {
    if (seen.has(target)) continue;
    seen.add(target);
    out.push({ target, relationship: 'cites' });
  }
  for (const target of extractLinks(main, docDir, bundleRootResolved)) {
    if (seen.has(target)) continue;
    seen.add(target);
    out.push({ target, relationship: 'related' });
  }
  return out;
}

function fmString(value: unknown, fallback: string): string {
  return value ? String(value) : fallback;
}

function fmNullableString(value: unknown): string | null {
  return value ? String(value) : null;
}

function fmTags(value: unknown): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((t) => String(t));
}

// A19 (bl-477) confidence -> opacity tiers (module doc §3). Covers the full
// ratified `producer/frontmatter.py::_CONFIDENCE_VALUES` vocabulary
// defensively — DR-081a: the producer currently emits only
// `strong`/`partial` in practice.
const CONFIDENCE_OPACITY: Record<string, number> = {
  strong: 1,
  partial: 0.55,
  'no-content': 0.3,
  'needs-SME': 0.3,
};

/**
 * Map an A19 categorical confidence to a Cytoscape opacity tier. Absent
 * confidence renders full-opacity; an unrecognised (e.g. future-vocabulary)
 * value also falls back to full-opacity — never throws.
 */
export function confidenceToOpacity(
  confidence: string | null | undefined,
): number {
  if (!confidence) return 1;
  return CONFIDENCE_OPACITY[confidence] ?? 1;
}

/**
 * Derive a coarse `BundleClassSignal` from `ontology.json`'s `overlay` key
 * (module doc §2) — `null`/absent overlay -> `'platform'`, a composed
 * overlay object -> `'client'`, anything unreadable/malformed/absent ->
 * `'unknown'`. Never throws.
 */
function readBundleClassSignal(bundleRootResolved: string): BundleClassSignal {
  const ontologyPath = path.join(bundleRootResolved, ONTOLOGY_FILENAME);
  try {
    if (!fs.existsSync(ontologyPath)) return 'unknown';
    const parsed = JSON.parse(fs.readFileSync(ontologyPath, 'utf-8')) as {
      overlay?: unknown;
    };
    if (parsed && typeof parsed === 'object' && 'overlay' in parsed) {
      return parsed.overlay === null || parsed.overlay === undefined
        ? 'platform'
        : 'client';
    }
    return 'unknown';
  } catch (err) {
    logger.warn(
      {
        err,
        op: 'bundle-graph.read-bundle-class.failed',
        bundleRootResolved,
      },
      `readBundleClassSignal: could not read/parse ${ONTOLOGY_FILENAME}, defaulting to 'unknown'`,
    );
    return 'unknown';
  }
}

/** The bl-457 `context.jsonld` `@context` shape (`producer/iri_projection.py::project_context`) — reserved `base`/`client` namespace-prefix keys plus one `{term: iri}` entry per minted ontology term. */
interface ContextDocument {
  base?: string;
  client?: string;
  [term: string]: unknown;
}

/** Read + parse a bundle's `context.jsonld` `@context` map (module doc §4). Returns `null` when absent/malformed — never throws. */
function readContextDocument(
  bundleRootResolved: string,
): ContextDocument | null {
  const contextPath = path.join(bundleRootResolved, CONTEXT_FILENAME);
  try {
    if (!fs.existsSync(contextPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(contextPath, 'utf-8')) as {
      '@context'?: unknown;
    };
    const ctx = parsed?.['@context'];
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return null;
    return ctx as ContextDocument;
  } catch (err) {
    logger.warn(
      { err, op: 'bundle-graph.read-context.failed', bundleRootResolved },
      `readContextDocument: could not read/parse ${CONTEXT_FILENAME}, IRI colouring falls back to 'unmapped'`,
    );
    return null;
  }
}

/** Resolve a node's `type` term to an `IriScope` via the bundle's `@context` map (module doc §4). */
function resolveIriScope(
  context: ContextDocument | null,
  type: string,
): IriScope {
  if (!context) return 'unmapped';
  const iri = context[type];
  if (typeof iri !== 'string') return 'unmapped';
  if (typeof context.base === 'string' && iri.startsWith(context.base)) {
    return 'base';
  }
  if (typeof context.client === 'string' && iri.startsWith(context.client)) {
    return 'client';
  }
  return 'unmapped';
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
      confidence: fmNullableString(fm.confidence),
      body: doc.body ?? '',
      linksTo: extractTypedLinks(
        doc.body ?? '',
        path.dirname(filePath),
        bundleRootResolved,
      ),
    });
  }

  return concepts;
}

function toNode(concept: Concept, meta: BundleMeta): BundleGraphNode {
  return {
    data: {
      id: concept.id,
      label: concept.title || concept.id,
      type: concept.type,
      description: concept.description,
      resource: concept.resource,
      tags: concept.tags,
      size: 30 + Math.min(60, Math.floor(concept.body.length / 200)),
      bundleId: meta.bundleId,
      bundleClass: meta.bundleClass,
      confidence: concept.confidence,
      opacity: confidenceToOpacity(concept.confidence),
      iriScope: resolveIriScope(meta.context, concept.type),
    },
  };
}

function buildGraph(concepts: Concept[], meta: BundleMeta): BundleGraph {
  const ids = new Set(concepts.map((c) => c.id));
  const nodes = concepts.map((c) => toNode(c, meta));

  const edges: BundleGraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const concept of concepts) {
    for (const link of concept.linksTo) {
      const { target, relationship } = link;
      if (target === concept.id || !ids.has(target)) continue;
      const key = `${concept.id} ${target}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        data: {
          id: `${concept.id}__${target}`,
          source: concept.id,
          target,
          relationship,
        },
      });
    }
  }

  const bodies: Record<string, string> = {};
  for (const concept of concepts) bodies[concept.id] = concept.body;

  const types = Array.from(new Set(concepts.map((c) => c.type))).sort();

  return { nodes, edges, bodies, types };
}

export interface BuildBundleGraphOptions {
  /** Node-data `bundleId` tag. Defaults to `path.basename(bundleRoot)` — the existing single-bundle route never sets this explicitly, so ids stay unnamespaced/back-compat; `buildUnionBundleGraph` always passes it explicitly. */
  bundleId?: string;
}

/**
 * Walk `bundleRoot` and build the concept graph — the TS port of
 * `generate_visualization`'s data-derivation half (the reference also
 * inlines the graph into a static HTML file; this port stops at the JSON
 * shape, since the route handler returns it directly as the API response).
 *
 * @throws when `bundleRoot` does not exist or is not a directory.
 */
export function buildBundleGraph(
  bundleRoot: string,
  options: BuildBundleGraphOptions = {},
): BundleGraph {
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    throw new Error(`Bundle directory not found: ${bundleRoot}`);
  }
  const bundleRootResolved = path.resolve(bundleRoot);
  const bundleId = options.bundleId ?? path.basename(bundleRootResolved);
  const bundleClass = readBundleClassSignal(bundleRootResolved);
  const context = readContextDocument(bundleRootResolved);
  const concepts = walkConcepts(bundleRoot);
  return buildGraph(concepts, { bundleId, bundleClass, context });
}

/** One sibling bundle root the deployment-level union graph merges in. */
export interface UnionBundleSource {
  bundleId: string;
  root: string;
}

const UNION_ID_SEPARATOR = '::';

/** Namespace a per-bundle concept/edge id for the union graph. */
export function namespaceUnionId(bundleId: string, id: string): string {
  return `${bundleId}${UNION_ID_SEPARATOR}${id}`;
}

/**
 * Build the deployment-level UNION concept graph across every sibling
 * bundle root ({132.49} module doc §1). Reuses `buildBundleGraph` per
 * source (single source of truth for the per-bundle walk/doctrine deltas)
 * and namespaces every node/edge id by `bundleId` so two bundles can never
 * collide, even when they share a concept's relative path — applied
 * uniformly regardless of source count (one bundle still namespaces) for a
 * single, predictable id scheme.
 *
 * Never throws: zero sources -> an empty graph (LI-4-style graceful
 * degradation, matching `enumerateOkfBundles`'s never-throws convention);
 * a source whose `root` no longer exists on disk (a race between
 * enumeration and build) is skipped with a WARNING log rather than failing
 * the whole union for one missing bundle.
 */
export function buildUnionBundleGraph(
  sources: UnionBundleSource[],
): BundleGraph {
  const nodes: BundleGraphNode[] = [];
  const edges: BundleGraphEdge[] = [];
  const bodies: Record<string, string> = {};
  const types = new Set<string>();

  for (const { bundleId, root } of sources) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      logger.warn(
        { op: 'bundle-graph.build-union.missing-root', bundleId, root },
        `buildUnionBundleGraph: skipping missing bundle root for bundleId=${bundleId}`,
      );
      continue;
    }

    const perBundle = buildBundleGraph(root, { bundleId });

    for (const node of perBundle.nodes) {
      const namespacedId = namespaceUnionId(bundleId, node.data.id);
      nodes.push({ data: { ...node.data, id: namespacedId } });
      bodies[namespacedId] = perBundle.bodies[node.data.id] ?? '';
    }
    for (const edge of perBundle.edges) {
      edges.push({
        data: {
          ...edge.data,
          id: namespaceUnionId(bundleId, edge.data.id),
          source: namespaceUnionId(bundleId, edge.data.source),
          target: namespaceUnionId(bundleId, edge.data.target),
        },
      });
    }
    for (const type of perBundle.types) types.add(type);
  }

  return { nodes, edges, bodies, types: Array.from(types).sort() };
}
