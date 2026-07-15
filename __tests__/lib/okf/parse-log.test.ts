import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseBundleLog } from '@/lib/okf/parse-log';

// ID-132 {132.10} G-BUNDLE round-trip (S451 rider, BINDING): the fixture
// below is emitted VERBATIM by `producer/bundle_writer.py`'s own
// `append_log_entry` — the OKF SPEC v0.1 §7 shape (`## YYYY-MM-DD` date
// headings, newest first; `* **Run <ISO-ts> — …:**` bullets, newest run
// first within a date) — proving the writer's output structurally parses
// into distinct, correctly-ordered run entries rather than falling
// through to the single-unheaded-entry fallback. A format drift here
// would degrade `<BundleLog>` SILENTLY. De-identified: generic
// placeholder concept paths, never the real first-client corpus.
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
  it('parses the {132.10} bundle_writer append-log fixture into per-run entries, newest first (no fallback)', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf8');

    const entries = parseBundleLog(text);

    expect(entries).toHaveLength(3);
    // §7 document order IS newest-first: the same-date no-op run tops the
    // merged 2026-07-08 section, then that date's earlier full run, then
    // the older date's run.
    expect(entries[0].heading).toBe('2026-07-08T14:00:00Z');
    expect(entries[0].body).toContain('No changes** (no-op re-run)');

    expect(entries[1].heading).toBe('2026-07-08T09:30:00Z');
    expect(entries[1].body).toContain(
      'Added (2):** topics/encryption.md, topics/gdpr-and-data-protection.md',
    );
    expect(entries[1].body).toContain('Changed (1):** company/overview.md');
    expect(entries[1].body).toContain('Removed (1):** topics/retired-topic.md');
    expect(entries[1].body).toContain(
      'Moved (1):** topics/old-name.md -> topics/new-name.md',
    );
    expect(entries[1].body).toContain('WARNING orphaned anchors (1)');

    expect(entries[2].heading).toBe('2026-07-01T09:00:00Z');
    expect(entries[2].body).toContain('Added (1):** company/overview.md');

    // Every heading is a full ISO-8601 run timestamp extracted from the
    // `**Run <ts> — …**` bullets — proof this parsed as STRUCTURED
    // per-run entries, not the unheaded/legacy fallback shape.
    for (const entry of entries) {
      expect(entry.heading).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });

  it('groups same-date runs under one heading and attaches continuation lines to the open run', () => {
    const text = [
      '## 2026-07-09',
      '',
      '* **Run 2026-07-09T15:00:00Z — Changed (1):** topics/a.md',
      '* **Run 2026-07-09T15:00:00Z — WARNING validator rejected (1):**',
      '  - topics/bad.md: type outside the closed set',
      '',
      '### git-sync reconcile findings',
      '- WARNING human-edited managed file(s) left in place (1):',
      '  - topics/a.md: diverges from the last producer commit',
      '* **Run 2026-07-09T09:00:00Z — Added (1):** topics/a.md',
    ].join('\n');

    const entries = parseBundleLog(text);

    expect(entries).toHaveLength(2);
    expect(entries[0].heading).toBe('2026-07-09T15:00:00Z');
    // Nested sub-bullets AND the inserted findings block belong to the
    // newest run's entry.
    expect(entries[0].body).toContain('topics/bad.md: type outside');
    expect(entries[0].body).toContain('git-sync reconcile findings');
    expect(entries[1].heading).toBe('2026-07-09T09:00:00Z');
    expect(entries[1].body).not.toContain('git-sync reconcile findings');
  });

  it('parses a LEGACY (pre-§7) log — ## timestamp headings, no Run bullets — reverse-chronological', () => {
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
    // Legacy append-only files are most-recent-LAST — reversed on read.
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

  it('ignores a leading # document title above the first ## heading', () => {
    const text = [
      '# Bundle change log',
      '',
      '## 2026-07-01',
      '',
      '* **Run 2026-07-01T09:00:00Z — Added (1):** topics/a.md',
    ].join('\n');

    const entries = parseBundleLog(text);

    expect(entries).toHaveLength(1);
    expect(entries[0].heading).toBe('2026-07-01T09:00:00Z');
  });
});
