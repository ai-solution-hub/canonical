import { describe, it, expect } from 'vitest';
import {
  formatBidQuestion,
  type ProcurementQuestionDetail,
} from '@/lib/mcp/formatters/bids';

const base: ProcurementQuestionDetail = {
  id: 'q-1',
  question_text: 'Describe your approach to safeguarding.',
  section_name: 'Section A',
  word_limit: 500,
  confidence_posture: 'strong_match',
  status: 'drafted',
  response_text: null,
  review_status: null,
};

describe('formatBidQuestion — response format', () => {
  it('converts Tiptap HTML response to markdown', () => {
    const md = formatBidQuestion({
      ...base,
      response_text:
        '<p>Our safeguarding approach:</p><ul><li><strong>Training</strong> for all staff</li><li>DBS checks</li></ul>',
    });

    expect(md).toContain('## Response');
    expect(md).toContain('Our safeguarding approach:');
    expect(md).toContain('-   **Training** for all staff');
    expect(md).toContain('-   DBS checks');
    expect(md).not.toContain('<p>');
    expect(md).not.toContain('<ul>');
    expect(md).not.toContain('<strong>');
  });

  it('passes markdown response through unchanged', () => {
    const md = formatBidQuestion({
      ...base,
      response_text: '## Approach\n\n- Training\n- DBS checks',
    });

    expect(md).toContain('## Approach');
    expect(md).toContain('- Training');
    expect(md).toContain('- DBS checks');
  });

  it('handles plain-text response without wrapping', () => {
    const md = formatBidQuestion({
      ...base,
      response_text: 'Short plain response.',
    });

    expect(md).toContain('## Response');
    expect(md).toContain('Short plain response.');
  });

  it('omits Response section when response_text is null', () => {
    const md = formatBidQuestion({ ...base, response_text: null });
    expect(md).not.toContain('## Response');
  });

  it('truncates long responses to ~3000 chars', () => {
    const longHtml = `<p>${'word '.repeat(2000)}</p>`;
    const md = formatBidQuestion({ ...base, response_text: longHtml });

    const responseIdx = md.indexOf('## Response');
    expect(responseIdx).toBeGreaterThanOrEqual(0);
    const responseBody = md.slice(responseIdx);
    expect(responseBody.length).toBeLessThan(3200);
  });
});
