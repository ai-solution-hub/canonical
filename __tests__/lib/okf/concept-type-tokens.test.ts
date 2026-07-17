import { describe, it, expect } from 'vitest';
import {
  conceptTypeTokenVars,
  resolveConceptTypeColor,
  bundleClassShape,
  resolveIriScopeBorderColor,
  resolveEdgeRelationshipColor,
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

  it('falls back to the default token pair for an unrecognised type', () => {
    expect(conceptTypeTokenVars('BigQuery Table')).toEqual({
      bg: '--okf-concept-default-bg',
      text: '--okf-concept-default-text',
    });
    expect(conceptTypeTokenVars('Unknown')).toEqual({
      bg: '--okf-concept-default-bg',
      text: '--okf-concept-default-text',
    });
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
