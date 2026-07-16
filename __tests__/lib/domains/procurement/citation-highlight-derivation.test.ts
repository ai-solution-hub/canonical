/**
 * ID-147 {147.12} — B1 text-layer citation coordinate derivation (TECH §4,
 * PRODUCT §D1-D3).
 *
 * `citations` has no geometry column (text-span anchored only:
 * `cited_text`/`cited_start`/`cited_end` — see
 * supabase/migrations/20260617130000_squash_baseline.sql `citations`
 * table). B1 is the primary, exact path: resolve the citation span against
 * `react-pdf`'s rendered TextLayer DOM (`getClientRects`), normalise to
 * page-% -> `HighlightArea`. Deterministic, no API call.
 *
 * Split into three independently-testable layers so the DOM-measurement
 * seam (real layout, unavailable in jsdom) is isolated to one orchestration
 * test that stubs `getClientRects`/`getBoundingClientRect`:
 *  - `normaliseRectsToHighlightArea` — pure geometry, no DOM.
 *  - `locateCitationRange` — real DOM text-node walking + Range
 *    construction (jsdom supports this fully; no layout required).
 *  - `deriveTextLayerHighlight` — orchestration; stubs the two
 *    layout-dependent DOM calls.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseRectsToHighlightArea,
  locateCitationRange,
  deriveTextLayerHighlight,
  type RectLike,
} from '@/lib/domains/procurement/citation-highlight-derivation';

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): RectLike {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe('normaliseRectsToHighlightArea', () => {
  it('normalises a single rect matching the container exactly to a full-page-% box', () => {
    const container = rect(0, 0, 800, 1000);
    const area = normaliseRectsToHighlightArea(
      [rect(0, 0, 800, 1000)],
      container,
    );

    expect(area).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('normalises a rect offset within the container to the correct page-% position', () => {
    const container = rect(0, 0, 800, 1000);
    // A 200x100 rect at (100, 50): left% = 12.5, top% = 5, width% = 25, height% = 10.
    const area = normaliseRectsToHighlightArea(
      [rect(100, 50, 200, 100)],
      container,
    );

    expect(area).toEqual({ left: 12.5, top: 5, width: 25, height: 10 });
  });

  it('unions multiple line-rects (a span wrapping onto a second line) into one bounding box', () => {
    const container = rect(0, 0, 800, 1000);
    // Line 1: (100, 50) 400x20; Line 2: (0, 70) 250x20. Union bbox:
    // left=0, top=50, right=500, bottom=90 -> width=500, height=40.
    const area = normaliseRectsToHighlightArea(
      [rect(100, 50, 400, 20), rect(0, 70, 250, 20)],
      container,
    );

    expect(area).toEqual({ left: 0, top: 5, width: 62.5, height: 4 });
  });

  it('clamps a rect that extends outside the container bounds to [0, 100]', () => {
    const container = rect(0, 0, 800, 1000);
    // Extends 100px left of and 100px below the container.
    const area = normaliseRectsToHighlightArea(
      [rect(-100, 900, 300, 200)],
      container,
    );

    expect(area).not.toBeNull();
    expect(area!.left).toBe(0);
    expect(area!.top + area!.height).toBeLessThanOrEqual(100);
    expect(area!.left + area!.width).toBeLessThanOrEqual(100);
  });

  it('returns null for an empty rect list', () => {
    expect(normaliseRectsToHighlightArea([], rect(0, 0, 800, 1000))).toBeNull();
  });

  it('returns null when the container has zero area (unmeasured layout)', () => {
    expect(
      normaliseRectsToHighlightArea([rect(0, 0, 10, 10)], rect(0, 0, 0, 0)),
    ).toBeNull();
  });
});

describe('locateCitationRange', () => {
  function buildTextLayer(spanTexts: string[]): HTMLDivElement {
    const root = document.createElement('div');
    for (const text of spanTexts) {
      const span = document.createElement('span');
      span.textContent = text;
      root.appendChild(span);
    }
    return root;
  }

  it('locates a citation span contained within a single text-layer span', () => {
    const root = buildTextLayer(['The quick brown fox jumps.']);

    const range = locateCitationRange(root, {
      cited_text: 'brown fox',
      cited_start: null,
      cited_end: null,
    });

    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('brown fox');
  });

  it('locates a citation span that crosses a text-layer span boundary', () => {
    // react-pdf renders one <span> per pdf.js text item; a citation phrase
    // routinely straddles two adjacent items.
    const root = buildTextLayer(['The quick brown ', 'fox jumps over.']);

    const range = locateCitationRange(root, {
      cited_text: 'brown fox jumps',
      cited_start: null,
      cited_end: null,
    });

    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('brown fox jumps');
  });

  it('uses cited_start as a disambiguation hint when the text occurs more than once', () => {
    const root = buildTextLayer(['fox fox fox fox fox']);
    // Occurrences of "fox" start at local offsets 0, 4, 8, 12, 16.
    // Hint of 9 should select the occurrence starting at 8 (closest).
    const range = locateCitationRange(root, {
      cited_text: 'fox',
      cited_start: 9,
      cited_end: 12,
    });

    expect(range).not.toBeNull();
    expect(range!.startOffset).toBe(8);
  });

  it('returns null when the cited text is not present in the text layer', () => {
    const root = buildTextLayer(['The quick brown fox jumps.']);

    const range = locateCitationRange(root, {
      cited_text: 'nonexistent phrase',
      cited_start: null,
      cited_end: null,
    });

    expect(range).toBeNull();
  });

  it('returns null for an empty or whitespace-only citation span (nothing to resolve)', () => {
    const root = buildTextLayer(['The quick brown fox jumps.']);

    expect(
      locateCitationRange(root, {
        cited_text: '',
        cited_start: null,
        cited_end: null,
      }),
    ).toBeNull();
    expect(
      locateCitationRange(root, {
        cited_text: '   ',
        cited_start: null,
        cited_end: null,
      }),
    ).toBeNull();
  });
});

describe('deriveTextLayerHighlight (orchestration)', () => {
  function buildTextLayer(text: string): HTMLDivElement {
    const root = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = text;
    root.appendChild(span);
    return root;
  }

  it('resolves a mappable span to a mapped HighlightArea via the text-layer method', () => {
    const root = buildTextLayer('The quick brown fox jumps.');

    // jsdom implements no layout engine at all (getClientRects doesn't even
    // exist to mock) — supply the layout-dependent DOM reads exactly as a
    // real browser would report them for this page render, via the
    // module's injection seam.
    const result = deriveTextLayerHighlight(
      root,
      { cited_text: 'brown fox', cited_start: null, cited_end: null },
      {
        getRangeClientRects: () => [rect(100, 50, 200, 20)],
        getContainerRect: () => rect(0, 0, 800, 1000),
      },
    );

    expect(result).toEqual({
      status: 'mapped',
      method: 'text-layer',
      area: { left: 12.5, top: 5, width: 25, height: 2 },
    });
  });

  it('degrades to unmappable when the citation span cannot be located (§D3)', () => {
    const root = buildTextLayer('The quick brown fox jumps.');

    const result = deriveTextLayerHighlight(root, {
      cited_text: 'not in this page',
      cited_start: null,
      cited_end: null,
    });

    expect(result).toEqual({ status: 'unmappable' });
  });

  it('degrades to unmappable when the located range yields no client rects', () => {
    const root = buildTextLayer('The quick brown fox jumps.');

    const result = deriveTextLayerHighlight(
      root,
      { cited_text: 'brown fox', cited_start: null, cited_end: null },
      { getRangeClientRects: () => [] },
    );

    expect(result).toEqual({ status: 'unmappable' });
  });
});
