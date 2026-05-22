/**
 * umbrellas-helpers.test.ts
 *
 * Unit tests for `lib/validation/umbrellas-helpers.ts`.
 *
 * Tests verify real behaviour against TECH §5.1 (helper signature + output
 * template) and §5.2 (worked example fixture) of
 * `docs/specs/canonical-pipeline-task-list-migration/TECH.md` and PRODUCT inv
 * 12 (retrospective journal-block contents) + inv 15 (UK English + ISO 8601
 * timestamps) of the same spec set.
 *
 * Coverage:
 *   - Opening / closing tags present and timestamps match exactly.
 *   - Required body lines present (RETROSPECTIVE OPENING preamble, original
 *     work line citing continuation prompt path, commits block, PLAN.md
 *     acceptance close).
 *   - Commits block renders one line per commit with `<sha8> — <message>`
 *     shape and preserves chronological ordering.
 *   - Optional Migration files block renders when non-empty, omits when
 *     undefined or empty array.
 *   - Optional Follow-up flags block renders when non-empty, omits when
 *     undefined or empty array.
 *   - Optional Umbrella line renders when umbrella_id provided, omits when
 *     undefined.
 *   - Full fixture round-trip against TECH §5.2 worked example (timestamp
 *     stubbed via vi.useFakeTimers + vi.setSystemTime).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatRetrospectiveJournalBlock,
  type RetrospectiveOpeningInput,
} from '@/lib/validation/umbrellas-helpers';

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────────────────────────────────────

const FIXED_ISO = '2026-05-22T10:00:00.000Z';

const MINIMAL_INPUT: RetrospectiveOpeningInput = {
  retro_open_session: 'kh-prod-readiness-S66',
  original_session: 'S242',
  original_branch: 'content-items-investigation',
  continuation_prompt_path:
    'docs/continuation-prompts/continuation-prompt-kh-s242-main-t1-specs-and-phase-0-close.md',
  commits: [
    {
      sha8: '2f142936',
      message_line:
        'docs(spec): procurement-workspaces PRODUCT + TECH — S242 W3 fix-pass per verifier findings',
    },
  ],
  plan_md_section: '4.1',
};

const FULL_INPUT_TECH_5_2: RetrospectiveOpeningInput = {
  retro_open_session: 'kh-prod-readiness-S66',
  original_session: 'S242',
  original_branch: 'content-items-investigation',
  continuation_prompt_path:
    'docs/continuation-prompts/continuation-prompt-kh-s242-main-t1-specs-and-phase-0-close.md',
  commits: [
    {
      sha8: '2f142936',
      message_line:
        'docs(spec): procurement-workspaces PRODUCT + TECH — S242 W3 fix-pass per verifier findings',
    },
    {
      sha8: 'ddebada1',
      message_line:
        'docs(spec): procurement-workspaces PRODUCT + TECH (absorbs EP8 v5) — S242 T4.7',
    },
    {
      sha8: 'f324fe93',
      message_line:
        'docs(spec): content-model-invariants PRODUCT — S242 W3 fix-pass per verifier findings',
    },
    {
      sha8: 'a89440f1',
      message_line:
        'docs(verify): content-model-invariants verifier report — S242 WP1.3',
    },
    {
      sha8: 'c8fd217b',
      message_line:
        'docs(verify): procurement-workspaces verifier report — S242 WP1.4',
    },
  ],
  plan_md_section: '4.1',
  umbrella_id: 'canonical-pipeline',
};

// ──────────────────────────────────────────────────────────────────────────────
// Timestamp stubbing — TECH §5.1 prescribes vi.useFakeTimers / vi.setSystemTime
// ──────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

// ──────────────────────────────────────────────────────────────────────────────
// Opening / closing tag bounds
// ──────────────────────────────────────────────────────────────────────────────

describe('formatRetrospectiveJournalBlock — opening/closing tag bounds', () => {
  it('opens with `<info added on {ISO}>` line', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out.startsWith(`<info added on ${FIXED_ISO}>`)).toBe(true);
  });

  it('closes with `</info added on {ISO}>` line', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out.trimEnd().endsWith(`</info added on ${FIXED_ISO}>`)).toBe(true);
  });

  it('opening and closing timestamps match exactly (regex-extracted)', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    const openMatch = out.match(/^<info added on (.+?)>/);
    const closeMatch = out.match(/<\/info added on (.+?)>$/m);
    expect(openMatch).not.toBeNull();
    expect(closeMatch).not.toBeNull();
    expect(openMatch?.[1]).toBe(closeMatch?.[1]);
  });

  it('timestamps are valid ISO 8601 with millisecond precision and Z suffix', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    const openMatch = out.match(/^<info added on (.+?)>/);
    expect(openMatch?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Required body content
// ──────────────────────────────────────────────────────────────────────────────

describe('formatRetrospectiveJournalBlock — required body lines', () => {
  it('contains the RETROSPECTIVE OPENING preamble verbatim', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).toContain(
      'RETROSPECTIVE OPENING — Task opened in `done` status post-implementation.',
    );
  });

  it('contains the Original work line citing original_session and continuation_prompt_path', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).toContain(
      'Original work happened S242 per `docs/continuation-prompts/continuation-prompt-kh-s242-main-t1-specs-and-phase-0-close.md`.',
    );
  });

  it('contains the Commits header citing original_session and original_branch', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).toContain('Commits (S242, content-items-investigation):');
  });

  it('contains the PLAN.md acceptance close line citing plan_md_section', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).toContain('PLAN.md §4.1 acceptance criteria all met.');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Commits block rendering
// ──────────────────────────────────────────────────────────────────────────────

describe('formatRetrospectiveJournalBlock — commits block', () => {
  it('renders one bullet line per commit in chronological order', () => {
    const out = formatRetrospectiveJournalBlock(FULL_INPUT_TECH_5_2);
    const lines = out.split('\n');
    const commitLines = lines.filter((l) => /^- [0-9a-f]{8} — /.test(l));
    expect(commitLines).toHaveLength(FULL_INPUT_TECH_5_2.commits.length);
    expect(commitLines[0]).toContain('2f142936');
    expect(commitLines[1]).toContain('ddebada1');
    expect(commitLines[4]).toContain('c8fd217b');
  });

  it('renders each commit as `- <sha8> — <message_line>`', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).toContain(
      '- 2f142936 — docs(spec): procurement-workspaces PRODUCT + TECH — S242 W3 fix-pass per verifier findings',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Optional Migration files block
// ──────────────────────────────────────────────────────────────────────────────

describe('formatRetrospectiveJournalBlock — optional Migration files block', () => {
  it('renders Migration files block when migration_files non-empty', () => {
    const out = formatRetrospectiveJournalBlock({
      ...MINIMAL_INPUT,
      migration_files: [
        'supabase/migrations/20260101000000_t6_phase_a.sql',
        'supabase/migrations/20260102000000_t6_phase_b.sql',
      ],
    });
    expect(out).toContain('Migration files:');
    expect(out).toContain(
      '- supabase/migrations/20260101000000_t6_phase_a.sql',
    );
    expect(out).toContain(
      '- supabase/migrations/20260102000000_t6_phase_b.sql',
    );
  });

  it('omits Migration files block when migration_files undefined', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).not.toContain('Migration files:');
  });

  it('omits Migration files block when migration_files is an empty array', () => {
    const out = formatRetrospectiveJournalBlock({
      ...MINIMAL_INPUT,
      migration_files: [],
    });
    expect(out).not.toContain('Migration files:');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Optional Follow-up flags block
// ──────────────────────────────────────────────────────────────────────────────

describe('formatRetrospectiveJournalBlock — optional Follow-up flags block', () => {
  it('renders Follow-up flags block when followup_flags non-empty', () => {
    const out = formatRetrospectiveJournalBlock({
      ...MINIMAL_INPUT,
      followup_flags: [
        'cocoindex-ledger-api deferred to v1.1',
        'anon-EXECUTE leak fix landing S250 W1b',
      ],
    });
    expect(out).toContain('Follow-up flags:');
    expect(out).toContain('- cocoindex-ledger-api deferred to v1.1');
    expect(out).toContain('- anon-EXECUTE leak fix landing S250 W1b');
  });

  it('omits Follow-up flags block when followup_flags undefined', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).not.toContain('Follow-up flags:');
  });

  it('omits Follow-up flags block when followup_flags is an empty array', () => {
    const out = formatRetrospectiveJournalBlock({
      ...MINIMAL_INPUT,
      followup_flags: [],
    });
    expect(out).not.toContain('Follow-up flags:');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Optional Umbrella line
// ──────────────────────────────────────────────────────────────────────────────

describe('formatRetrospectiveJournalBlock — optional Umbrella line', () => {
  it('renders `Umbrella: {id}` line when umbrella_id provided', () => {
    const out = formatRetrospectiveJournalBlock({
      ...MINIMAL_INPUT,
      umbrella_id: 'canonical-pipeline',
    });
    expect(out).toContain('Umbrella: canonical-pipeline');
  });

  it('omits Umbrella line when umbrella_id undefined', () => {
    const out = formatRetrospectiveJournalBlock(MINIMAL_INPUT);
    expect(out).not.toContain('Umbrella:');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Full fixture round-trip — TECH §5.2 worked example
// ──────────────────────────────────────────────────────────────────────────────

describe('formatRetrospectiveJournalBlock — TECH §5.2 worked example round-trip', () => {
  it('matches the TECH §5.2 worked example output verbatim (timestamp-stubbed)', () => {
    const expected = [
      '<info added on 2026-05-22T10:00:00.000Z>',
      'RETROSPECTIVE OPENING — Task opened in `done` status post-implementation.',
      'Original work happened S242 per `docs/continuation-prompts/continuation-prompt-kh-s242-main-t1-specs-and-phase-0-close.md`.',
      '',
      'Commits (S242, content-items-investigation):',
      '- 2f142936 — docs(spec): procurement-workspaces PRODUCT + TECH — S242 W3 fix-pass per verifier findings',
      '- ddebada1 — docs(spec): procurement-workspaces PRODUCT + TECH (absorbs EP8 v5) — S242 T4.7',
      '- f324fe93 — docs(spec): content-model-invariants PRODUCT — S242 W3 fix-pass per verifier findings',
      '- a89440f1 — docs(verify): content-model-invariants verifier report — S242 WP1.3',
      '- c8fd217b — docs(verify): procurement-workspaces verifier report — S242 WP1.4',
      '',
      'Umbrella: canonical-pipeline',
      '',
      'PLAN.md §4.1 acceptance criteria all met.',
      '</info added on 2026-05-22T10:00:00.000Z>',
    ].join('\n');

    const actual = formatRetrospectiveJournalBlock(FULL_INPUT_TECH_5_2);
    expect(actual).toBe(expected);
  });
});
