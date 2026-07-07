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
 */

const KNOWN_TYPES = [
  'topic',
  'product',
  'company',
  'certification',
  'case_study',
  'metric',
  'dataset',
  'playbook',
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
