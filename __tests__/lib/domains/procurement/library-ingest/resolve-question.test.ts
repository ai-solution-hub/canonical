import { describe, it, expect } from 'vitest';
import { resolveQuestionForRebuild } from '@/lib/domains/procurement/library-ingest/resolve-question';

describe('resolveQuestionForRebuild', () => {
  it('extracts the full question from content with Q: prefix', () => {
    const content = 'Q: full question\n\nanswer';
    const title = 'truncated title';
    expect(resolveQuestionForRebuild(content, title)).toBe('full question');
  });

  it('falls back to title when content lacks Q: prefix', () => {
    const content = 'plain answer without Q: prefix';
    const title = 'truncd q';
    expect(resolveQuestionForRebuild(content, title)).toBe('truncd q');
  });

  it('falls back to title when content is null', () => {
    const title = 'truncd q';
    expect(resolveQuestionForRebuild(null, title)).toBe('truncd q');
  });

  it('extracts question from content when title is null', () => {
    const content = 'Q: a';
    expect(resolveQuestionForRebuild(content, null)).toBe('a');
  });

  it('returns empty string when both content and title are null', () => {
    expect(resolveQuestionForRebuild(null, null)).toBe('');
  });
});
