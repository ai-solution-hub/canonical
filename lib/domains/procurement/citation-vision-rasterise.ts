/**
 * ID-147 {147.12} — B2 Claude-vision citation coordinate derivation
 * (TECH §4, PRODUCT §D2 approximate path, DR-064).
 *
 * Fallback for scanned/flat/no-text-layer PDFs where B1
 * (`citation-highlight-derivation.ts`'s `deriveTextLayerHighlight`) cannot
 * resolve a citation span. Grounded against
 * platform.claude.com/docs/en/build-with-claude/vision-coordinates:
 *
 *  - Claude works best with, and should be asked explicitly for, ABSOLUTE
 *    PIXEL coordinates `[x1, y1, x2, y2]` (top-left origin) — never
 *    normalised 0-1 or 0-1000 coordinates.
 *  - For PDFs specifically: "pages are rasterized to images server-side at
 *    dimensions you don't control, so the returned coordinates can't be
 *    reliably mapped back onto the page. To work with coordinates on PDF
 *    content, rasterize the pages to images yourself and use the
 *    pre-resize approach." — hence `rasterisePageForVision` self-rasterises
 *    (client/worker-side, via an injected pdf.js page proxy + canvas
 *    factory) and pre-resizes to `computeClaudeVisionResizeDimensions`
 *    (Claude's own documented resize algorithm, ported verbatim from that
 *    page's TypeScript reference implementation) BEFORE any request is
 *    built. The pixel bbox Claude returns then needs no further
 *    conversion — it divides directly by the dimensions we chose.
 *
 * No live Anthropic call is made from this module. That live call belongs
 * with the wiring work at {145.47} (W7) — this Subtask's file-ownership
 * boundary is the two NEW derivation lib modules only, and registering a
 * new AI touchpoint means editing the cross-cutting `lib/ai/grounding.ts`
 * B-INV-35 registry (+ its conformance test), which sits outside that
 * boundary. This module delivers everything the wire-time call needs:
 * the self-rasterise/pre-resize step, the request shape, the response
 * parser, and the B2 pixel-to-percentage math.
 */

import type {
  HighlightArea,
  CitationHighlightResult,
} from './citation-highlight-derivation';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface PixelSize {
  width: number;
  height: number;
}

export interface PixelBoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Claude's two documented image resolution tiers (standard vs high-resolution models). */
export type ClaudeVisionResolutionTier = 'standard' | 'high';

/** Minimal structural shape of a pdf.js `PDFPageProxy` — only what self-rasterisation needs. */
export interface PdfPageProxyLike {
  getViewport(params: { scale: number }): PixelSize;
  render(params: { canvasContext: unknown; viewport: PixelSize }): {
    promise: Promise<void>;
  };
}

/** Minimal structural shape of a `<canvas>` (or `OffscreenCanvas`) element. */
export interface RasterCanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
  toDataURL(type?: string, quality?: number): string;
}

/**
 * Injected canvas construction — the DI seam that keeps this module
 * testable without a real browser Canvas API (unavailable in the jsdom
 * unit-test environment) and framework-agnostic (worker vs main-thread
 * `OffscreenCanvas` vs `<canvas>`).
 */
export interface CanvasFactory {
  createCanvas(size: PixelSize): RasterCanvasLike;
}

export interface RasterisePageForVisionOptions {
  /**
   * pdf.js render scale for the native-resolution source rasterisation,
   * BEFORE the Claude-vision pre-resize. Higher = sharper source for the
   * downscale step, more rendering work. @default 2
   */
  nativeScale?: number;
  /** Claude resolution tier to pre-resize against. @default 'standard' */
  tier?: ClaudeVisionResolutionTier;
  /** Output image format for the pre-resized image. @default 'image/png' */
  mediaType?: 'image/png' | 'image/jpeg';
}

export interface RasterisedPageForVision {
  dataUrl: string;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

export interface VisionImageSource {
  mediaType: 'image/png' | 'image/jpeg';
  base64: string;
}

interface VisionBoundingBoxContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  [key: string]: unknown;
}

/** The subset of an Anthropic `Message` this module reads. */
export interface VisionBoundingBoxMessageLike {
  content: ReadonlyArray<VisionBoundingBoxContentBlock>;
}

export interface VisionBoundingBoxRequest {
  content: VisionBoundingBoxContentBlock[];
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice: { type: 'tool'; name: string };
}

// ──────────────────────────────────────────
// Resize algorithm (Claude vision coordinate contract)
// ──────────────────────────────────────────

const TIER_LIMITS: Record<
  ClaudeVisionResolutionTier,
  { maxEdge: number; maxTokens: number }
> = {
  standard: { maxEdge: 1568, maxTokens: 1568 },
  high: { maxEdge: 2576, maxTokens: 4784 },
};

/** Visual tokens consumed by an image: one token per 28x28 pixel patch. */
function countImageTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/**
 * Round half to even (banker's rounding), matching the live API's
 * resolution of exact `.5` ties — `Math.round` (which rounds halves up)
 * computes a different size for some images.
 */
function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The size Claude resizes an image to before padding — ported verbatim
 * from the TypeScript reference implementation at
 * platform.claude.com/docs/en/build-with-claude/vision-coordinates
 * (DR-064). Pre-resizing the self-rasterised page to exactly these
 * dimensions means the pixel bbox Claude returns needs no conversion —
 * dividing by this function's output IS the "resized dims" the B2 math
 * (`derivePixelBoundingBoxToHighlightArea`) expects.
 */
export function computeClaudeVisionResizeDimensions(
  size: PixelSize,
  tier: ClaudeVisionResolutionTier = 'standard',
): PixelSize {
  const { maxEdge, maxTokens } = TIER_LIMITS[tier];
  const { width, height } = size;

  const fits = (w: number, h: number): boolean =>
    Math.ceil(w / 28) * 28 <= maxEdge &&
    Math.ceil(h / 28) * 28 <= maxEdge &&
    countImageTokens(w, h) <= maxTokens;

  if (fits(width, height)) return { width, height };

  if (height > width) {
    const rotated = computeClaudeVisionResizeDimensions(
      { width: height, height: width },
      tier,
    );
    return { width: rotated.height, height: rotated.width };
  }

  // Binary search along the long edge for the largest aspect-preserving
  // size that fits.
  const aspectRatio = width / height;
  let lo = 1; // lo always fits
  let hi = width; // hi never fits
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspectRatio), 1))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { width: lo, height: Math.max(roundTiesToEven(lo / aspectRatio), 1) };
}

// ──────────────────────────────────────────
// B2 core math
// ──────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * B2 core math (§D2 approximate path): divide Claude's absolute pixel bbox
 * (top-left origin, `[x1, y1, x2, y2]`) by the RESIZED image dims — the
 * exact dims the self-rasterised image was pre-resized to, never the
 * original page dims and never a server-side-rasterised size we don't
 * control — to get relative `[0, 1]` coordinates, then `x100` for the
 * page-% `HighlightArea` (same left/top/width/height shape as B1 — origin
 * matches, no y-flip).
 *
 * Clamps the bbox to the resized image bounds before dividing (per the
 * platform.claude.com guidance: "Clamp returned coordinates to the resized
 * dimensions before rescaling, so a point slightly outside the image can't
 * map outside your original"). Returns `null` (unmappable, §D3) for a
 * degenerate resized size, a non-finite bbox, or an ordering that clamps
 * to zero area — never a guessed box.
 */
export function derivePixelBoundingBoxToHighlightArea(
  bbox: PixelBoundingBox,
  resizedDims: PixelSize,
): HighlightArea | null {
  const { width, height } = resizedDims;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  if (![bbox.x1, bbox.y1, bbox.x2, bbox.y2].every(Number.isFinite)) return null;

  const x1 = clamp(bbox.x1, 0, width);
  const y1 = clamp(bbox.y1, 0, height);
  const x2 = clamp(bbox.x2, 0, width);
  const y2 = clamp(bbox.y2, 0, height);

  if (x2 <= x1 || y2 <= y1) return null;

  return {
    left: (x1 / width) * 100,
    top: (y1 / height) * 100,
    width: ((x2 - x1) / width) * 100,
    height: ((y2 - y1) / height) * 100,
  };
}

// ──────────────────────────────────────────
// Self-rasterise + pre-resize
// ──────────────────────────────────────────

/**
 * Self-rasterise a pdf.js page to a full-resolution canvas, then downscale
 * it into a second canvas sized to `computeClaudeVisionResizeDimensions` —
 * the DR-064-mandated self-rasterise + pre-resize step. Native PDF support
 * rasterises server-side at dimensions the caller does not control, which
 * would make any pixel bbox Claude returns unmappable; rendering the page
 * ourselves and downscaling to a size we chose keeps the mapping exact.
 *
 * DI'd against a minimal pdf.js page proxy and a canvas factory so this is
 * testable without a real browser Canvas API (jsdom, the unit-test
 * environment, implements no Canvas 2D context at all).
 */
export async function rasterisePageForVision(
  page: PdfPageProxyLike,
  canvasFactory: CanvasFactory,
  options: RasterisePageForVisionOptions = {},
): Promise<RasterisedPageForVision> {
  const nativeScale = options.nativeScale ?? 2;
  const tier = options.tier ?? 'standard';
  const mediaType = options.mediaType ?? 'image/png';

  const nativeViewport = page.getViewport({ scale: nativeScale });
  const sourceCanvas = canvasFactory.createCanvas(nativeViewport);
  const sourceContext = sourceCanvas.getContext('2d');
  await page.render({ canvasContext: sourceContext, viewport: nativeViewport })
    .promise;

  const targetDims = computeClaudeVisionResizeDimensions(nativeViewport, tier);
  const targetCanvas = canvasFactory.createCanvas(targetDims);
  const targetContext = targetCanvas.getContext('2d') as {
    drawImage: (
      source: unknown,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => void;
  };
  targetContext.drawImage(
    sourceCanvas,
    0,
    0,
    targetDims.width,
    targetDims.height,
  );

  return {
    dataUrl: targetCanvas.toDataURL(mediaType),
    mediaType,
    width: targetDims.width,
    height: targetDims.height,
  };
}

// ──────────────────────────────────────────
// Request / response shape
// ──────────────────────────────────────────

const BOUNDING_BOX_TOOL_NAME = 'report_citation_bounding_box';

/**
 * Build the forced-tool message content + schema for the B2 vision-fallback
 * request. `image` MUST be the self-rasterised, pre-resized output of
 * `rasterisePageForVision` — never a native-PDF-support upload, whose
 * server-side rasterisation dims are not ours to control. Explicitly asks
 * for absolute pixel coordinates (never normalised — Claude "does not work
 * well when you ask for normalized coordinates", per the platform docs).
 */
export function buildVisionBoundingBoxRequest(
  image: VisionImageSource,
  citedText: string,
): VisionBoundingBoxRequest {
  return {
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType,
          data: image.base64,
        },
      },
      {
        type: 'text',
        text:
          `Find this exact text on the page image and return its bounding box: "${citedText}". ` +
          'Return the bounding box as absolute pixel coordinates [x1, y1, x2, y2] ' +
          '(top-left and bottom-right corners), where (0, 0) is the top-left corner of ' +
          'the image. Do NOT scale, normalise, or express the coordinates as a ' +
          'fraction — use raw pixel positions in the image as given. If the text ' +
          'cannot be found on the page, call the tool with found: false and omit the box.',
      },
    ],
    tools: [
      {
        name: BOUNDING_BOX_TOOL_NAME,
        description:
          'Report the pixel bounding box of the located citation text, or that it could not be found on the page.',
        input_schema: {
          type: 'object',
          properties: {
            found: { type: 'boolean' },
            x1: { type: 'number' },
            y1: { type: 'number' },
            x2: { type: 'number' },
            y2: { type: 'number' },
          },
          required: ['found'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: 'tool', name: BOUNDING_BOX_TOOL_NAME },
  };
}

/**
 * Parse the forced-tool response from a `buildVisionBoundingBoxRequest`
 * call into a pixel bbox. Returns `null` (unmappable, §D3) for a missing
 * tool_use block, `found: false`, or a malformed/non-finite box — never a
 * guessed region.
 */
export function parseVisionBoundingBoxResponse(
  response: VisionBoundingBoxMessageLike,
): PixelBoundingBox | null {
  const block = response.content.find(
    (b) => b.type === 'tool_use' && b.name === BOUNDING_BOX_TOOL_NAME,
  );
  if (!block || typeof block.input !== 'object' || block.input === null)
    return null;

  const input = block.input as Record<string, unknown>;
  if (input.found !== true) return null;

  const { x1, y1, x2, y2 } = input;
  if (
    typeof x1 !== 'number' ||
    typeof y1 !== 'number' ||
    typeof x2 !== 'number' ||
    typeof y2 !== 'number' ||
    ![x1, y1, x2, y2].every(Number.isFinite)
  ) {
    return null;
  }

  return { x1, y1, x2, y2 };
}

/**
 * B2 orchestration: parse the vision response and divide by the resized
 * image dims it was requested against, producing the same
 * `CitationHighlightResult` degrade contract as B1's
 * `deriveTextLayerHighlight`. Pure — takes an already-received response
 * (no network call here; see the module doc for why).
 */
export function deriveVisionHighlight(
  response: VisionBoundingBoxMessageLike,
  resizedDims: PixelSize,
): CitationHighlightResult {
  const bbox = parseVisionBoundingBoxResponse(response);
  if (!bbox) return { status: 'unmappable' };

  const area = derivePixelBoundingBoxToHighlightArea(bbox, resizedDims);
  if (!area) return { status: 'unmappable' };

  return { status: 'mapped', method: 'vision', area };
}
