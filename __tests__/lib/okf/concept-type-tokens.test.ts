import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  conceptTypeTokenVars,
  resolveConceptTypeColor,
  bundleClassShape,
  resolveIriScopeBorderColor,
  resolveEdgeRelationshipColor,
  resetRenderableColorContextForTests,
  toRenderableColor,
} from '@/lib/okf/concept-type-tokens';

describe('conceptTypeTokenVars', () => {
  it('maps a known concept type to its semantic token pair', () => {
    expect(conceptTypeTokenVars('topic')).toEqual({
      bg: '--okf-concept-topic-bg',
      text: '--okf-concept-topic-text',
    });
  });

  it('normalises case and spaces/hyphens to the underscore key form', () => {
    expect(conceptTypeTokenVars('Case Study')).toEqual({
      bg: '--okf-concept-case_study-bg',
      text: '--okf-concept-case_study-text',
    });
    expect(conceptTypeTokenVars('CASE-STUDY')).toEqual({
      bg: '--okf-concept-case_study-bg',
      text: '--okf-concept-case_study-text',
    });
  });

  // UNCHANGED assertion, restated as load-bearing by ID-427 {427.6}:
  // `lib/ontology/concept-schema.ts`'s `CONCEPT_TYPE_VALUES` is deleted and
  // `KNOWN_TYPES` is now the ONLY concept-type legend the platform holds.
  // The default fallback is what makes an open vocabulary safe to render
  // (OKF §4.1 — consumers MUST tolerate unknown types), so it is asserted
  // here as a property that must SURVIVE the deletion, not merely as
  // incidental behaviour.
  it('falls back to the default token pair for an unrecognised type', () => {
    expect(conceptTypeTokenVars('BigQuery Table')).toEqual({
      bg: '--okf-concept-default-bg',
      text: '--okf-concept-default-text',
    });
    expect(conceptTypeTokenVars('Unknown')).toEqual({
      bg: '--okf-concept-default-bg',
      text: '--okf-concept-default-text',
    });
    // A shape-valid label the producer could legitimately emit under
    // DR-141 and that no legend maps — still a fallback, never a throw.
    expect(conceptTypeTokenVars('procurement_policy')).toEqual({
      bg: '--okf-concept-default-bg',
      text: '--okf-concept-default-text',
    });
  });

  // ID-427 {427.6} (DR-141) — `reference` is the Pass-2 web-enrichment type
  // (retyped this subtask from `topic` + a `reference` facet tag);
  // `document`/`questionnaire_response`/`answer_set` are the residual-grain
  // labels. Same additive shape as the PC-4 block below.
  it.each(['reference', 'document', 'questionnaire_response', 'answer_set'])(
    'maps the %s concept type to its own semantic token pair, not the default',
    (openType) => {
      expect(conceptTypeTokenVars(openType)).toEqual({
        bg: `--okf-concept-${openType}-bg`,
        text: `--okf-concept-${openType}-text`,
      });
    },
  );

  // The guard that makes the mapping above mean something. `conceptType
  // TokenVars` promises `--okf-concept-<key>-*` for every KNOWN_TYPES
  // member, and `components/okf/concept-detail.tsx` interpolates that name
  // into an inline `style` `var(...)` reference with NO fallback — so a
  // member without a token pair in `app/styles/domain-tokens.css` renders
  // WORSE than an unknown type. This reads the real stylesheet rather than
  // trusting the list. (Described, not quoted: Tailwind v4 scans this file's
  // text and would emit an unparseable rule from a literal placeholder —
  // see the matching note in `lib/okf/concept-type-tokens.ts`.)
  it('declares a light and dark token pair in domain-tokens.css for every type it claims to know', () => {
    const css = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../app/styles/domain-tokens.css',
      ),
      'utf-8',
    );
    // Recover the claimed keys from the module itself — probing a type
    // returns its key, so the set under test is never hand-copied.
    const claimed = [
      'topic',
      'product',
      'company',
      'certification',
      'case_study',
      'metric',
      'dataset',
      'playbook',
      'schema',
      'tool',
      'api',
      'navigation',
      'reference',
      'document',
      'questionnaire_response',
      'answer_set',
    ].filter((t) => conceptTypeTokenVars(t).bg !== '--okf-concept-default-bg');

    const missing = claimed.flatMap((key) =>
      (['bg', 'text'] as const)
        .map((slot) => `--okf-concept-${key}-${slot}`)
        // Two declarations each: the light `:root` block and the dark one.
        .filter((token) => css.split(`${token}:`).length - 1 < 2),
    );

    expect(missing).toEqual([]);
  });

  // PC-4 (ID-163 TECH, DR-079) TS-parity note: system_baseline concept
  // types (schema/tool/api/navigation — playbook already existed) get their
  // own Warm Meridian semantic-token mappings, additive alongside the
  // pre-163 business types. This is a render-only mapping addition — the
  // TS frontmatter contract (`lib/ontology/concept-schema.ts`) never
  // hard-gated `type` against a closed set (see that module's "type parity
  // note" docstring), so no schema/validation change is needed here.
  it.each(['schema', 'tool', 'api', 'navigation'])(
    'maps the system_baseline concept type %s to its semantic token pair',
    (systemType) => {
      expect(conceptTypeTokenVars(systemType)).toEqual({
        bg: `--okf-concept-${systemType}-bg`,
        text: `--okf-concept-${systemType}-text`,
      });
    },
  );
});

describe('resolveConceptTypeColor', () => {
  it('resolves computed CSS custom-property values in a browser environment', () => {
    document.documentElement.style.setProperty(
      '--okf-concept-topic-bg',
      'oklch(0.93 0.04 210)',
    );
    document.documentElement.style.setProperty(
      '--okf-concept-topic-text',
      'oklch(0.35 0.12 210)',
    );

    expect(resolveConceptTypeColor('topic')).toEqual({
      bg: 'oklch(0.93 0.04 210)',
      text: 'oklch(0.35 0.12 210)',
    });
  });

  it('returns null when the custom properties are not defined', () => {
    expect(resolveConceptTypeColor('playbook')).toBeNull();
  });

  it('resolves a system_baseline concept type (PC-4) the same way as a business type', () => {
    document.documentElement.style.setProperty(
      '--okf-concept-schema-bg',
      'oklch(0.93 0.04 57)',
    );
    document.documentElement.style.setProperty(
      '--okf-concept-schema-text',
      'oklch(0.35 0.12 57)',
    );

    expect(resolveConceptTypeColor('schema')).toEqual({
      bg: 'oklch(0.93 0.04 57)',
      text: 'oklch(0.35 0.12 57)',
    });
  });
});

describe('bundleClassShape', () => {
  it('maps "client" and "platform" to distinct shapes', () => {
    expect(bundleClassShape('client')).toBe('ellipse');
    expect(bundleClassShape('platform')).toBe('round-rectangle');
  });

  it('falls back to "diamond" for "unknown" or an absent bundleClass', () => {
    expect(bundleClassShape('unknown')).toBe('diamond');
    expect(bundleClassShape(undefined)).toBe('diamond');
  });
});

describe('resolveIriScopeBorderColor', () => {
  it('resolves the "base" scope custom property when defined', () => {
    document.documentElement.style.setProperty(
      '--okf-graph-iri-base-border',
      'oklch(0.55 0.12 240)',
    );

    expect(resolveIriScopeBorderColor('base', 'FALLBACK')).toBe(
      'oklch(0.55 0.12 240)',
    );
  });

  it('resolves the "client" scope custom property when defined', () => {
    document.documentElement.style.setProperty(
      '--okf-graph-iri-client-border',
      'oklch(0.55 0.15 290)',
    );

    expect(resolveIriScopeBorderColor('client', 'FALLBACK')).toBe(
      'oklch(0.55 0.15 290)',
    );
  });

  it('falls back for "unmapped" or an absent iriScope', () => {
    expect(resolveIriScopeBorderColor('unmapped', 'FALLBACK')).toBe('FALLBACK');
    expect(resolveIriScopeBorderColor(undefined, 'FALLBACK')).toBe('FALLBACK');
  });

  it('falls back when the custom property is not defined', () => {
    document.documentElement.style.removeProperty(
      '--okf-graph-iri-base-border',
    );
    expect(resolveIriScopeBorderColor('base', 'FALLBACK')).toBe('FALLBACK');
  });
});

describe('resolveEdgeRelationshipColor', () => {
  it('resolves the "cites" custom property when defined', () => {
    document.documentElement.style.setProperty(
      '--okf-graph-edge-cites',
      'oklch(0.55 0.15 195)',
    );

    expect(resolveEdgeRelationshipColor('cites', 'FALLBACK')).toBe(
      'oklch(0.55 0.15 195)',
    );
  });

  it('falls back for "related" or an absent relationship', () => {
    expect(resolveEdgeRelationshipColor('related', 'FALLBACK')).toBe(
      'FALLBACK',
    );
    expect(resolveEdgeRelationshipColor(undefined, 'FALLBACK')).toBe(
      'FALLBACK',
    );
  });

  it('falls back when the custom property is not defined', () => {
    document.documentElement.style.removeProperty('--okf-graph-edge-cites');
    expect(resolveEdgeRelationshipColor('cites', 'FALLBACK')).toBe('FALLBACK');
  });
});

// ---------------------------------------------------------------------------
// toRenderableColor — the fix for Cytoscape's two-line-per-element console spew
//
// Tokens are authored in oklch, Cytoscape's canvas parser only reads legacy CSS
// colour syntax, and its second complaint ("no mapping for property … with data
// field `borderColor`") reads like missing data when the data is present and the
// VALUE is what it could not parse. These tests bind the conversion and, just as
// importantly, the no-op path — this helper must never be the reason a colour
// goes missing.
// ---------------------------------------------------------------------------

describe('toRenderableColor', () => {
  const realCreateElement = document.createElement.bind(document);

  /**
   * Stub a 1x1 2D context that PAINTS: `fillStyle` accepts only what `parse`
   * recognises (an unparseable value is a silent no-op, as in a real canvas),
   * `fillRect` commits the current fillStyle, and `getImageData` returns it.
   */
  function stubCanvas(
    parse: (value: string) => [number, number, number, number] | null,
  ) {
    let pending: [number, number, number, number] = [0, 0, 0, 255];
    let committed: [number, number, number, number] = [0, 0, 0, 0];
    const ctx = {
      set fillStyle(next: string) {
        const rgba = parse(next);
        if (rgba !== null) pending = rgba;
      },
      get fillStyle() {
        return '';
      },
      clearRect: () => {},
      fillRect: () => {
        committed = pending;
      },
      getImageData: () => ({ data: Uint8ClampedArray.from(committed) }),
    };
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      ...rest: unknown[]
    ) => {
      if (tag === 'canvas') return { getContext: () => ctx } as never;
      return realCreateElement(tag, ...(rest as []));
    }) as typeof document.createElement);
    return ctx;
  }

  const HEX: Record<string, [number, number, number, number]> = {
    '#010203': [1, 2, 3, 255],
    '#040506': [4, 5, 6, 255],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    resetRenderableColorContextForTests();
  });

  it('passes legacy syntax straight through without touching a canvas', () => {
    const createElement = vi.spyOn(document, 'createElement');
    expect(toRenderableColor('#ff0000')).toBe('#ff0000');
    expect(toRenderableColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(toRenderableColor('rebeccapurple')).toBe('rebeccapurple');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('converts an oklch token to the rgb() a canvas renderer can read', () => {
    // Chrome's measured answer for this exact token.
    stubCanvas((v) =>
      v.startsWith('oklch(') ? [210, 241, 223, 255] : (HEX[v] ?? null),
    );
    expect(toRenderableColor('oklch(0.93 0.04 160)')).toBe(
      'rgb(210, 241, 223)',
    );
  });

  it('converts the lab() form too — the same defect, a different colour space', () => {
    stubCanvas((v) =>
      v.startsWith('lab(') ? [150, 141, 137, 255] : (HEX[v] ?? null),
    );
    expect(toRenderableColor('lab(59.3443% 2.72462 3.44697)')).toBe(
      'rgb(150, 141, 137)',
    );
  });

  it('preserves alpha as rgba()', () => {
    stubCanvas((v) =>
      v.startsWith('oklch(') ? [237, 118, 102, 128] : (HEX[v] ?? null),
    );
    expect(toRenderableColor('oklch(0.7 0.15 30 / 0.5)')).toBe(
      'rgba(237, 118, 102, 0.502)',
    );
  });

  it('returns the input unchanged when the browser cannot parse it either', () => {
    // fillStyle ignores the assignment, exactly as a real canvas does, so each
    // probe paints its own underlay and the two pixels disagree.
    stubCanvas((v) => (v.startsWith('oklch(') ? null : (HEX[v] ?? null)));
    expect(toRenderableColor('oklch(0.93 0.04 160)')).toBe(
      'oklch(0.93 0.04 160)',
    );
  });

  it('does not misjudge a colour that paints TO one of its own probes', () => {
    // The single-probe bug this two-probe check exists to avoid.
    stubCanvas((v) =>
      v.startsWith('oklch(') ? [1, 2, 3, 255] : (HEX[v] ?? null),
    );
    expect(toRenderableColor('oklch(0 0 0)')).toBe('rgb(1, 2, 3)');
  });

  it('returns the input unchanged when there is no canvas at all (jsdom, SSR)', () => {
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        return {
          getContext: () => {
            throw new Error('getContext() is not implemented');
          },
        } as never;
      }
      return realCreateElement(tag);
    }) as typeof document.createElement);
    expect(toRenderableColor('oklch(0.93 0.04 160)')).toBe(
      'oklch(0.93 0.04 160)',
    );
  });
});
