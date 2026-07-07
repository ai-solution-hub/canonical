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

/** One Cytoscape node in the bundle concept graph. */
export interface OkfBundleGraphNode {
  data: {
    id: string;
    label: string;
    type: string;
    description: string;
    resource: string;
    tags: string[];
    size: number;
  };
}

/** One Cytoscape edge (a resolved internal `.md` link) in the bundle concept graph. */
export interface OkfBundleGraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
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
