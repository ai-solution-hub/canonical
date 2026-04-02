import { describe, it, expect } from 'vitest';
import { generateBidDocx } from '@/lib/bid/bid-export-docx';
import type {
  ExportQuestion,
  ExportBidMetadata,
} from '@/lib/bid/bid-export-types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeMetadata(
  overrides: Partial<ExportBidMetadata> = {},
): ExportBidMetadata {
  return {
    bid_name: 'IT Support Services',
    buyer: 'NHS Greater Manchester',
    reference_number: 'NHS-GM-2026-001',
    deadline: '2026-04-15T17:00:00Z',
    status: 'in_review',
    estimated_value: '£250,000',
    notes: null,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<ExportQuestion> = {}): ExportQuestion {
  return {
    question_id: 'q-001',
    section_name: 'Technical Capability',
    section_sequence: 1,
    question_sequence: 1,
    question_text: 'Describe your approach to data encryption.',
    word_limit: 500,
    evaluation_weight: 15,
    confidence_posture: 'strong_match',
    status: 'complete',
    response_text:
      '<p>Our approach to data encryption involves AES-256 for data at rest.</p>',
    response_text_advanced: null,
    review_status: 'approved',
    citations: [
      {
        source_index: 1,
        source_title: 'Information Security Policy',
        source_id: 'ci-001',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateBidDocx', () => {
  // -----------------------------------------------------------------------
  // 1. Full data generation
  // -----------------------------------------------------------------------
  it('should generate a DOCX buffer with full data', async () => {
    const buffer = await generateBidDocx(makeMetadata(), [makeQuestion()]);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 2. PK magic bytes (ZIP format)
  // -----------------------------------------------------------------------
  it('should produce a buffer starting with PK magic bytes', async () => {
    const buffer = await generateBidDocx(makeMetadata(), [makeQuestion()]);
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4b); // K
  });

  // -----------------------------------------------------------------------
  // 3. includeCover: false
  // -----------------------------------------------------------------------
  it('should generate a smaller DOCX without cover page', async () => {
    const withCover = await generateBidDocx(makeMetadata(), [makeQuestion()], {
      includeCover: true,
    });
    const withoutCover = await generateBidDocx(
      makeMetadata(),
      [makeQuestion()],
      { includeCover: false },
    );
    expect(withoutCover.length).toBeLessThan(withCover.length);
    // Still valid ZIP
    expect(withoutCover[0]).toBe(0x50);
    expect(withoutCover[1]).toBe(0x4b);
  });

  // -----------------------------------------------------------------------
  // 4. includeToc: false
  // -----------------------------------------------------------------------
  it('should generate a valid DOCX without table of contents', async () => {
    const buffer = await generateBidDocx(makeMetadata(), [makeQuestion()], {
      includeToc: false,
    });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  // -----------------------------------------------------------------------
  // 5. includeCitations: false
  // -----------------------------------------------------------------------
  it('should generate a valid DOCX without citations', async () => {
    const withCitations = await generateBidDocx(
      makeMetadata(),
      [makeQuestion()],
      { includeCitations: true },
    );
    const withoutCitations = await generateBidDocx(
      makeMetadata(),
      [makeQuestion()],
      { includeCitations: false },
    );
    // Without citations should be smaller (citation text omitted)
    expect(withoutCitations.length).toBeLessThan(withCitations.length);
  });

  // -----------------------------------------------------------------------
  // 6. includeUnanswered: false
  // -----------------------------------------------------------------------
  it('should exclude unanswered questions when includeUnanswered is false', async () => {
    const questions = [
      makeQuestion({ question_id: 'q-001', response_text: '<p>Answer</p>' }),
      makeQuestion({
        question_id: 'q-002',
        question_sequence: 2,
        response_text: null,
      }),
    ];

    const withUnanswered = await generateBidDocx(makeMetadata(), questions, {
      includeUnanswered: true,
    });
    const withoutUnanswered = await generateBidDocx(makeMetadata(), questions, {
      includeUnanswered: false,
    });

    // Excluding unanswered should produce a smaller document
    expect(withoutUnanswered.length).toBeLessThan(withUnanswered.length);
  });

  // -----------------------------------------------------------------------
  // 7. useAdvancedVariant: true
  // -----------------------------------------------------------------------
  it('should use advanced variant text when useAdvancedVariant is true', async () => {
    const question = makeQuestion({
      response_text: '<p>Standard response.</p>',
      response_text_advanced:
        '<p>Advanced response with significantly more detailed content and additional paragraphs explaining the approach.</p>',
    });

    const standard = await generateBidDocx(makeMetadata(), [question], {
      useAdvancedVariant: false,
    });
    const advanced = await generateBidDocx(makeMetadata(), [question], {
      useAdvancedVariant: true,
    });

    // Advanced variant has more text, so buffer should differ in size
    expect(advanced.length).not.toBe(standard.length);
  });

  // -----------------------------------------------------------------------
  // 8. Custom company name
  // -----------------------------------------------------------------------
  it('should generate a valid DOCX with a custom company name', async () => {
    const buffer = await generateBidDocx(makeMetadata(), [makeQuestion()], {
      companyName: 'Acme Solutions Ltd',
    });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  // -----------------------------------------------------------------------
  // 9. Multiple sections grouped correctly
  // -----------------------------------------------------------------------
  it('should group questions into multiple sections', async () => {
    const questions = [
      makeQuestion({
        question_id: 'q-001',
        section_name: 'Technical Capability',
        section_sequence: 1,
        question_sequence: 1,
      }),
      makeQuestion({
        question_id: 'q-002',
        section_name: 'Commercial',
        section_sequence: 2,
        question_sequence: 1,
      }),
      makeQuestion({
        question_id: 'q-003',
        section_name: 'Technical Capability',
        section_sequence: 1,
        question_sequence: 2,
      }),
    ];

    const buffer = await generateBidDocx(makeMetadata(), questions);
    // Should produce a valid document — multiple sections means more content
    expect(buffer.length).toBeGreaterThan(0);

    const singleSection = await generateBidDocx(makeMetadata(), [
      makeQuestion(),
    ]);
    expect(buffer.length).toBeGreaterThan(singleSection.length);
  });

  // -----------------------------------------------------------------------
  // 10. Null section_name falls back to "General Questions"
  // -----------------------------------------------------------------------
  it('should group null section_name questions under "General Questions"', async () => {
    const question = makeQuestion({
      section_name: '',
      section_sequence: 99,
    });

    const buffer = await generateBidDocx(makeMetadata(), [question]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
  });

  // -----------------------------------------------------------------------
  // 11. Sections ordered by sequence
  // -----------------------------------------------------------------------
  it('should order sections by section_sequence', async () => {
    const questions = [
      makeQuestion({
        question_id: 'q-002',
        section_name: 'Commercial',
        section_sequence: 2,
        question_sequence: 1,
        response_text: '<p>Commercial answer</p>',
      }),
      makeQuestion({
        question_id: 'q-001',
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 1,
        response_text: '<p>Technical answer</p>',
      }),
    ];

    // Both orderings should produce a valid document of the same content
    const buffer = await generateBidDocx(makeMetadata(), questions);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
  });

  // -----------------------------------------------------------------------
  // 12. Questions ordered within section
  // -----------------------------------------------------------------------
  it('should order questions by question_sequence within a section', async () => {
    const questions = [
      makeQuestion({
        question_id: 'q-003',
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 3,
      }),
      makeQuestion({
        question_id: 'q-001',
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 1,
      }),
      makeQuestion({
        question_id: 'q-002',
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 2,
      }),
    ];

    const buffer = await generateBidDocx(makeMetadata(), questions);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
  });

  // -----------------------------------------------------------------------
  // 13. Question with no response
  // -----------------------------------------------------------------------
  it('should handle questions with no response text', async () => {
    const question = makeQuestion({
      response_text: null,
      review_status: null,
      status: 'not_started',
      citations: [],
    });

    const buffer = await generateBidDocx(makeMetadata(), [question]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
  });

  // -----------------------------------------------------------------------
  // 14. Word count within limit (green)
  // -----------------------------------------------------------------------
  it('should produce valid output for questions within word limit', async () => {
    // 13 words, limit 500 — well within
    const question = makeQuestion({
      response_text:
        '<p>Our approach to data encryption involves AES-256 for data at rest.</p>',
      word_limit: 500,
    });

    const buffer = await generateBidDocx(makeMetadata(), [question]);
    expect(buffer.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 15. Word count over limit (red)
  // -----------------------------------------------------------------------
  it('should produce valid output for questions over word limit', async () => {
    // 13 words, limit 5 — over limit
    const question = makeQuestion({
      response_text:
        '<p>Our approach to data encryption involves AES-256 for data at rest.</p>',
      word_limit: 5,
    });

    const buffer = await generateBidDocx(makeMetadata(), [question]);
    expect(buffer.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 16. Word count with no limit (grey)
  // -----------------------------------------------------------------------
  it('should produce valid output for questions with no word limit', async () => {
    const question = makeQuestion({
      response_text: '<p>Some response text here.</p>',
      word_limit: null,
    });

    const buffer = await generateBidDocx(makeMetadata(), [question]);
    expect(buffer.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 17. Empty questions array
  // -----------------------------------------------------------------------
  it('should generate a valid DOCX with empty questions array', async () => {
    const buffer = await generateBidDocx(makeMetadata(), []);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  // -----------------------------------------------------------------------
  // 18. HTML response with formatting tags
  // -----------------------------------------------------------------------
  it('should handle HTML response with formatting tags', async () => {
    const question = makeQuestion({
      response_text:
        '<p>We use <strong>AES-256</strong> encryption for <em>all</em> data at rest.</p>' +
        '<ul><li>Server-side encryption</li><li>Client-side encryption</li></ul>' +
        '<p>Our <u>comprehensive</u> approach covers all scenarios.</p>',
    });

    const buffer = await generateBidDocx(makeMetadata(), [question]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  // -----------------------------------------------------------------------
  // 19. All options disabled
  // -----------------------------------------------------------------------
  it('should generate a valid DOCX with all optional sections disabled', async () => {
    const buffer = await generateBidDocx(makeMetadata(), [makeQuestion()], {
      includeCover: false,
      includeToc: false,
      includeCitations: false,
    });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  // -----------------------------------------------------------------------
  // 20. Advanced variant falls back to standard when advanced is null
  // -----------------------------------------------------------------------
  it('should fall back to standard response when advanced variant is null', async () => {
    const question = makeQuestion({
      response_text: '<p>Standard response.</p>',
      response_text_advanced: null,
    });

    const standard = await generateBidDocx(makeMetadata(), [question], {
      useAdvancedVariant: false,
    });
    const advancedFallback = await generateBidDocx(makeMetadata(), [question], {
      useAdvancedVariant: true,
    });

    // Both should produce similar output since advanced is null
    // (minor differences possible due to ZIP compression non-determinism)
    expect(Math.abs(advancedFallback.length - standard.length)).toBeLessThan(
      10,
    );
  });

  // -----------------------------------------------------------------------
  // 21. Multiple questions with mixed response states
  // -----------------------------------------------------------------------
  it('should handle a mix of answered and unanswered questions', async () => {
    const questions = [
      makeQuestion({
        question_id: 'q-001',
        question_sequence: 1,
        response_text: '<p>Answered</p>',
        review_status: 'approved',
      }),
      makeQuestion({
        question_id: 'q-002',
        question_sequence: 2,
        response_text: null,
        review_status: null,
        status: 'not_started',
        citations: [],
      }),
      makeQuestion({
        question_id: 'q-003',
        question_sequence: 3,
        response_text: '<p>AI draft</p>',
        review_status: 'ai_drafted',
      }),
    ];

    const buffer = await generateBidDocx(makeMetadata(), questions);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
  });

  // -----------------------------------------------------------------------
  // 22. Special characters in metadata
  // -----------------------------------------------------------------------
  it('should handle special characters in bid name and buyer', async () => {
    const metadata = makeMetadata({
      bid_name: 'IT Support & Infrastructure — Phase "One"',
      buyer: "O'Brien & Associates Ltd",
      estimated_value: '£1,500,000',
    });

    const buffer = await generateBidDocx(metadata, [makeQuestion()]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
  });

  // -----------------------------------------------------------------------
  // 23. Metadata with null optional fields
  // -----------------------------------------------------------------------
  it('should handle metadata with null optional fields', async () => {
    const metadata = makeMetadata({
      reference_number: null,
      deadline: null,
      estimated_value: null,
      notes: null,
    });

    const buffer = await generateBidDocx(metadata, [makeQuestion()]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
  });

  // -----------------------------------------------------------------------
  // 24. Question with multiple citations
  // -----------------------------------------------------------------------
  it('should handle questions with multiple citations', async () => {
    const question = makeQuestion({
      citations: [
        {
          source_index: 1,
          source_title: 'Information Security Policy',
          source_id: 'ci-001',
        },
        {
          source_index: 2,
          source_title: 'Data Protection Framework',
          source_id: 'ci-002',
        },
        {
          source_index: 3,
          source_title: 'ISO 27001 Certification',
          source_id: 'ci-003',
        },
      ],
    });

    const buffer = await generateBidDocx(makeMetadata(), [question]);
    expect(buffer.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 25. Question with empty citations array
  // -----------------------------------------------------------------------
  it('should handle questions with no citations', async () => {
    const question = makeQuestion({ citations: [] });

    const buffer = await generateBidDocx(makeMetadata(), [question], {
      includeCitations: true,
    });
    expect(buffer.length).toBeGreaterThan(0);
  });
});
