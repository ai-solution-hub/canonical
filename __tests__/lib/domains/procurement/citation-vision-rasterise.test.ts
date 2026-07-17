/**
 * ID-147 {147.12} — B2 Claude-vision citation coordinate derivation
 * (TECH §4, PRODUCT §D2, DR-064).
 *
 * Fallback path for scanned/flat/no-text-layer PDFs where B1 (text-layer
 * `getClientRects`) cannot resolve a citation span. Per
 * platform.claude.com/docs/en/build-with-claude/vision-coordinates:
 * "For PDF support, pages are rasterized to images server-side at
 * dimensions you don't control, so the returned coordinates can't be
 * reliably mapped back onto the page. To work with coordinates on PDF
 * content, rasterize the pages to images yourself and use the pre-resize
 * approach." — hence `rasterisePageForVision` self-rasterises and
 * pre-resizes to Claude's own documented resize algorithm
 * (`computeClaudeVisionResizeDimensions`, ported verbatim from that page's
 * TypeScript reference implementation) BEFORE any request is built, so
 * Claude's returned pixel bbox needs no further conversion — it divides
 * directly by the dimensions we chose.
 *
 * No live Anthropic call is made from this module (kept out of the
 * lib/ai/grounding.ts B-INV-35 touchpoint registry deliberately — that
 * registration belongs with the live wiring at {145.47}, outside this
 * Subtask's file-ownership boundary). This module delivers the request
 * shape builder, the response parser, and the pixel-to-percentage math —
 * everything a caller needs to make and interpret that call.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeClaudeVisionResizeDimensions,
  derivePixelBoundingBoxToHighlightArea,
  rasterisePageForVision,
  buildVisionBoundingBoxRequest,
  parseVisionBoundingBoxResponse,
  deriveVisionHighlight,
  type CanvasFactory,
  type PdfPageProxyLike,
  type RasterCanvasLike,
} from '@/lib/domains/procurement/citation-vision-rasterise';

describe('computeClaudeVisionResizeDimensions', () => {
  it('matches the documented A4-scan example exactly (standard tier)', () => {
    // platform.claude.com/docs/en/build-with-claude/vision-coordinates
    // worked example: an A4 page scanned at 130 DPI (1075x1520) resizes to
    // 924x1307 on the standard resolution tier.
    expect(
      computeClaudeVisionResizeDimensions({ width: 1075, height: 1520 }),
    ).toEqual({
      width: 924,
      height: 1307,
    });
  });

  it('is symmetric under a width/height swap (portrait <-> landscape)', () => {
    expect(
      computeClaudeVisionResizeDimensions({ width: 1520, height: 1075 }),
    ).toEqual({
      width: 1307,
      height: 924,
    });
  });

  it('returns the image unchanged when it already fits the tier limits', () => {
    expect(
      computeClaudeVisionResizeDimensions({ width: 800, height: 600 }),
    ).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('resizes less aggressively on the high-resolution tier than the standard tier', () => {
    const standard = computeClaudeVisionResizeDimensions(
      { width: 3000, height: 2000 },
      'standard',
    );
    const high = computeClaudeVisionResizeDimensions(
      { width: 3000, height: 2000 },
      'high',
    );

    expect(high.width).toBeGreaterThan(standard.width);
    expect(high.height).toBeGreaterThan(standard.height);
  });

  it('leaves the documented A4 example unchanged on the high-resolution tier (it already fits)', () => {
    expect(
      computeClaudeVisionResizeDimensions(
        { width: 1075, height: 1520 },
        'high',
      ),
    ).toEqual({ width: 1075, height: 1520 });
  });
});

describe('derivePixelBoundingBoxToHighlightArea', () => {
  it('divides an absolute pixel bbox by the resized image dims (B2 core math)', () => {
    // The doc's own rescale example: (462, 653.5) is exactly the midpoint of
    // a 924x1307 resized image.
    const area = derivePixelBoundingBoxToHighlightArea(
      { x1: 0, y1: 0, x2: 462, y2: 653.5 },
      { width: 924, height: 1307 },
    );

    expect(area).toEqual({ left: 0, top: 0, width: 50, height: 50 });
  });

  it('clamps a bbox that extends outside the resized image before dividing', () => {
    const area = derivePixelBoundingBoxToHighlightArea(
      { x1: -50, y1: -50, x2: 2000, y2: 3000 },
      { width: 924, height: 1307 },
    );

    expect(area).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('returns null (unmappable) for an inverted/degenerate bbox', () => {
    expect(
      derivePixelBoundingBoxToHighlightArea(
        { x1: 500, y1: 500, x2: 100, y2: 100 },
        { width: 924, height: 1307 },
      ),
    ).toBeNull();
  });

  it('returns null (unmappable) for non-finite bbox values', () => {
    expect(
      derivePixelBoundingBoxToHighlightArea(
        { x1: 0, y1: 0, x2: Number.NaN, y2: 100 },
        { width: 924, height: 1307 },
      ),
    ).toBeNull();
  });

  it('returns null (unmappable) for degenerate resized dims', () => {
    expect(
      derivePixelBoundingBoxToHighlightArea(
        { x1: 0, y1: 0, x2: 100, y2: 100 },
        { width: 0, height: 1307 },
      ),
    ).toBeNull();
  });
});

describe('rasterisePageForVision', () => {
  function buildFakeCanvas(): RasterCanvasLike & {
    drawImage: ReturnType<typeof vi.fn>;
  } {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL: vi.fn(
        (type?: string) => `data:${type ?? 'image/png'};base64,FAKE`,
      ),
      drawImage,
    };
    return canvas;
  }

  it('self-rasterises the page at native resolution then pre-resizes to the Claude-vision target dims', async () => {
    // Native size matches the doc's worked example so the target dims
    // (924x1307) are an independently-verifiable oracle, not a re-derived
    // call into the function under test.
    const nativeViewport = { width: 1075, height: 1520 };
    const sourceCanvas = buildFakeCanvas();
    const targetCanvas = buildFakeCanvas();
    const canvases = [sourceCanvas, targetCanvas];

    const canvasFactory: CanvasFactory = {
      createCanvas: vi.fn(() => canvases.shift()!),
    };

    const renderPromise = Promise.resolve();
    const page: PdfPageProxyLike = {
      getViewport: vi.fn(() => nativeViewport),
      render: vi.fn(() => ({ promise: renderPromise })),
    };

    const result = await rasterisePageForVision(page, canvasFactory);

    expect(page.getViewport).toHaveBeenCalledWith({ scale: 2 });
    expect(canvasFactory.createCanvas).toHaveBeenNthCalledWith(
      1,
      nativeViewport,
    );
    expect(page.render).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: nativeViewport }),
    );
    expect(canvasFactory.createCanvas).toHaveBeenNthCalledWith(2, {
      width: 924,
      height: 1307,
    });
    expect(targetCanvas.drawImage).toHaveBeenCalledWith(
      sourceCanvas,
      0,
      0,
      924,
      1307,
    );
    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,FAKE',
      mediaType: 'image/png',
      width: 924,
      height: 1307,
    });
  });

  it('honours an explicit nativeScale and mediaType override', async () => {
    const nativeViewport = { width: 800, height: 600 };
    const canvasFactory: CanvasFactory = {
      createCanvas: vi.fn(() => buildFakeCanvas()),
    };
    const page: PdfPageProxyLike = {
      getViewport: vi.fn(() => nativeViewport),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
    };

    const result = await rasterisePageForVision(page, canvasFactory, {
      nativeScale: 3,
      mediaType: 'image/jpeg',
    });

    expect(page.getViewport).toHaveBeenCalledWith({ scale: 3 });
    expect(result.mediaType).toBe('image/jpeg');
    expect(result.dataUrl).toBe('data:image/jpeg;base64,FAKE');
  });
});

describe('buildVisionBoundingBoxRequest', () => {
  it('builds an image content block from the self-rasterised image, never a native PDF upload', () => {
    const request = buildVisionBoundingBoxRequest(
      { mediaType: 'image/png', base64: 'FAKE_BASE64' },
      'total contract value',
    );

    expect(request.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'FAKE_BASE64' },
    });
  });

  it('asks explicitly for absolute pixel coordinates and includes the cited text', () => {
    const request = buildVisionBoundingBoxRequest(
      { mediaType: 'image/png', base64: 'FAKE_BASE64' },
      'total contract value',
    );
    const textBlock = request.content[1] as { type: string; text: string };

    expect(textBlock.type).toBe('text');
    expect(textBlock.text).toContain('total contract value');
    expect(textBlock.text.toLowerCase()).toContain('pixel');
    expect(textBlock.text.toLowerCase()).not.toContain('normalized');
  });

  it('forces the bounding-box tool with a closed input schema', () => {
    const request = buildVisionBoundingBoxRequest(
      { mediaType: 'image/png', base64: 'FAKE_BASE64' },
      'total contract value',
    );

    expect(request.tool_choice).toEqual({
      type: 'tool',
      name: request.tools[0].name,
    });
    expect(request.tools[0].input_schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });
});

describe('parseVisionBoundingBoxResponse', () => {
  const TOOL_NAME = buildVisionBoundingBoxRequest(
    { mediaType: 'image/png', base64: 'x' },
    'x',
  ).tools[0].name as string;

  it('parses a well-formed found:true tool_use block into a pixel bbox', () => {
    const bbox = parseVisionBoundingBoxResponse({
      content: [
        {
          type: 'tool_use',
          name: TOOL_NAME,
          input: { found: true, x1: 10, y1: 20, x2: 110, y2: 220 },
        },
      ],
    });

    expect(bbox).toEqual({ x1: 10, y1: 20, x2: 110, y2: 220 });
  });

  it('returns null when Claude reports the text was not found', () => {
    const bbox = parseVisionBoundingBoxResponse({
      content: [{ type: 'tool_use', name: TOOL_NAME, input: { found: false } }],
    });

    expect(bbox).toBeNull();
  });

  it('returns null when there is no tool_use block', () => {
    const bbox = parseVisionBoundingBoxResponse({
      content: [{ type: 'text', text: 'no tool call here' }],
    });

    expect(bbox).toBeNull();
  });

  it('returns null for a malformed tool_use input (missing/non-numeric fields)', () => {
    const bbox = parseVisionBoundingBoxResponse({
      content: [
        {
          type: 'tool_use',
          name: TOOL_NAME,
          input: { found: true, x1: 10, y1: 20, x2: 'oops', y2: 220 },
        },
      ],
    });

    expect(bbox).toBeNull();
  });
});

describe('deriveVisionHighlight (orchestration)', () => {
  const TOOL_NAME = buildVisionBoundingBoxRequest(
    { mediaType: 'image/png', base64: 'x' },
    'x',
  ).tools[0].name as string;

  it('resolves a well-formed vision response to a mapped HighlightArea', () => {
    const result = deriveVisionHighlight(
      {
        content: [
          {
            type: 'tool_use',
            name: TOOL_NAME,
            input: { found: true, x1: 0, y1: 0, x2: 462, y2: 653.5 },
          },
        ],
      },
      { width: 924, height: 1307 },
    );

    expect(result).toEqual({
      status: 'mapped',
      method: 'vision',
      area: { left: 0, top: 0, width: 50, height: 50 },
    });
  });

  it('degrades to unmappable when Claude cannot find the text (§D3)', () => {
    const result = deriveVisionHighlight(
      {
        content: [
          { type: 'tool_use', name: TOOL_NAME, input: { found: false } },
        ],
      },
      { width: 924, height: 1307 },
    );

    expect(result).toEqual({ status: 'unmappable' });
  });

  it('degrades to unmappable when the returned bbox is degenerate', () => {
    const result = deriveVisionHighlight(
      {
        content: [
          {
            type: 'tool_use',
            name: TOOL_NAME,
            input: { found: true, x1: 500, y1: 500, x2: 100, y2: 100 },
          },
        ],
      },
      { width: 924, height: 1307 },
    );

    expect(result).toEqual({ status: 'unmappable' });
  });
});
