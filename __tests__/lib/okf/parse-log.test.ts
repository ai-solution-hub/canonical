import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseBundleLog } from '@/lib/okf/parse-log';

// ID-132 {132.10} G-BUNDLE round-trip (S451 rider, BINDING): the fixture
// below is emitted VERBATIM by `producer/bundle_writer.py`'s own
// `render_log_entry`/`append_log_entry` (the `## <ISO-8601 timestamp>`
// convention this parser adopted) — proving the writer's output
// structurally parses into TWO distinct, correctly-ordered run entries
// rather than falling through to the single-unheaded-entry fallback. A
// format drift here would degrade `<BundleLog>` SILENTLY. De-identified:
// generic placeholder concept paths, never the real first-client corpus.
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  '__tests__/fixtures/okf/bundle-writer-log.md',
);

describe('parseBundleLog', () => {
  it('parses the {132.10} bundle_writer append-log fixture into two structured, reverse-chronological run entries (no fallback)', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf8');

    const entries = parseBundleLog(text);

    expect(entries).toHaveLength(2);
    // Reverse-chronological: the LATER run heading comes first.
    expect(entries[0].heading).toBe('2026-07-08T09:30:00Z');
    expect(entries[0].body).toContain(
      'Added (2): topics/encryption.md, topics/gdpr-and-data-protection.md',
    );
    expect(entries[0].body).toContain('Changed (1): company/overview.md');
    expect(entries[0].body).toContain('Removed (1): topics/retired-topic.md');
    expect(entries[0].body).toContain(
      'Moved (1): topics/old-name.md -> topics/new-name.md',
    );
    expect(entries[0].body).toContain('WARNING orphaned anchors (1)');

    expect(entries[1].heading).toBe('2026-07-01T09:00:00Z');
    expect(entries[1].body).toContain('Added (1): company/overview.md');

    // Both headings are non-empty and ISO-8601-shaped — proof this parsed
    // as STRUCTURED per-run entries, not the unheaded-fallback shape.
    for (const entry of entries) {
      expect(entry.heading).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });

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
