/**
 * OKF concept-bundle viewer fetchers (ID-132 {132.14} G-VIEWER).
 *
 * TECH-ADDENDUM-reference-agents.md Part 2 §Target TS surface names this
 * file explicitly ("keys/fetchers in `lib/query/okf.ts`") — a deliberate
 * departure from the two-centralised-file convention documented in
 * `components/CLAUDE.md` ("keys in lib/query/query-keys.ts, fetchers in
 * lib/query/fetchers.ts"). Kept as its own file rather than folded into the
 * already-700+-line `lib/query/fetchers.ts`: query KEYS still live in the
 * centralised `queryKeys.okf` namespace (query-keys.ts) for the standard
 * prefix-invalidation convention; only the OKF-specific fetcher functions
 * and wire types live here, importing the shared `fetchJson` helper.
 */
import { fetchJson } from '@/lib/query/fetchers';

/**
 * Per-bundle-class union-graph styling signal (ID-132 {132.49}
 * G-CONCEPT-GRAPH-UNION) — `'platform'` for the `canonical-okf-system`
 * baseline, `'client'` for a client-business bundle, `'unknown'` when the
 * server couldn't derive a signal. See `lib/okf/bundle-graph.ts` module doc
 * §2 for the derivation (`ontology.json`'s `overlay` key).
 */
export type OkfBundleClassSignal = 'client' | 'platform' | 'unknown';

/** bl-457 `@context` IRI scope for a node's `type` term (DR-082) — see `lib/okf/bundle-graph.ts` module doc §4. */
export type OkfIriScope = 'base' | 'client' | 'unmapped';

/** Relationship type of a resolved internal `.md` link — see `lib/okf/bundle-graph.ts` module doc §4. */
export type OkfEdgeRelationship = 'cites' | 'related';

/**
 * One Cytoscape node in the bundle concept graph. The five `{132.49}`
 * fields (`bundleId`/`bundleClass`/`confidence`/`opacity`/`iriScope`) are
 * OPTIONAL here even though the server always populates them from
 * `lib/okf/bundle-graph.ts` onward — kept optional so older cached
 * responses/test fixtures that predate this Subtask remain valid without a
 * forced rewrite; every reader falls back sensibly (module doc above).
 */
export interface OkfBundleGraphNode {
  data: {
    id: string;
    label: string;
    type: string;
    description: string;
    resource: string;
    tags: string[];
    size: number;
    bundleId?: string;
    bundleClass?: OkfBundleClassSignal;
    confidence?: string | null;
    opacity?: number;
    iriScope?: OkfIriScope;
  };
}

/** One Cytoscape edge (a resolved internal `.md` link) in the bundle concept graph. `relationship` is optional for the same back-compat reason as `OkfBundleGraphNode`'s `{132.49}` fields. */
export interface OkfBundleGraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    relationship?: OkfEdgeRelationship;
  };
}

/** One concept entry under a theme/subtheme heading in `<BundleNav>`. */
export interface OkfBundleNavConcept {
  title: string;
  path: string;
  description: string;
}

/** One `##`/`###` heading node in the `index.md` progressive-disclosure tree. */
export interface OkfBundleNavTheme {
  heading: string;
  level: 2 | 3;
  concepts: OkfBundleNavConcept[];
  children: OkfBundleNavTheme[];
}

/** One producer-run block from `log.md`, reverse-chronological. */
export interface OkfBundleLogEntry {
  heading: string;
  body: string;
}

/** The full envelope returned by `GET /api/okf/[bundleId]/graph`. */
export interface OkfBundleEnvelope {
  nodes: OkfBundleGraphNode[];
  edges: OkfBundleGraphEdge[];
  bodies: Record<string, string>;
  types: string[];
  /** `null` when `index.md` is absent — soft-dep `{132.10}` fallback (type-grouping) is a caller concern. */
  nav: OkfBundleNavTheme[] | null;
  log: OkfBundleLogEntry[];
}

/** Fetch the full bundle envelope (graph + nav + log) for one client bundle. */
export async function fetchOkfBundle(
  bundleId: string,
): Promise<OkfBundleEnvelope> {
  return fetchJson<OkfBundleEnvelope>(
    `/api/okf/${encodeURIComponent(bundleId)}/graph`,
  );
}

/** A single resolved record (`source_documents` / `reference_items` per-row pointer). */
export interface OkfResourceRecordResult {
  table: 'source_documents' | 'reference_items';
  record: Record<string, unknown>;
}

/** A filtered list (`q_a_pairs?scope_tag=…` — BI-8, never a single row). */
export interface OkfResourceListResult {
  table: 'q_a_pairs';
  records: Record<string, unknown>[];
}

export type OkfResourceResult = OkfResourceRecordResult | OkfResourceListResult;

/**
 * Resolve a `canonical://` resource pointer via the secondary lane
 * (`GET /api/okf/resource`). Lazy — only called on a `resource:` chip click,
 * never as part of the primary bundle-graph fetch.
 */
export async function fetchOkfResource(
  uri: string,
): Promise<OkfResourceResult> {
  return fetchJson<OkfResourceResult>(
    `/api/okf/resource?uri=${encodeURIComponent(uri)}`,
  );
}

// ---------------------------------------------------------------------------
// /okf landing — full-bundle file explorer (ID-132 {132.32} G-LANDING-IMPL,
// OKF-LANDING.md LI-3/LI-14/LI-15/LI-16/LI-17). Net-new fetchers alongside
// the G-VIEWER ones above — `fetchOkfBundle`/`fetchOkfResource` are unchanged.
// ---------------------------------------------------------------------------

/** `GET /api/okf/bundles` response — the enumerate-all bundle list (LI-14). */
export interface OkfBundleListResult {
  bundles: string[];
  /** `false` when `OKF_BUNDLE_ROOT` itself is unset/blank (LI-4(a)). */
  configured: boolean;
}

/** Enumerate every configured bundleId (LI-14); never throws on empty/unset root. */
export async function fetchOkfBundleList(): Promise<OkfBundleListResult> {
  return fetchJson<OkfBundleListResult>('/api/okf/bundles');
}

/** One node in the full-bundle file-explorer tree (LI-15/LI-16). */
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

/** `GET /api/okf/[bundleId]/tree` response — one bundle's full file tree. */
export interface OkfBundleTreeResult {
  tree: OkfTreeNode[];
}

/** Fetch the full file-explorer tree for one bundle (LI-15). */
export async function fetchOkfBundleTree(
  bundleId: string,
): Promise<OkfBundleTreeResult> {
  return fetchJson<OkfBundleTreeResult>(
    `/api/okf/${encodeURIComponent(bundleId)}/tree`,
  );
}

/** `GET /api/okf/[bundleId]/file` response — one file's rendered-ready text. */
export interface OkfBundleFileResult {
  path: string;
  content: string;
}

/**
 * Read one within-bundle markdown file's text for the explorer render pane
 * (LI-15). `filePath` is a bundle-root-relative path from the tree (LI-17
 * traversal-safety is enforced server-side).
 */
export async function fetchOkfBundleFile(
  bundleId: string,
  filePath: string,
): Promise<OkfBundleFileResult> {
  return fetchJson<OkfBundleFileResult>(
    `/api/okf/${encodeURIComponent(bundleId)}/file?path=${encodeURIComponent(filePath)}`,
  );
}

// ---------------------------------------------------------------------------
// Deployment-level union graph (ID-132 {132.49} G-CONCEPT-GRAPH-UNION,
// owner-ratified NATIVE/extend path per {132.39} decision memo §6). A new
// route (deliberately NOT a widened param on `GET /api/okf/[bundleId]/graph`
// — a union spans every sibling bundle, orthogonal to a single `bundleId`,
// and has no per-bundle `nav`/`log`, so a distinct envelope shape earns a
// distinct route). AUTHED, same pattern as every other `/api/okf/*` route.
// ---------------------------------------------------------------------------

/** `GET /api/okf/union-graph` response — the deployment-level union of every configured bundle's concept graph. */
export interface OkfUnionGraphEnvelope {
  nodes: OkfBundleGraphNode[];
  edges: OkfBundleGraphEdge[];
  bodies: Record<string, string>;
  types: string[];
}

/** Fetch the whole-deployment union concept graph (every bundle under `OKF_BUNDLE_ROOT`, node/edge ids namespaced by bundleId). */
export async function fetchOkfUnionGraph(): Promise<OkfUnionGraphEnvelope> {
  return fetchJson<OkfUnionGraphEnvelope>('/api/okf/union-graph');
}
