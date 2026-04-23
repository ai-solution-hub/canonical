/**
 * Tests for Q&A pair detection engine.
 *
 * Covers all three detection strategies (table, numbered list, heading-paragraph),
 * header normalisation, deduplication, confidence levels, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  detectQAPairs,
  splitIntoQAPairs,
  normaliseHeader,
  type DetectedQAPair,
} from '@/lib/quality/qa-detection';

// ---------------------------------------------------------------------------
// Helper to build HTML table strings for tests
// ---------------------------------------------------------------------------

function buildTable(headers: string[], rows: string[][]): string {
  const headerRow = headers.map((h) => `<th>${h}</th>`).join('');
  const dataRows = rows
    .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table><tr>${headerRow}</tr>\n${dataRows}</table>`;
}

// ---------------------------------------------------------------------------
// 1. Header normalisation
// ---------------------------------------------------------------------------

describe('normaliseHeader', () => {
  it('normalises "question" variants', () => {
    expect(normaliseHeader('Question')).toBe('question');
    expect(normaliseHeader('Questions')).toBe('question');
    expect(normaliseHeader('QUERY')).toBe('question');
    expect(normaliseHeader('Requirement')).toBe('question');
    expect(normaliseHeader('Requirements')).toBe('question');
    expect(normaliseHeader('Suggested Questions')).toBe('question');
  });

  it('normalises "standard" response variants', () => {
    expect(normaliseHeader('Standard Response')).toBe('standard');
    expect(normaliseHeader('Standard Answer')).toBe('standard');
    expect(normaliseHeader('Response')).toBe('standard');
    expect(normaliseHeader('Answer')).toBe('standard');
    expect(normaliseHeader('Supplier Response')).toBe('standard');
    expect(normaliseHeader('Your Response')).toBe('standard');
    expect(normaliseHeader('Your Answer')).toBe('standard');
    expect(normaliseHeader("Tenderer's Response")).toBe('standard');
    expect(normaliseHeader("Bidder's Response")).toBe('standard');
    expect(normaliseHeader('Organisation Response')).toBe('standard');
    expect(normaliseHeader('Applicant Response')).toBe('standard');
    expect(normaliseHeader("Applicant's Response")).toBe('standard');
  });

  it('normalises "advanced" response variants', () => {
    expect(normaliseHeader('Advanced Response')).toBe('advanced');
    expect(normaliseHeader('Advanced Answer')).toBe('advanced');
    expect(normaliseHeader('Enhanced Response')).toBe('advanced');
    expect(normaliseHeader('Enhanced Answer')).toBe('advanced');
    expect(normaliseHeader('Answer for Advanced Audits')).toBe('advanced');
    expect(normaliseHeader('Advanced Audits Answer')).toBe('advanced');
  });

  it('normalises section column variants', () => {
    expect(normaliseHeader('Section')).toBe('section');
    expect(normaliseHeader('Category')).toBe('section');
    expect(normaliseHeader('Topic')).toBe('section');
    expect(normaliseHeader('Area')).toBe('section');
    expect(normaliseHeader('Quality Management')).toBe('section');
    expect(normaliseHeader('Health and Safety')).toBe('section');
  });

  it('normalises number column variants', () => {
    expect(normaliseHeader('No')).toBe('number');
    expect(normaliseHeader('No.')).toBe('number');
    expect(normaliseHeader('#')).toBe('number');
    expect(normaliseHeader('Ref')).toBe('number');
    expect(normaliseHeader('ID')).toBe('number');
  });

  it('normalises notes/guidance column variants', () => {
    expect(normaliseHeader('Notes')).toBe('notes');
    expect(normaliseHeader('Comments')).toBe('notes');
    expect(normaliseHeader('Guidance')).toBe('notes');
    expect(normaliseHeader('Guidance Notes')).toBe('notes');
    expect(normaliseHeader('Max Score')).toBe('notes');
    expect(normaliseHeader('Weighting')).toBe('notes');
    expect(normaliseHeader('Pass/Fail')).toBe('notes');
  });

  it('strips trailing punctuation before matching', () => {
    expect(normaliseHeader('Question:')).toBe('question');
    expect(normaliseHeader('Answer-')).toBe('standard');
    expect(normaliseHeader('Notes_')).toBe('notes');
  });

  it('handles whitespace and casing', () => {
    expect(normaliseHeader('  Question  ')).toBe('question');
    expect(normaliseHeader('STANDARD RESPONSE')).toBe('standard');
    expect(normaliseHeader('  advanced response  ')).toBe('advanced');
  });

  it('returns cleaned text for unknown headers', () => {
    expect(normaliseHeader('Custom Column')).toBe('custom column');
    expect(normaliseHeader('  Foo Bar:  ')).toBe('foo bar');
  });

  it('handles at least 30 common header variants', () => {
    // Verify the map has sufficient coverage
    const uniqueInputs = [
      'question',
      'questions',
      'query',
      'requirement',
      'requirements',
      'standard response',
      'standard answer',
      'response',
      'answer',
      'supplier response',
      'your response',
      'your answer',
      'tenderer response',
      "tenderer's response",
      'bidder response',
      'advanced response',
      'advanced answer',
      'enhanced response',
      'section',
      'category',
      'topic',
      'area',
      'no',
      'no.',
      '#',
      'number',
      'ref',
      'id',
      'notes',
      'comments',
      'guidance',
      'guidance notes',
    ];
    // All should map to a known canonical name
    for (const input of uniqueInputs) {
      const result = normaliseHeader(input);
      expect([
        'question',
        'standard',
        'advanced',
        'section',
        'number',
        'notes',
      ]).toContain(result);
    }
    expect(uniqueInputs.length).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// 2. Table extraction
// ---------------------------------------------------------------------------

describe('detectQAPairs — table extraction', () => {
  it('extracts pairs from a simple Question/Answer table', () => {
    const html = buildTable(
      ['Question', 'Answer'],
      [
        ['What is your quality policy?', 'We follow ISO 9001 standards.'],
        ['How do you handle complaints?', 'Through our formal process.'],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('What is your quality policy?');
    expect(pairs[0].answer).toBe('We follow ISO 9001 standards.');
    expect(pairs[0].source).toBe('table');
    expect(pairs[0].confidence).toBe('high');
    expect(pairs[1].question).toBe('How do you handle complaints?');
  });

  it('extracts pairs from a 6-column audit format table', () => {
    const html = buildTable(
      [
        'No',
        'Section',
        'Question',
        'Standard Response',
        'Advanced Response',
        'Notes',
      ],
      [
        [
          '1',
          'Quality',
          'What is your QMS?',
          'ISO 9001',
          'ISO 9001 + TQM',
          'See annex',
        ],
        [
          '2',
          'Quality',
          'How do you audit?',
          'Annual audits',
          'Quarterly audits',
          '',
        ],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('What is your QMS?');
    expect(pairs[0].answer).toBe('ISO 9001');
    expect(pairs[0].answerAdvanced).toBe('ISO 9001 + TQM');
    expect(pairs[0].sectionName).toBe('Quality');
    expect(pairs[0].tableIndex).toBe(0);
    expect(pairs[0].rowIndex).toBe(1);
  });

  it('extracts pairs from a 5-column draft format table', () => {
    const html = buildTable(
      ['No', 'Section', 'Question', 'Standard Response', 'Notes'],
      [
        [
          '1',
          'H&S',
          'Describe your H&S policy',
          'We have a comprehensive H&S policy...',
          'Mandatory',
        ],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('Describe your H&S policy');
    expect(pairs[0].answer).toBe('We have a comprehensive H&S policy...');
    expect(pairs[0].answerAdvanced).toBe('');
    expect(pairs[0].sectionName).toBe('H&S');
  });

  it('extracts pairs from a numbered 6-column format (section after question)', () => {
    const html = buildTable(
      [
        'No',
        'Question',
        'Standard Answer',
        'Advanced Answer',
        'Section',
        'Notes',
      ],
      [
        [
          '1',
          'What certifications do you hold?',
          'ISO 9001, ISO 14001',
          'All ISO plus OHSAS',
          'Compliance',
          '',
        ],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('What certifications do you hold?');
    expect(pairs[0].answer).toBe('ISO 9001, ISO 14001');
    expect(pairs[0].answerAdvanced).toBe('All ISO plus OHSAS');
    expect(pairs[0].sectionName).toBe('Compliance');
  });

  it('handles variant header spellings (Supplier Response, Your Answer)', () => {
    const html = buildTable(
      ['Requirement', 'Supplier Response'],
      [
        [
          'Provide evidence of insurance',
          'We hold public liability insurance of 10M...',
        ],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('Provide evidence of insurance');
    expect(pairs[0].answer).toBe(
      'We hold public liability insurance of 10M...',
    );
  });

  it('skips empty question rows', () => {
    const html = buildTable(
      ['Question', 'Answer'],
      [
        ['What is your policy?', 'We follow best practice.'],
        ['', ''],
        ['  ', 'Orphaned answer'],
        ['How do you verify?', 'Through regular audits.'],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('What is your policy?');
    expect(pairs[1].question).toBe('How do you verify?');
  });

  it('ignores non-Q&A tables (no question/answer headers)', () => {
    const html = buildTable(
      ['Name', 'Date', 'Amount'],
      [
        ['Alice', '01/01/2026', '1000'],
        ['Bob', '02/02/2026', '2000'],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(0);
  });

  it('handles mixed tables (one Q&A, one non-Q&A)', () => {
    const nonQA = buildTable(['Name', 'Role'], [['Alice', 'Manager']]);
    const qa = buildTable(
      ['Question', 'Answer'],
      [['What services do you provide?', 'Consulting and development.']],
    );

    const pairs = detectQAPairs(`${nonQA}\n${qa}`);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('What services do you provide?');
  });

  it('tracks section headings from preceding h2 elements', () => {
    const html = `
      <h2>Environmental Management</h2>
      <table>
        <tr><th>Question</th><th>Response</th></tr>
        <tr><td>What is your environmental policy?</td><td>We follow ISO 14001.</td></tr>
      </table>
      <h2>Quality Assurance</h2>
      <table>
        <tr><th>Question</th><th>Answer</th></tr>
        <tr><td>Describe your QA process</td><td>Rigorous testing at every stage.</td></tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].sectionName).toBe('Environmental Management');
    expect(pairs[1].sectionName).toBe('Quality Assurance');
  });

  it('preserves standard and advanced answers as separate fields', () => {
    const html = buildTable(
      ['Question', 'Standard Response', 'Advanced Response'],
      [
        [
          'How do you ensure quality?',
          'We use checklists.',
          'We use automated testing + checklists.',
        ],
      ],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].answer).toBe('We use checklists.');
    expect(pairs[0].answerAdvanced).toBe(
      'We use automated testing + checklists.',
    );
  });

  it('handles tables with paragraph elements inside cells', () => {
    const html = `
      <table>
        <tr><th>Question</th><th>Answer</th></tr>
        <tr>
          <td><p>What is your approach to risk management?</p></td>
          <td><p>We identify risks early.</p><p>We then mitigate them systematically.</p></td>
        </tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('What is your approach to risk management?');
    // Paragraph breaks should be preserved as newlines
    expect(pairs[0].answer).toContain('We identify risks early.');
    expect(pairs[0].answer).toContain('We then mitigate them systematically.');
  });

  it('handles table with th cells in header and td cells in data rows', () => {
    const html = `
      <table>
        <tr><th>Query</th><th>Your Response</th></tr>
        <tr><td>Explain your methodology</td><td>We use agile principles.</td></tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('Explain your methodology');
  });
});

// ---------------------------------------------------------------------------
// 3. Numbered list extraction
// ---------------------------------------------------------------------------

describe('detectQAPairs — numbered list extraction', () => {
  it('extracts Q1:/A1: numbered pairs', () => {
    const html = `<p>Q1: What is your company history?</p>
<p>A1: Founded in 2005, we have grown to 200 employees.</p>
<p>Q2: What are your core competencies?</p>
<p>A2: Software development and consulting.</p>`;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('What is your company history?');
    expect(pairs[0].answer).toBe(
      'Founded in 2005, we have grown to 200 employees.',
    );
    expect(pairs[0].source).toBe('list');
    expect(pairs[0].confidence).toBe('medium');
    expect(pairs[1].question).toBe('What are your core competencies?');
  });

  it('extracts Q1. A1. numbered pairs (period delimiter)', () => {
    const html = `<p>Q1. Describe your quality management system.</p>
<p>A1. We operate a certified ISO 9001 QMS.</p>
<p>Q2. How do you measure customer satisfaction?</p>
<p>A2. Through quarterly surveys and NPS tracking.</p>`;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('Describe your quality management system.');
    expect(pairs[0].answer).toBe('We operate a certified ISO 9001 QMS.');
  });

  it('does not extract numbered lists when tables are present with same content', () => {
    // Table extraction should take priority; numbered lists in the same
    // document should not create duplicates
    const html = `
      <table>
        <tr><th>Question</th><th>Answer</th></tr>
        <tr><td>What is your QMS?</td><td>ISO 9001 certified.</td></tr>
      </table>
      <p>Q1: What is your QMS?</p>
      <p>A1: ISO 9001 certified.</p>
    `;

    const pairs = detectQAPairs(html);
    // Should deduplicate — table version wins (higher confidence)
    expect(pairs).toHaveLength(1);
    expect(pairs[0].source).toBe('table');
    expect(pairs[0].confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// 4. Heading-paragraph extraction
// ---------------------------------------------------------------------------

describe('detectQAPairs — heading-paragraph extraction', () => {
  it('extracts heading questions followed by paragraph answers', () => {
    const html = `
      <h2>What is your approach to sustainability?</h2>
      <p>We integrate sustainability into all aspects of our operations.</p>
      <p>This includes carbon reduction targets and supply chain auditing.</p>
      <h2>How do you ensure staff wellbeing?</h2>
      <p>We provide comprehensive mental health support and flexible working.</p>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('What is your approach to sustainability?');
    expect(pairs[0].answer).toContain('sustainability into all aspects');
    expect(pairs[0].answer).toContain('carbon reduction targets');
    expect(pairs[0].source).toBe('heading');
    expect(pairs[0].confidence).toBe('medium');
    expect(pairs[1].question).toBe('How do you ensure staff wellbeing?');
  });

  it('detects imperative-style headings as questions', () => {
    const html = `
      <h3>Please describe your approach to data protection</h3>
      <p>We comply with UK GDPR and have appointed a Data Protection Officer.</p>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe(
      'Please describe your approach to data protection',
    );
  });

  it('ignores non-question headings', () => {
    const html = `
      <h2>Introduction</h2>
      <p>This document describes our capabilities.</p>
      <h2>Section 1</h2>
      <p>Our company was founded in 2005.</p>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(0);
  });

  it('ignores headings without subsequent paragraph content', () => {
    const html = `
      <h2>What is your policy on modern slavery?</h2>
      <h2>How do you handle GDPR compliance?</h2>
      <p>We follow all applicable data protection regulations.</p>
    `;

    const pairs = detectQAPairs(html);
    // Only the second question has a following paragraph
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('How do you handle GDPR compliance?');
  });
});

// ---------------------------------------------------------------------------
// 5. Mixed content detection
// ---------------------------------------------------------------------------

describe('detectQAPairs — mixed content', () => {
  it('combines table and list results without duplicates', () => {
    const html = `
      <table>
        <tr><th>Question</th><th>Answer</th></tr>
        <tr><td>What is your QMS?</td><td>ISO 9001 certified.</td></tr>
      </table>
      <p>Q1: What is your data retention policy?</p>
      <p>A1: We retain data for 7 years as required by law.</p>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].source).toBe('table');
    expect(pairs[0].confidence).toBe('high');
    expect(pairs[1].source).toBe('list');
    expect(pairs[1].confidence).toBe('medium');
  });

  it('combines table and heading results without duplicates', () => {
    const html = `
      <table>
        <tr><th>Question</th><th>Response</th></tr>
        <tr><td>What services do you offer?</td><td>Consulting and development.</td></tr>
      </table>
      <h2>What is your approach to innovation?</h2>
      <p>We invest 15% of revenue in R&D annually.</p>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].source).toBe('table');
    expect(pairs[1].source).toBe('heading');
  });
});

// ---------------------------------------------------------------------------
// 6. Deduplication
// ---------------------------------------------------------------------------

describe('detectQAPairs — deduplication', () => {
  it('deduplicates near-identical questions across strategies', () => {
    // Table has "What is your QMS?" and list also has "What is your QMS?"
    const html = `
      <table>
        <tr><th>Question</th><th>Answer</th></tr>
        <tr><td>What is your quality management system?</td><td>ISO 9001.</td></tr>
      </table>
      <p>Q1: What is your quality management system?</p>
      <p>A1: ISO 9001 certified quality management system.</p>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    // Table version should win (higher confidence)
    expect(pairs[0].source).toBe('table');
  });
});

// ---------------------------------------------------------------------------
// 7. Confidence levels
// ---------------------------------------------------------------------------

describe('detectQAPairs — confidence levels', () => {
  it('assigns high confidence to table-extracted pairs', () => {
    const html = buildTable(
      ['Question', 'Answer'],
      [['What is your policy?', 'We follow best practice.']],
    );

    const pairs = detectQAPairs(html);
    expect(pairs[0].confidence).toBe('high');
  });

  it('assigns medium confidence to list-extracted pairs', () => {
    const html = `<p>Q1: What is your policy?</p><p>A1: We follow best practice.</p>`;

    const pairs = detectQAPairs(html);
    expect(pairs[0].confidence).toBe('medium');
  });

  it('assigns medium confidence to heading-extracted pairs', () => {
    const html = `<h2>What is your approach to training?</h2><p>We provide regular CPD opportunities.</p>`;

    const pairs = detectQAPairs(html);
    expect(pairs[0].confidence).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// 8. Edge cases and error handling
// ---------------------------------------------------------------------------

describe('detectQAPairs — edge cases', () => {
  it('returns empty array for empty string', () => {
    expect(detectQAPairs('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(detectQAPairs('   \n\t  ')).toEqual([]);
  });

  it('returns empty array for HTML with no Q&A content', () => {
    const html = '<p>This is a normal paragraph with no questions.</p>';
    expect(detectQAPairs(html)).toEqual([]);
  });

  it('returns empty array for null-ish input', () => {
    expect(detectQAPairs(null as unknown as string)).toEqual([]);
    expect(detectQAPairs(undefined as unknown as string)).toEqual([]);
  });

  it('handles malformed HTML gracefully', () => {
    const malformed =
      '<table><tr><th>Question<th>Answer</tr><tr><td>Test?<td>Yes</table>';
    // Should not throw — may or may not extract depending on parser tolerance
    expect(() => detectQAPairs(malformed)).not.toThrow();
  });

  it('handles table with only a header row (no data)', () => {
    const html = '<table><tr><th>Question</th><th>Answer</th></tr></table>';
    expect(detectQAPairs(html)).toEqual([]);
  });

  it('handles table with single row (treated as header, no data)', () => {
    const html = buildTable(['Question', 'Answer'], []);
    expect(detectQAPairs(html)).toEqual([]);
  });

  it('handles very large question text without crashing', () => {
    const longQuestion = 'A'.repeat(5000);
    const html = buildTable(
      ['Question', 'Answer'],
      [[longQuestion, 'Short answer.']],
    );

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe(longQuestion);
  });
});

// ---------------------------------------------------------------------------
// 9. splitIntoQAPairs
// ---------------------------------------------------------------------------

describe('splitIntoQAPairs', () => {
  it('maps detected pairs to QACreateInput format', () => {
    const pairs: DetectedQAPair[] = [
      {
        question: 'What is your quality policy?',
        answer: 'We follow ISO 9001 standards throughout our operations.',
        answerAdvanced: 'In addition to ISO 9001, we implement TQM principles.',
        source: 'table',
        confidence: 'high',
        sectionName: 'Quality',
        tableIndex: 0,
        rowIndex: 1,
      },
    ];

    const result = splitIntoQAPairs(pairs);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('What is your quality policy?');
    expect(result[0].content).toBe(
      'Q: What is your quality policy?\n\nWe follow ISO 9001 standards throughout our operations.',
    );
    expect(result[0].contentType).toBe('q_a_pair');
    expect(result[0].sectionName).toBe('Quality');
    expect(result[0].answerAdvanced).toBe(
      'In addition to ISO 9001, we implement TQM principles.',
    );
    expect(result[0].source).toBe('table');
    expect(result[0].confidence).toBe('high');
  });

  it('truncates long question titles at word boundary to 120 chars', () => {
    const longQuestion =
      'Please describe in detail your organisation approach to managing environmental sustainability across all of your operations including supply chain management and waste disposal procedures';

    const pairs: DetectedQAPair[] = [
      {
        question: longQuestion,
        answer: 'We have a comprehensive environmental policy.',
        answerAdvanced: '',
        source: 'table',
        confidence: 'high',
        sectionName: '',
        tableIndex: 0,
        rowIndex: 1,
      },
    ];

    const result = splitIntoQAPairs(pairs);
    expect(result[0].title.length).toBeLessThanOrEqual(120);
    expect(result[0].title).toContain('...');
    // Full question should still be in the content body
    expect(result[0].content).toContain(longQuestion);
  });

  it('deduplicates near-identical questions keeping higher confidence', () => {
    const pairs: DetectedQAPair[] = [
      {
        question: 'What is your quality management system?',
        answer: 'ISO 9001.',
        answerAdvanced: '',
        source: 'list',
        confidence: 'medium',
        sectionName: '',
        tableIndex: -1,
        rowIndex: -1,
      },
      {
        question: 'What is your quality management system?',
        answer: 'We hold ISO 9001 certification.',
        answerAdvanced: '',
        source: 'table',
        confidence: 'high',
        sectionName: 'Quality',
        tableIndex: 0,
        rowIndex: 1,
      },
    ];

    const result = splitIntoQAPairs(pairs);
    expect(result).toHaveLength(1);
    // Table version should win (higher confidence)
    expect(result[0].confidence).toBe('high');
    expect(result[0].sectionName).toBe('Quality');
  });

  it('keeps both pairs when questions are different', () => {
    const pairs: DetectedQAPair[] = [
      {
        question: 'What is your QMS?',
        answer: 'ISO 9001.',
        answerAdvanced: '',
        source: 'table',
        confidence: 'high',
        sectionName: '',
        tableIndex: 0,
        rowIndex: 1,
      },
      {
        question: 'How do you handle complaints?',
        answer: 'Via our formal process.',
        answerAdvanced: '',
        source: 'table',
        confidence: 'high',
        sectionName: '',
        tableIndex: 0,
        rowIndex: 2,
      },
    ];

    const result = splitIntoQAPairs(pairs);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(splitIntoQAPairs([])).toEqual([]);
    expect(splitIntoQAPairs(null as unknown as DetectedQAPair[])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Real-world mammoth HTML snippets
// ---------------------------------------------------------------------------

describe('detectQAPairs — real-world HTML patterns', () => {
  it('handles mammoth-style table output with nested paragraphs', () => {
    // mammoth typically wraps cell content in <p> tags
    const html = `
      <table>
        <tr>
          <th><p>No.</p></th>
          <th><p>Section</p></th>
          <th><p>Question</p></th>
          <th><p>Standard Response</p></th>
          <th><p>Advanced Response</p></th>
          <th><p>Notes</p></th>
        </tr>
        <tr>
          <td><p>1</p></td>
          <td><p>Health and Safety</p></td>
          <td><p>Describe your approach to managing health and safety risks on site.</p></td>
          <td><p>We conduct regular risk assessments and maintain a health and safety management system certified to ISO 45001.</p></td>
          <td><p>In addition to ISO 45001, we employ a dedicated H&amp;S team and use predictive analytics for risk identification.</p></td>
          <td><p>Mandatory</p></td>
        </tr>
        <tr>
          <td><p>2</p></td>
          <td><p>Health and Safety</p></td>
          <td><p>What training do you provide to staff?</p></td>
          <td><p>All staff receive induction training and annual refresher courses.</p></td>
          <td><p>We offer NVQ-level qualifications and sponsor NEBOSH certification for key personnel.</p></td>
          <td><p></p></td>
        </tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe(
      'Describe your approach to managing health and safety risks on site.',
    );
    expect(pairs[0].answer).toContain('ISO 45001');
    expect(pairs[0].answerAdvanced).toContain('predictive analytics');
    expect(pairs[0].sectionName).toBe('Health and Safety');
    expect(pairs[1].question).toBe('What training do you provide to staff?');
    expect(pairs[1].sectionName).toBe('Health and Safety');
  });

  it('handles mammoth output with h2 sections and tables', () => {
    const html = `
      <h1>Bid Library</h1>
      <h2>Environmental Management</h2>
      <p>The following questions relate to environmental management practices.</p>
      <table>
        <tr><th>Question</th><th>Your Response</th></tr>
        <tr><td>What is your carbon reduction strategy?</td><td>We have committed to net zero by 2035.</td></tr>
        <tr><td>How do you manage waste?</td><td>Zero to landfill policy since 2020.</td></tr>
      </table>
      <h2>Social Value</h2>
      <table>
        <tr><th>Requirement</th><th>Supplier Response</th></tr>
        <tr><td>Describe your apprenticeship programme</td><td>We employ 50 apprentices across 3 sites.</td></tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(3);
    expect(pairs[0].sectionName).toBe('Environmental Management');
    expect(pairs[1].sectionName).toBe('Environmental Management');
    expect(pairs[2].sectionName).toBe('Social Value');
    expect(pairs[2].question).toBe('Describe your apprenticeship programme');
  });

  it('handles tables with header row using td instead of th', () => {
    // Some DOCX tables produce <td> for all cells including headers
    const html = `
      <table>
        <tr><td><strong>Question</strong></td><td><strong>Response</strong></td></tr>
        <tr><td>What insurance do you hold?</td><td>Public liability 10M, professional indemnity 5M.</td></tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('What insurance do you hold?');
  });

  it('handles HTML entities in cell content', () => {
    const html = `
      <table>
        <tr><th>Question</th><th>Answer</th></tr>
        <tr><td>What is your T&amp;Cs policy?</td><td>Our T&amp;Cs are available at example.com/terms.</td></tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    // node-html-parser should decode entities
    expect(pairs[0].question).toContain('T&Cs');
  });
});

// ---------------------------------------------------------------------------
// 11. Export verification (document-diff.ts functions are now exported)
// ---------------------------------------------------------------------------

describe('document-diff exports', () => {
  it('extractStructuredPairs is exported', async () => {
    const { extractStructuredPairs } =
      await import('@/lib/source-documents/document-diff');
    expect(typeof extractStructuredPairs).toBe('function');
  });

  it('extractTablePairs is exported', async () => {
    const { extractTablePairs } =
      await import('@/lib/source-documents/document-diff');
    expect(typeof extractTablePairs).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 12. Text fallback extraction (Finding 1)
// ---------------------------------------------------------------------------

describe('detectQAPairs — text fallback extraction', () => {
  it('detects plain "Q: ... A: ..." markers via extractStructuredPairs fallback', () => {
    const html = `<p>Q: What is X?</p>
<p>A: X is a framework for quality management.</p>
<p>Q: How does Y work?</p>
<p>A: Y integrates with existing systems via API.</p>`;

    const pairs = detectQAPairs(html);
    expect(pairs.length).toBeGreaterThanOrEqual(2);

    // Find the text-sourced pairs (may also match via list strategy)
    const xPair = pairs.find((p) => p.question.includes('What is X'));
    expect(xPair).toBeDefined();
    expect(xPair!.answer).toContain('framework for quality management');

    const yPair = pairs.find((p) => p.question.includes('How does Y work'));
    expect(yPair).toBeDefined();
    expect(yPair!.answer).toContain('integrates with existing systems');
  });

  it('detects "Question: ... Answer: ..." markers via text fallback', () => {
    const html = `<p>Question: What certifications do you hold?</p>
<p>Answer: We hold ISO 9001 and ISO 14001 certifications.</p>
<p>Question: How do you handle data protection?</p>
<p>Answer: We comply with UK GDPR and have a dedicated DPO.</p>`;

    const pairs = detectQAPairs(html);
    expect(pairs.length).toBeGreaterThanOrEqual(2);

    const certPair = pairs.find((p) => p.question.includes('certifications'));
    expect(certPair).toBeDefined();
    expect(certPair!.answer).toContain('ISO 9001');

    const dataPair = pairs.find((p) => p.question.includes('data protection'));
    expect(dataPair).toBeDefined();
    expect(dataPair!.answer).toContain('UK GDPR');
  });

  it('does not duplicate text fallback pairs already found by other strategies', () => {
    // Table extraction should find this, so text fallback should not add a duplicate
    const html = `
      <table>
        <tr><th>Question</th><th>Answer</th></tr>
        <tr><td>What is your policy?</td><td>We follow best practice.</td></tr>
      </table>
      <p>Q: What is your policy?</p>
      <p>A: We follow best practice.</p>
    `;

    const pairs = detectQAPairs(html);
    // Should deduplicate — only one pair for this question
    const policyPairs = pairs.filter((p) =>
      p.question.toLowerCase().includes('what is your policy'),
    );
    expect(policyPairs).toHaveLength(1);
    // Table version should win (higher confidence)
    expect(policyPairs[0].source).toBe('table');
  });

  it('assigns medium confidence and text source to fallback pairs', () => {
    // Use "Question:/Answer:" format which only extractStructuredPairs handles,
    // not the numbered list extractor (which needs Q1:/A1: or "1. Question:")
    const html = `<div>Question: Describe your waste management approach
Answer: We operate a zero-waste-to-landfill policy across all sites.</div>`;

    const pairs = detectQAPairs(html);
    expect(pairs.length).toBeGreaterThanOrEqual(1);

    const wastePair = pairs.find((p) =>
      p.question.includes('waste management'),
    );
    expect(wastePair).toBeDefined();
    expect(wastePair!.source).toBe('text');
    expect(wastePair!.confidence).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// 13. Positional fallback — all-empty headers (Finding 2)
// ---------------------------------------------------------------------------

describe('detectQAPairs — positional fallback for empty headers', () => {
  it('falls back to positional detection for a 5-column table with all-empty headers', () => {
    // All <th> elements are empty — should trigger positional_5col format
    const html = `
      <table>
        <tr><th></th><th></th><th></th><th></th><th></th></tr>
        <tr>
          <td>What is your environmental policy?</td>
          <td>We follow ISO 14001 standards and have a dedicated environmental team.</td>
          <td>Additional notes here</td>
          <td>Category A</td>
          <td>Mandatory</td>
        </tr>
        <tr>
          <td>How do you manage waste?</td>
          <td>Zero waste to landfill since 2020.</td>
          <td>More notes</td>
          <td>Category B</td>
          <td>Optional</td>
        </tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);
    // Positional: column 0 = question, column 1 = standard answer
    expect(pairs[0].question).toBe('What is your environmental policy?');
    expect(pairs[0].answer).toContain('ISO 14001');
    expect(pairs[0].source).toBe('table');
    expect(pairs[0].confidence).toBe('high');
    expect(pairs[1].question).toBe('How do you manage waste?');
    expect(pairs[1].answer).toContain('Zero waste to landfill');
  });

  it('falls back to positional detection for a 6-column table with all-empty headers', () => {
    // All <th> elements are empty — should trigger positional_6col format
    const html = `
      <table>
        <tr><th></th><th></th><th></th><th></th><th></th><th></th></tr>
        <tr>
          <td>What training do you provide?</td>
          <td>Standard induction plus annual refresher.</td>
          <td>NVQ qualifications and NEBOSH certification for key staff.</td>
          <td>HR</td>
          <td>1</td>
          <td>Required</td>
        </tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(1);
    // Positional 6-col: column 0 = question, column 1 = standard, column 2 = advanced
    expect(pairs[0].question).toBe('What training do you provide?');
    expect(pairs[0].answer).toContain('Standard induction');
    expect(pairs[0].answerAdvanced).toContain('NVQ qualifications');
  });
});

// ---------------------------------------------------------------------------
// 14. inferEmptyHeaders — 6-column table with partial empty headers (Finding 3)
// ---------------------------------------------------------------------------

describe('detectQAPairs — inferEmptyHeaders on tables with partial empty headers', () => {
  it('infers standard and advanced columns when headers 1-2 are empty but column 0 is Question', () => {
    // Column 0 = "Question", columns 1 and 2 have empty headers but contain answer data
    // inferEmptyHeaders should fill: col 1 -> "standard", col 2 -> "advanced"
    const html = `
      <table>
        <tr>
          <th>Question</th>
          <th></th>
          <th></th>
          <th>Section</th>
          <th>Number</th>
          <th>Notes</th>
        </tr>
        <tr>
          <td>What is your approach to sustainability?</td>
          <td>We follow ISO 14001 environmental management standards.</td>
          <td>Beyond ISO 14001, we implement circular economy principles and publish annual ESG reports.</td>
          <td>Environment</td>
          <td>1</td>
          <td>Mandatory</td>
        </tr>
        <tr>
          <td>How do you ensure supply chain integrity?</td>
          <td>Regular audits of all tier-1 suppliers.</td>
          <td>AI-powered supply chain monitoring with real-time risk scoring across all tiers.</td>
          <td>Procurement</td>
          <td>2</td>
          <td>Optional</td>
        </tr>
      </table>
    `;

    const pairs = detectQAPairs(html);
    expect(pairs).toHaveLength(2);

    // First pair: question, standard answer (inferred col 1), advanced answer (inferred col 2)
    expect(pairs[0].question).toBe('What is your approach to sustainability?');
    expect(pairs[0].answer).toContain('ISO 14001');
    expect(pairs[0].answerAdvanced).toContain('circular economy');
    expect(pairs[0].sectionName).toBe('Environment');

    // Second pair
    expect(pairs[1].question).toBe('How do you ensure supply chain integrity?');
    expect(pairs[1].answer).toContain('Regular audits');
    expect(pairs[1].answerAdvanced).toContain('AI-powered supply chain');
    expect(pairs[1].sectionName).toBe('Procurement');
  });
});
