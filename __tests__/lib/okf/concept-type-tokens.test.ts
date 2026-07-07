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
});
