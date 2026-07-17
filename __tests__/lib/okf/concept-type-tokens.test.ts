import { describe, it, expect } from 'vitest';
import {
  conceptTypeTokenVars,
  resolveConceptTypeColor,
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
