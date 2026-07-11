import { describe, expect, it } from 'vitest';

import { CHARACTER_LIMIT, truncateResponse } from '@/lib/mcp/formatters/shared';

// Regression guard (investigator TE-05, CI run 29147882410 l3/l4): truncateResponse
// used to slice to the FULL CHARACTER_LIMIT and then APPEND the truncation notice,
// so every truncated response landed at CHARACTER_LIMIT + notice.length chars —
// breaching the eval harness's hard flagThreshold of exactly CHARACTER_LIMIT (see
// scripts/mcp-eval/response-quality.ts TE-05, flagThreshold: 10000). The total
// length INCLUDING the appended notice must stay within CHARACTER_LIMIT.

describe('truncateResponse', () => {
  it('leaves text at or under the character limit unchanged', () => {
    const text = 'x'.repeat(CHARACTER_LIMIT);
    expect(truncateResponse(text)).toBe(text);
    expect(truncateResponse('short text')).toBe('short text');
  });

  it('caps output at CHARACTER_LIMIT (including the appended notice) when over the limit', () => {
    const text = 'x'.repeat(CHARACTER_LIMIT + 5_000);
    const out = truncateResponse(text);
    expect(out.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(out).toContain(
      '... (content truncated — request specific items for full detail)',
    );
    expect(out.endsWith('for full detail)')).toBe(true);
  });
});
