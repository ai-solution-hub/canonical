import { describe, it, expect } from 'vitest';
import {
  normaliseText,
  similarity,
} from '@/lib/domains/procurement/form-templating/template-auto-map';

// ---------------------------------------------------------------------------
// normaliseText
// ---------------------------------------------------------------------------

describe('normaliseText', () => {
  it('lowercases text', () => {
    expect(normaliseText('Hello World')).toBe('hello world');
  });

  it('removes punctuation', () => {
    expect(normaliseText('What is your approach?')).toBe(
      'what is your approach',
    );
  });

  it('normalises whitespace', () => {
    expect(normaliseText('  multiple   spaces  ')).toBe('multiple spaces');
  });

  it('removes special characters', () => {
    expect(normaliseText('Q3.1: Information Security (ISO 27001)')).toBe(
      'q31 information security iso 27001',
    );
  });

  it('handles empty string', () => {
    expect(normaliseText('')).toBe('');
  });

  it('handles string with only punctuation', () => {
    expect(normaliseText('!@#$%')).toBe('');
  });

  it('preserves numbers', () => {
    expect(normaliseText('Section 3.2 - Question 5')).toBe(
      'section 32 question 5',
    );
  });
});

// ---------------------------------------------------------------------------
// similarity
// ---------------------------------------------------------------------------

describe('similarity', () => {
  it('returns 1.0 for identical text', () => {
    expect(similarity('information security', 'information security')).toBe(
      1.0,
    );
  });

  it('returns 1.0 for identical text with different casing', () => {
    expect(similarity('Information Security', 'information security')).toBe(
      1.0,
    );
  });

  it('returns 0.0 for completely different text', () => {
    expect(similarity('apple banana cherry', 'dog elephant fox')).toBe(0.0);
  });

  it('returns >0.8 for minor variations', () => {
    const score = similarity(
      'Describe your approach to information security',
      'Please describe your approach to information security management',
    );
    expect(score).toBeGreaterThan(0.7);
  });

  it('handles empty strings', () => {
    expect(similarity('', 'something')).toBe(0);
    expect(similarity('something', '')).toBe(0);
    expect(similarity('', '')).toBe(0);
  });

  it('matches "information security" with "info security approach"', () => {
    const score = similarity(
      'information security',
      'information security approach',
    );
    expect(score).toBeGreaterThan(0.6);
  });

  it('returns lower score for partially overlapping text', () => {
    const score = similarity(
      'What certifications do you hold?',
      'List your ISO certifications and accreditations',
    );
    expect(score).toBeGreaterThan(0.1);
    expect(score).toBeLessThan(0.8);
  });

  it('handles single-word inputs', () => {
    expect(similarity('security', 'security')).toBe(1.0);
    expect(similarity('security', 'compliance')).toBe(0.0);
  });

  it('is symmetric', () => {
    const a = 'Describe your quality management system';
    const b = 'Quality management system description required';
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it('handles strings with only punctuation (normalises to empty)', () => {
    expect(similarity('!!!', '???')).toBe(0);
  });

  it('scores higher for more word overlap', () => {
    const exactMatch = similarity(
      'How do you handle GDPR compliance?',
      'How do you handle GDPR compliance?',
    );
    const partialMatch = similarity(
      'How do you handle GDPR compliance?',
      'GDPR compliance procedures',
    );
    expect(exactMatch).toBeGreaterThan(partialMatch);
  });

  it('ignores punctuation differences', () => {
    const score = similarity(
      'Q3.1: What is your approach?',
      'Q3.1 What is your approach',
    );
    expect(score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Auto-map integration scenarios
// ---------------------------------------------------------------------------

describe('auto-map scenarios', () => {
  const procurementQuestions = [
    {
      id: 'q1',
      text: 'Describe your approach to information security management',
    },
    { id: 'q2', text: 'List your relevant ISO certifications' },
    { id: 'q3', text: 'How do you ensure GDPR compliance in your operations?' },
    { id: 'q4', text: 'Describe your business continuity planning process' },
    {
      id: 'q5',
      text: 'What is your approach to environmental sustainability?',
    },
  ];

  function findBestMatch(
    fieldText: string,
    threshold: number = 0.7,
  ): { questionId: string; confidence: number } | null {
    let best: { questionId: string; confidence: number } | null = null;

    for (const q of procurementQuestions) {
      const score = similarity(fieldText, q.text);
      if (score >= threshold && (!best || score > best.confidence)) {
        best = { questionId: q.id, confidence: score };
      }
    }

    return best;
  }

  it('maps fields to questions above threshold', () => {
    const match = findBestMatch(
      'Please describe your approach to information security',
    );
    expect(match).not.toBeNull();
    expect(match!.questionId).toBe('q1');
    expect(match!.confidence).toBeGreaterThan(0.7);
  });

  it('does not map below threshold', () => {
    const match = findBestMatch('What is your company registration number?');
    expect(match).toBeNull();
  });

  it('handles no matching questions', () => {
    const match = findBestMatch(
      'Completely unrelated topic about cooking recipes',
    );
    expect(match).toBeNull();
  });

  it('picks the highest-confidence match when multiple are possible', () => {
    // This should match q3 (GDPR compliance) better than others
    const match = findBestMatch('How do you ensure GDPR compliance?');
    expect(match).not.toBeNull();
    expect(match!.questionId).toBe('q3');
  });

  it('maps ISO certifications correctly', () => {
    const match = findBestMatch('List your ISO certifications and standards');
    expect(match).not.toBeNull();
    expect(match!.questionId).toBe('q2');
  });

  it('works with lower threshold', () => {
    const match = findBestMatch('Business continuity', 0.3);
    expect(match).not.toBeNull();
    expect(match!.questionId).toBe('q4');
  });
});
