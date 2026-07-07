import { describe, it, expect } from 'vitest';
import { parseBundleLog } from '@/lib/okf/parse-log';

describe('parseBundleLog', () => {
  it('splits log.md into per-run entries on ## headings, reverse-chronological', () => {
    const text = [
      '## 2026-07-01T09:00:00Z',
      '',
      '- Added concept `topics/pricing/standard`.',
      '',
      '## 2026-07-05T14:30:00Z',
      '',
      '- Changed concept `topics/security/soc2`.',
      '- Removed concept `topics/legacy/old-tier`.',
    ].join('\n');

    const entries = parseBundleLog(text);

    expect(entries).toHaveLength(2);
    // Reverse-chronological: the LATER run heading comes first.
    expect(entries[0].heading).toBe('2026-07-05T14:30:00Z');
    expect(entries[0].body).toContain('Changed concept `topics/security/soc2`');
    expect(entries[1].heading).toBe('2026-07-01T09:00:00Z');
    expect(entries[1].body).toContain(
      'Added concept `topics/pricing/standard`',
    );
  });

  it('treats unstructured content with no ## headings as a single unheaded entry', () => {
    const entries = parseBundleLog(
      'Just a freeform changelog note, no headings.',
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].heading).toBe('');
    expect(entries[0].body).toBe(
      'Just a freeform changelog note, no headings.',
    );
  });

  it('returns an empty array for empty input', () => {
    expect(parseBundleLog('')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(parseBundleLog('   \n\n  ')).toEqual([]);
  });

  it('ignores a leading # document title above the first ## run heading', () => {
    const text = [
      '# Bundle change log',
      '',
      '## 2026-07-01T09:00:00Z',
      '',
      '- First run.',
    ].join('\n');

    const entries = parseBundleLog(text);

    expect(entries).toHaveLength(1);
    expect(entries[0].heading).toBe('2026-07-01T09:00:00Z');
  });
});
