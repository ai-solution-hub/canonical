/**
 * OKF concept `type` → semantic design-token map (ID-132 {132.14} G-VIEWER,
 * Reframe A). Replaces the reference viewer's hardcoded `_TYPE_PALETTE` hex
 * map (`generator.py:13-17`) with the `--okf-concept-*` token family
 * (`app/styles/domain-tokens.css`), keyed onto OUR concept types
 * `{topic, product, company, certification, case_study, metric, dataset,
 * playbook}` (TECH-ADDENDUM-reference-agents.md Part 2 §Target TS surface).
 *
 * A type outside this closed set (e.g. `Unknown`, or a reference-fixture
 * value like `BigQuery Table`) falls back to `--okf-concept-default-*` —
 * this module never throws on an unrecognised type, since the producer's
 * frontmatter `type` field is not (yet) enforced against a shared CV at the
 * viewer boundary.
 *
 * **PC-4 (ID-163 TECH, DR-079) TS-parity note.** The producer validator's
 * BI-4 concept-type gate is now bundle-CLASS-scoped
 * (`scripts/cocoindex_pipeline/producer/validator.py`'s
 * `EffectiveOntology.base_for_class`) — a `system_baseline` bundle's
 * concept types are `{schema, tool, api, navigation, playbook}`, distinct
 * from the `client_business`/`showcase` business set above. This module's
 * `type` render was ALREADY generic (see `lib/ontology/concept-schema.ts`'s
 * "type parity note" — `ConceptFrontmatterSchema.type` never hard-gated
 * against a closed set), so full parity here is additive-only: `schema`/
 * `tool`/`api`/`navigation` get their own Warm Meridian token mappings
 * below (`playbook` already existed as a business-facet tag colour and is
 * reused unchanged for its system-type sense). No hard-gate/schema change.
 */
import type {
  OkfBundleClassSignal,
  OkfIriScope,
  OkfEdgeRelationship,
} from '@/lib/query/okf';

const KNOWN_TYPES = [
  'topic',
  'product',
  'company',
  'certification',
  'case_study',
  'metric',
  'dataset',
  'playbook',
  // PC-4 (ID-163) system_baseline concept types — additive, business types
  // above are untouched.
  'schema',
  'tool',
  'api',
  'navigation',
] as const;

export type OkfConceptType = (typeof KNOWN_TYPES)[number];

/** CSS custom-property names for one concept type's badge/node colours. */
export interface ConceptTypeTokenVars {
  bg: string;
  text: string;
}

const DEFAULT_VARS: ConceptTypeTokenVars = {
  bg: '--okf-concept-default-bg',
  text: '--okf-concept-default-text',
};

function normalise(type: string): string {
  return type
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** The CSS custom-property NAMES (not resolved values) for a concept type. */
export function conceptTypeTokenVars(type: string): ConceptTypeTokenVars {
  const key = normalise(type);
  if ((KNOWN_TYPES as readonly string[]).includes(key)) {
    return { bg: `--okf-concept-${key}-bg`, text: `--okf-concept-${key}-text` };
  }
  return DEFAULT_VARS;
}

/**
 * Resolve a concept type's badge colours to concrete CSS colour strings by
 * reading the custom properties off `document.documentElement` — Cytoscape's
 * canvas renderer needs a real colour string, not a `var()` reference.
 * Returns `null` outside a browser (SSR) — callers fall back to a default.
 */
export function resolveConceptTypeColor(
  type: string,
): ConceptTypeTokenVars | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  const vars = conceptTypeTokenVars(type);
  const styles = getComputedStyle(document.documentElement);
  const bg = styles.getPropertyValue(vars.bg).trim();
  const text = styles.getPropertyValue(vars.text).trim();
  if (!bg || !text) return null;
  return { bg, text };
}

/**
 * CSS custom-property names for the concept graph's non-per-type chrome —
 * fallback node fill, selected-node border, edge line (`--okf-graph-*`,
 * `app/styles/domain-tokens.css`). Distinct from `ConceptTypeTokenVars`
 * (per-type badge/node colours): these style the `<ConceptGraph>` Cytoscape
 * canvas itself, not a concept type.
 */
export interface GraphChromeTokenVars {
  fallbackNode: string;
  selectedBorder: string;
  edge: string;
}

const GRAPH_CHROME_VARS: GraphChromeTokenVars = {
  fallbackNode: '--okf-graph-node-fallback',
  selectedBorder: '--okf-graph-selected-border',
  edge: '--okf-graph-edge',
};

/**
 * Resolve the concept graph's chrome colours to concrete CSS colour strings
 * via the same `getComputedStyle()` read as `resolveConceptTypeColor` —
 * Cytoscape's canvas renderer needs a real colour string, not a `var()`
 * reference. Returns `null` outside a browser, or when any of the three
 * custom properties is not defined (e.g. SSR, or a test environment that
 * never loaded `domain-tokens.css`) — callers fall back to a default.
 */
export function resolveGraphChromeColors(): GraphChromeTokenVars | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  const styles = getComputedStyle(document.documentElement);
  const fallbackNode = styles
    .getPropertyValue(GRAPH_CHROME_VARS.fallbackNode)
    .trim();
  const selectedBorder = styles
    .getPropertyValue(GRAPH_CHROME_VARS.selectedBorder)
    .trim();
  const edge = styles.getPropertyValue(GRAPH_CHROME_VARS.edge).trim();
  if (!fallbackNode || !selectedBorder || !edge) return null;
  return { fallbackNode, selectedBorder, edge };
}

// ---------------------------------------------------------------------------
// Union-graph doctrine deltas (ID-132 {132.49} G-CONCEPT-GRAPH-UNION) — a
// per-bundleClass node SHAPE (a structural, non-colour Cytoscape channel —
// no design token needed, `components/CLAUDE.md`'s "no raw Tailwind
// colours" rule scopes to COLOUR properties only) plus bl-457 iriScope /
// edge-relationship COLOUR resolvers, following the exact never-throws /
// SSR-returns-fallback / computed-style-read pattern established above by
// `resolveConceptTypeColor`/`resolveGraphChromeColors`. Types imported from
// the CLIENT-safe `lib/query/okf.ts` wire types, never from the
// server-only `lib/okf/bundle-graph.ts` (this module runs client-side).
// ---------------------------------------------------------------------------

/** Cytoscape `shape` value per {132.49} `bundleClass` — a structural (non-colour) legend channel. Never throws; an absent/unrecognised value falls back to `'diamond'` ("unknown"). */
export function bundleClassShape(
  bundleClass: OkfBundleClassSignal | undefined,
): 'ellipse' | 'round-rectangle' | 'diamond' {
  switch (bundleClass) {
    case 'client':
      return 'ellipse';
    case 'platform':
      return 'round-rectangle';
    default:
      return 'diamond';
  }
}

const IRI_SCOPE_BORDER_VARS: Record<'base' | 'client', string> = {
  base: '--okf-graph-iri-base-border',
  client: '--okf-graph-iri-client-border',
};

/**
 * Resolve a node's bl-457 `iriScope` to a concrete border-colour string.
 * `'unmapped'`/absent (or SSR / a test environment without
 * `domain-tokens.css`) falls back to `fallbackColor` — callers pass the
 * already-resolved `--okf-graph-node-fallback` chrome colour, keeping an
 * unmapped-scope border visually neutral rather than a hardcoded literal.
 */
export function resolveIriScopeBorderColor(
  iriScope: OkfIriScope | undefined,
  fallbackColor: string,
): string {
  if (
    (iriScope !== 'base' && iriScope !== 'client') ||
    typeof window === 'undefined' ||
    typeof document === 'undefined'
  ) {
    return fallbackColor;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(IRI_SCOPE_BORDER_VARS[iriScope])
    .trim();
  return value || fallbackColor;
}

/**
 * Resolve an edge's {132.49} `relationship` to a concrete line-colour
 * string. `'related'` (the pre-existing default) and any absent/
 * unrecognised value fall back to `fallbackColor` — callers pass the
 * already-resolved `--okf-graph-edge` chrome colour; only `'cites'`
 * resolves to the distinct `--okf-graph-edge-cites` token.
 */
export function resolveEdgeRelationshipColor(
  relationship: OkfEdgeRelationship | undefined,
  fallbackColor: string,
): string {
  if (
    relationship !== 'cites' ||
    typeof window === 'undefined' ||
    typeof document === 'undefined'
  ) {
    return fallbackColor;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--okf-graph-edge-cites')
    .trim();
  return value || fallbackColor;
}
