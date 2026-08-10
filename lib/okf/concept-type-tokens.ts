/**
 * OKF concept `type` → semantic design-token map (ID-132 {132.14} G-VIEWER,
 * Reframe A). Replaces the reference viewer's hardcoded `_TYPE_PALETTE` hex
 * map (`generator.py:13-17`) with the `--okf-concept-*` token family
 * (`app/styles/domain-tokens.css`), keyed onto the concept types the
 * producer emits (TECH-ADDENDUM-reference-agents.md Part 2 §Target TS
 * surface).
 *
 * A type this module does not map (e.g. `Unknown`, or a reference-fixture
 * value like `BigQuery Table`) falls back to `--okf-concept-default-*` —
 * it never throws on an unrecognised type. `KNOWN_TYPES` is a colour
 * LEGEND, not a vocabulary: the set of types is open (DR-141), so the
 * legend is expected to lag the corpus and the fallback is the mechanism
 * that makes lagging safe.
 *
 * **PC-4 (ID-163 TECH, DR-079) TS-parity note.** `schema`/`tool`/`api`/
 * `navigation` — the `system_baseline` bundle's concept types — get their
 * own Warm Meridian token mappings below, additive alongside the business
 * types (`playbook` already existed as a business-facet tag colour and is
 * reused unchanged for its system-type sense). This module's `type` render
 * was ALREADY generic, so parity here was additive-only: no hard-gate or
 * schema change.
 *
 * **ID-427 {427.6} / DR-141 — this is now the ONLY concept-type legend.**
 * Every closed concept-type register the platform held is deleted: the
 * producer's `ALLOWED_CONCEPT_TYPES` / `CONCEPT_TYPES` / `_CLASS_CONCEPT_
 * TYPES` in {427.5}, and `lib/ontology/concept-schema.ts`'s
 * `CONCEPT_TYPE_VALUES` in {427.6}. `KNOWN_TYPES` survives BECAUSE it was
 * never a gate — it maps a type to a colour and falls back to
 * `--okf-concept-default-*` for anything unmapped, which is precisely the
 * consumer tolerance OKF §4.1 requires. It must never acquire a rejection
 * path, and no narrow union is derived from it (see the note below).
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
  // ID-427 {427.6} (DR-141) — additive again, and for the same reason the
  // PC-4 block above was: these are types the producer emits.
  // `reference` is the Pass-2 web-enrichment type ({427.6} retyped it from
  // `topic` + a `reference` facet tag); `document`,
  // `questionnaire_response` and `answer_set` are the residual-grain type
  // labels ({427.7}/{427.10}, TECH §1). Listed here BEFORE their emitters
  // land so the legend never lags the bundle — membership is only a colour
  // mapping and never a gate, so an early entry costs nothing.
  //
  // MEMBERSHIP IS A PROMISE THAT TOKENS EXIST. `conceptTypeTokenVars`
  // returns `--okf-concept-<key>-bg/-text` for anything in this list, and
  // `components/okf/concept-detail.tsx` interpolates those names straight
  // into `bg-[var(...)]` with NO fallback — so a key added here without a
  // matching pair in `app/styles/domain-tokens.css` renders worse than an
  // unknown type, which at least resolves to `--okf-concept-default-*`.
  // Every addition below ships with its hue + light/dark token pair.
  'reference',
  'document',
  'questionnaire_response',
  'answer_set',
] as const;

// No `OkfConceptType` narrow union is derived from `KNOWN_TYPES` on purpose.
// Concept `type` is an OPEN string everywhere it matters — the producer has
// no closed set at all since {427.5}/DR-141, `conceptTypeTokenVars`
// deliberately widens to `readonly string[]` so an unmapped type falls back
// to the default token, and `<GraphLegend>`/the type filter enumerate the
// SERVER-computed `types: string[]` from the actual bundle. A narrow alias
// here would have no place to apply itself — and deriving one would quietly
// recreate the closed vocabulary DR-141 withdrew.

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

// ---------------------------------------------------------------------------
// Canvas-renderable colour normalisation
//
// Every token in `domain-tokens.css` is authored in `oklch()`, deliberately —
// it is what makes one lightness/chroma pair reusable across a hue ramp
// (`oklch(0.93 0.04 var(--hue-okf-concept-topic))`). `getComputedStyle` on a
// custom property substitutes the `var()` and returns the rest VERBATIM, so a
// caller receives `oklch(.93 .04 210)`.
//
// The DOM is fine with that. Cytoscape is not: it renders to a 2D canvas and
// parses colours with its own parser, which understands hex, `rgb()`/`rgba()`,
// `hsl()`/`hsla()` and named colours — and nothing from CSS Color 4. It rejects
// the value and logs two lines per element, the second of which is misleading:
//
//   The style property `background-color: oklch(.93 .04 160)` is invalid
//   Do not assign mappings to elements without corresponding data (i.e. ele
//   `certifications/sscm` has no mapping for property `border-color` with data
//   field `borderColor`); try a `[borderColor]` selector to limit scope …
//
// The second message reads like a missing-data bug and is not one — `color`
// and `borderColor` are set on every element by `toElements`. Cytoscape drops
// the mapping when it cannot parse the mapped VALUE, then reports the element
// as having no mapping. Chasing the `[borderColor]` selector the message
// suggests would be chasing a symptom.
//
// So the colours are normalised where they are read, not where they are used:
// one boundary, every consumer covered, and the tokens stay authored in oklch.
// ---------------------------------------------------------------------------

/** CSS Color 4 functions Cytoscape's canvas parser rejects. Legacy syntax is passed through untouched. */
const MODERN_COLOR_FN = /\b(?:oklch|oklab|lch|lab|hwb|color|color-mix)\(/i;

let normalisingContext: CanvasRenderingContext2D | null | undefined;

/** A module-scoped 1x1 context used purely as a colour converter. `null` once known unavailable (jsdom). */
function colorParsingContext(): CanvasRenderingContext2D | null {
  if (normalisingContext !== undefined) return normalisingContext;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    normalisingContext =
      canvas.getContext('2d', { willReadFrequently: true }) ?? null;
  } catch {
    // jsdom throws rather than returning null ("getContext() not implemented").
    normalisingContext = null;
  }
  return normalisingContext;
}

/**
 * Drop the memoised parsing context.
 *
 * Test-only, and the memo is why it has to exist: the context is resolved once
 * and cached, and under jsdom the first resolution caches `null` — so a test
 * that stubs a canvas afterwards would be stubbing something never consulted
 * again. Exported rather than reached for via module internals so the coupling
 * is visible from both sides.
 */
export function resetRenderableColorContextForTests(): void {
  normalisingContext = undefined;
}

/** Paint `value` over `under` on the 1x1 canvas and read the resulting pixel. */
function paintedPixel(
  ctx: CanvasRenderingContext2D,
  value: string,
  under: string,
): Uint8ClampedArray {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = under;
  // An unparseable colour leaves fillStyle at `under` — that is the whole
  // detection mechanism, and it is why `under` differs between the two probes.
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  return ctx.getImageData(0, 0, 1, 1).data;
}

/**
 * Convert a CSS colour into the legacy syntax Cytoscape's canvas parser reads.
 *
 * Uses the browser as the converter — but by PAINTING the colour and reading
 * the pixel back, not by round-tripping `fillStyle`. The round-trip is the
 * obvious approach and it does not work: Chrome parses `oklch()` perfectly well
 * and then serialises `fillStyle` back as `oklch(…)`, because CSS Color 4 says
 * a non-legacy colour keeps its colour space. Measured, not assumed —
 * `fillStyle = 'oklch(0.93 0.04 160)'` reads back as exactly that string, so a
 * round-trip normaliser would have been a silent no-op in production while
 * passing every jsdom test with a stubbed canvas.
 *
 * A painted pixel has no such freedom: it is four sRGB bytes, and sRGB is what
 * the renderer was going to clamp to anyway.
 *
 * **Returns the input unchanged whenever conversion is not possible** — no
 * canvas (jsdom, SSR), or a browser that cannot parse the value either. That is
 * a deliberate no-op rather than a throw or a substituted colour: this function
 * exists to make a renderer's life easier, so it must never be the reason a
 * colour goes missing. A caller that gets its input back is no worse off than
 * before this function existed.
 */
export function toRenderableColor(value: string): string {
  if (!value || !MODERN_COLOR_FN.test(value)) return value;
  const ctx = colorParsingContext();
  if (!ctx) return value;
  try {
    // Two DIFFERENT underlying colours settle parseable-vs-ignored exactly: if
    // the value painted, both pixels match; if it was ignored, each probe
    // painted its own underlay. (One probe would misjudge a colour that happens
    // to paint TO that underlay — `oklch(0 0 0)` under black is a real case.)
    const first = paintedPixel(ctx, value, '#010203');
    const second = paintedPixel(ctx, value, '#040506');
    const painted =
      first[0] === second[0] &&
      first[1] === second[1] &&
      first[2] === second[2] &&
      first[3] === second[3];
    if (!painted) return value;
    const [r, g, b, a] = first;
    return a === 255
      ? `rgb(${r}, ${g}, ${b})`
      : `rgba(${r}, ${g}, ${b}, ${(a! / 255).toFixed(3)})`;
  } catch {
    return value;
  }
}

/**
 * Resolve a concept type's badge colours to concrete CSS colour strings by
 * reading the custom properties off `document.documentElement` — Cytoscape's
 * canvas renderer needs a real colour string, not a `var()` reference, and not
 * a CSS Color 4 function either (see {@link toRenderableColor}).
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
  return { bg: toRenderableColor(bg), text: toRenderableColor(text) };
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
  return {
    fallbackNode: toRenderableColor(fallbackNode),
    selectedBorder: toRenderableColor(selectedBorder),
    edge: toRenderableColor(edge),
  };
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
  return value ? toRenderableColor(value) : fallbackColor;
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
  return value ? toRenderableColor(value) : fallbackColor;
}
