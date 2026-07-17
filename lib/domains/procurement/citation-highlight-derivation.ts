/**
 * ID-147 {147.12} — B1 text-layer citation coordinate derivation
 * (TECH §4, PRODUCT §D1-D3, DR-064).
 *
 * `citations` has no geometry column — it is text-span anchored only
 * (`cited_text` + `cited_start`/`cited_end`, `cited_location_kind` in
 * ('block','char','page') — see the `citations` table in
 * supabase/migrations/20260617130000_squash_baseline.sql). Coordinates are
 * therefore DERIVED, never stored.
 *
 * B1 is the primary, exact path (§D2 exact path): resolve the citation
 * span against `react-pdf`'s rendered TextLayer DOM inside `PdfDocument`
 * (components/reader/pdf-document.tsx) via the Range/`getClientRects` API,
 * then normalise the resulting client rects to page-relative percentages —
 * the shape the vendored Extend `HighlightArea` type (147.6,
 * components/procurement/extend/bounding-box-citations.tsx) consumes
 * directly as CSS `%` (top-left origin, no y-flip). Deterministic, no API
 * call — covers text-based PDFs (most UK procurement forms).
 *
 * Intentionally decoupled from the 147.6 vendored Extend surface: the
 * `HighlightArea` type below is a structural mirror (left/top/width/height,
 * 0-100 percentages), not an import, so this module has zero runtime
 * dependency on the Extend component set until wire-time (W7 = {145.47}).
 *
 * When neither this (B1) nor the vision fallback
 * (`citation-vision-rasterise.ts`, B2) yields a mappable region, callers
 * receive `{ status: 'unmappable' }` — the signal to render the citation as
 * a text-anchored entry in `document-citations-panel.tsx`, never a
 * misplaced box (§D3).
 */

/** A DOMRect-shaped rectangle — accepts real `DOMRect`/`ClientRect` values structurally. */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Page-relative highlight box, percentages in [0, 100], top-left origin.
 * Structurally identical to the vendored Extend `HighlightArea`
 * (components/procurement/extend/bounding-box-citations.tsx) — see the
 * module doc above for why this is a mirror, not an import.
 */
export interface HighlightArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The subset of a `citations` row B1/B2 need to resolve on-page
 * coordinates. Field names match the DB columns directly (snake_case) to
 * minimise translation at wire-time.
 */
export interface CitationSpan {
  cited_text: string;
  cited_start: number | null;
  cited_end: number | null;
}

/**
 * The degrade contract shared by B1 and B2 (§D3): either a resolved,
 * page-relative box, or an explicit unmappable signal — never a guessed or
 * partially-computed box.
 */
export type CitationHighlightResult =
  | { status: 'mapped'; area: HighlightArea; method: 'text-layer' | 'vision' }
  | { status: 'unmappable' };

/**
 * Union a set of client rects (e.g. from `Range.getClientRects()` — a
 * citation span may wrap onto multiple lines) into a single bounding box,
 * then normalise it against a container rect (e.g. the TextLayer root's
 * `getBoundingClientRect()`) into page-relative percentages.
 *
 * Returns `null` when there is nothing to map: no rects, a zero-area
 * container (unmeasured layout), or a rect that clamps to zero overlap
 * with the container.
 */
export function normaliseRectsToHighlightArea(
  rects: readonly RectLike[],
  containerRect: RectLike,
): HighlightArea | null {
  if (rects.length === 0) return null;
  if (containerRect.width <= 0 || containerRect.height <= 0) return null;

  const unionLeft = Math.min(...rects.map((r) => r.left));
  const unionTop = Math.min(...rects.map((r) => r.top));
  const unionRight = Math.max(...rects.map((r) => r.right));
  const unionBottom = Math.max(...rects.map((r) => r.bottom));

  // Container-relative, then clamp to the container's own bounds — a
  // citation's client rects can legitimately extend beyond the rendered
  // page (e.g. rounding at the container edge).
  const relLeft = clamp(unionLeft - containerRect.left, 0, containerRect.width);
  const relTop = clamp(unionTop - containerRect.top, 0, containerRect.height);
  const relRight = clamp(
    unionRight - containerRect.left,
    0,
    containerRect.width,
  );
  const relBottom = clamp(
    unionBottom - containerRect.top,
    0,
    containerRect.height,
  );

  if (relRight <= relLeft || relBottom <= relTop) return null;

  return {
    left: (relLeft / containerRect.width) * 100,
    top: (relTop / containerRect.height) * 100,
    width: ((relRight - relLeft) / containerRect.width) * 100,
    height: ((relBottom - relTop) / containerRect.height) * 100,
  };
}

/**
 * Locate the `cited_text` span inside `textLayerRoot`'s rendered text
 * (react-pdf's per-page TextLayer — one `<span>` per pdf.js text item,
 * concatenated in document order) and build a `Range` over it.
 *
 * `cited_start` (a document-wide character offset — not necessarily local
 * to a single page's TextLayer) is used only as a best-effort
 * disambiguation hint when `cited_text` occurs more than once on the page:
 * the occurrence whose local offset is numerically closest to
 * `cited_start` wins. True document-wide offset mapping across pages is a
 * wire-time (page-selection) concern, out of scope for this derivation.
 *
 * Returns `null` when `cited_text` is empty/whitespace-only or not found
 * anywhere in the text layer.
 */
export function locateCitationRange(
  textLayerRoot: Element,
  span: CitationSpan,
): Range | null {
  const citedText = span.cited_text;
  if (!citedText || citedText.trim().length === 0) return null;

  const ownerDocument = textLayerRoot.ownerDocument;
  if (!ownerDocument) return null;

  const nodes = collectTextNodes(textLayerRoot);
  if (nodes.length === 0) return null;

  const fullText = nodes.map((n) => n.text).join('');
  const occurrences = findAllOccurrences(fullText, citedText);
  if (occurrences.length === 0) return null;

  const matchStart =
    span.cited_start != null
      ? occurrences.reduce((best, cur) =>
          Math.abs(cur - span.cited_start!) < Math.abs(best - span.cited_start!)
            ? cur
            : best,
        )
      : occurrences[0];
  const matchEnd = matchStart + citedText.length;

  const startLoc = locateNodeOffset(nodes, matchStart);
  const endLoc = locateNodeOffset(nodes, matchEnd);
  if (!startLoc || !endLoc) return null;

  const range = ownerDocument.createRange();
  range.setStart(startLoc.node, startLoc.offset);
  range.setEnd(endLoc.node, endLoc.offset);
  return range;
}

export interface DeriveTextLayerHighlightOptions {
  /**
   * Override for reading a `Range`'s client rects. Defaults to the real
   * `range.getClientRects()` DOM call. Injectable because jsdom (the unit
   * test environment) implements no layout engine at all — it does not
   * even expose a stub `getClientRects` to patch — so tests supply this
   * directly rather than mocking a non-existent DOM method.
   */
  getRangeClientRects?: (range: Range) => readonly RectLike[];
  /** Override for reading an element's bounding rect. Defaults to the real `element.getBoundingClientRect()` DOM call. */
  getContainerRect?: (element: Element) => RectLike;
}

/**
 * B1 orchestration: locate the citation span in the rendered TextLayer,
 * read its client rects, and normalise them to a page-% `HighlightArea`.
 * Returns the shared unmappable signal (§D3) at any stage that cannot
 * resolve — never a guessed box.
 */
export function deriveTextLayerHighlight(
  textLayerRoot: Element,
  span: CitationSpan,
  options: DeriveTextLayerHighlightOptions = {},
): CitationHighlightResult {
  const range = locateCitationRange(textLayerRoot, span);
  if (!range) return { status: 'unmappable' };

  const getRangeClientRects =
    options.getRangeClientRects ??
    ((r: Range) => Array.from(r.getClientRects()));
  const getContainerRect =
    options.getContainerRect ?? ((el: Element) => el.getBoundingClientRect());

  const clientRects = getRangeClientRects(range);
  const containerRect = getContainerRect(textLayerRoot);
  const area = normaliseRectsToHighlightArea(clientRects, containerRect);
  if (!area) return { status: 'unmappable' };

  return { status: 'mapped', method: 'text-layer', area };
}

// ──────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface TextNodeSpan {
  node: Text;
  text: string;
  start: number;
  end: number;
}

/** Walk `root`'s descendant Text nodes in document order, recording cumulative offsets. */
function collectTextNodes(root: Element): TextNodeSpan[] {
  const ownerDocument = root.ownerDocument;
  if (!ownerDocument) return [];

  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextNodeSpan[] = [];
  let offset = 0;
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent ?? '';
    if (text.length > 0) {
      nodes.push({
        node: current as Text,
        text,
        start: offset,
        end: offset + text.length,
      });
      offset += text.length;
    }
    current = walker.nextNode();
  }
  return nodes;
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  const occurrences: number[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = haystack.indexOf(needle, idx + 1);
  }
  return occurrences;
}

function locateNodeOffset(
  nodes: readonly TextNodeSpan[],
  globalOffset: number,
): { node: Text; offset: number } | null {
  for (const n of nodes) {
    if (globalOffset >= n.start && globalOffset <= n.end) {
      return { node: n.node, offset: globalOffset - n.start };
    }
  }
  return null;
}
